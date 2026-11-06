import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { TOOL_NAME, TOOL_VERSION, SCHEMA_VERSION, MATRIX_VIEWPORTS } from '../config/constants.js';
import { parseArgs } from '../cli/parser.js';
import { printHelp } from '../cli/help.js';
import { cleanRuns, readRun, createRun, persistRun } from '../storage/runs.js';
import { selectSections, queryReport, outputView } from '../reporting/views.js';
import { diffReports, diffInteractiveSnapshots } from '../reporting/diff.js';
import { serializeOutput } from '../reporting/formatters.js';
import { validateResolvedTargetUrl, validateCdpEndpoint } from '../security/url-guard.js';
import { resolveSafePath, assertFileDoesNotExist } from '../security/path-guard.js';
import { redactString } from '../security/redaction.js';
import { logInfo, logWarn, writeFileSecure } from '../utils/helpers.js';
import { attachToCdp, launchBrowser } from '../cdp/browser.js';
import { inspectPage } from './inspect-page.js';

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let options: any;
  try {
    options = parseArgs(argv);
  } catch (error: any) {
    process.stderr.write(`${TOOL_NAME}: ${redactString(error.message)}\n`);
    process.exitCode = error.exitCode || 2;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }
  if (options.version) {
    process.stdout.write(`${TOOL_NAME} ${TOOL_VERSION}\n`);
    return;
  }

  let browserInfo: any = null;
  let attachment: any = null;
  let activeRun: any = null;
  let cleaning: Promise<void> | null = null;
  const cleanup = () => {
    if (!cleaning) {
      cleaning = (async () => {
        if (attachment) await attachment.cleanup();
        if (browserInfo) await browserInfo.cleanup();
      })();
    }
    return cleaning;
  };
  const onInterrupt = () => {
    cleanup().finally(() => process.exit(130));
  };
  const onTerminate = () => {
    cleanup().finally(() => process.exit(143));
  };
  const onBreak = () => {
    cleanup().finally(() => process.exit(130));
  };
  const onHangup = () => {
    cleanup().finally(() => process.exit(129));
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  process.once('SIGBREAK', onBreak);
  process.once('SIGHUP', onHangup);
  try {
    if (options.command === 'clean') {
      const result = await cleanRuns(options);
      if (options.format === 'text') {
        process.stdout.write(`${result.message}\nCleaned ${result.count} run directories.\n`);
      } else {
        process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`);
      }
      return;
    }
    if (options.command === 'show') {
      const saved = await readRun(options.runIds[0], options);
      if (
        options.delta &&
        (saved.interactions?.beforeSnapshot || saved.interactions?.afterSnapshot)
      ) {
        const delta = diffInteractiveSnapshots(
          saved.interactions?.beforeSnapshot?.interactive?.items ?? [],
          saved.interactions?.afterSnapshot?.interactive?.items ?? saved.interactive?.items ?? [],
          saved.interactions?.beforeSnapshot?.interactiveTreeText ?? '',
          saved.interactions?.afterSnapshot?.interactiveTreeText ?? saved.interactiveTreeText ?? '',
        );
        process.stdout.write(serializeOutput(delta, options));
        return;
      }
      const view =
        options.full && !options.query
          ? selectSections(saved, options)
          : queryReport(saved, options.query, options);
      process.stdout.write(serializeOutput(view, options));
      return;
    }
    if (options.command === 'diff') {
      const before = await readRun(options.runIds[0], options);
      const after = await readRun(options.runIds[1], options);
      if (options.delta) {
        const delta = diffInteractiveSnapshots(
          before.interactive?.items ?? [],
          after.interactive?.items ?? [],
          before.interactiveTreeText ?? '',
          after.interactiveTreeText ?? '',
        );
        process.stdout.write(serializeOutput(delta, options));
        return;
      }
      process.stdout.write(
        serializeOutput(diffReports(before, after), { ...options, full: false, include: null }),
      );
      return;
    }

    // Resolve before launching: malformed/metadata targets must never open a browser.
    await validateResolvedTargetUrl(options.url, { timeoutMs: options.timeoutMs });
    if (options.cdp) validateCdpEndpoint(options.cdp, options.allowRemoteCdp);
    if (options.redact === 'none')
      logWarn(options, 'redaction is disabled; saved reports may contain secrets');
    if (options.noSandbox) logWarn(options, '--no-sandbox disables Chromium process isolation');
    if (options.ignoreCertificateErrors) logWarn(options, 'TLS certificate errors will be ignored');
    if (options.explore || options.actions.length) {
      logWarn(
        options,
        'interactions are opt-in and may have application side effects; use only on trusted applications',
      );
    }

    const outPath = options.out ? resolveSafePath(options.out, options, '--out') : null;
    if (outPath) assertFileDoesNotExist(outPath);
    if (options.screenshot) {
      const screenshotPath = resolveSafePath(options.screenshot, options, '--screenshot');
      if (fs.existsSync(screenshotPath) && !fs.statSync(screenshotPath).isDirectory()) {
        assertFileDoesNotExist(screenshotPath);
      }
    }
    activeRun = await createRun(options);
    let cdp: any;
    if (options.cdp) {
      attachment = await attachToCdp(options.cdp, {
        allowRemoteCdp: options.allowRemoteCdp,
        timeoutMs: options.timeoutMs,
      });
      cdp = attachment.cdp;
    } else {
      browserInfo = await launchBrowser(options, (message: string) => logInfo(options, message));
      cdp = browserInfo.cdp;
    }
    const viewports = options.matrix
      ? (options.customViewports ?? MATRIX_VIEWPORTS)
      : [options.viewport];
    const snapshots: any[] = [];
    const seenViewportFilenames = new Set<string>();
    for (const [index, viewport] of viewports.entries()) {
      const baseFilename = `viewport-${viewport.width}x${viewport.height}`;
      const filename = seenViewportFilenames.has(baseFilename)
        ? `${baseFilename}-${index}.${options.screenshotFormat}`
        : `${baseFilename}.${options.screenshotFormat}`;
      seenViewportFilenames.add(baseFilename);

      const runOptions = {
        ...options,
        viewport: { ...viewport, dpr: options.viewport.dpr ?? viewport.dpr ?? 1 },
        // Each matrix entry owns one screenshot; user-specified output is copied
        // afterwards to avoid overwriting it on the second viewport.
        screenshot: path.join(activeRun.directory, filename),
      };
      if (options.matrix) {
        logInfo(
          options,
          `Inspecting viewport ${viewport.width}x${viewport.height} (${index + 1}/${viewports.length})`,
        );
      }
      snapshots.push(await inspectPage(cdp, runOptions, browserInfo ?? attachment));
    }
    const report = snapshots[0];
    if (options.matrix) {
      report.matrix = {
        snapshots: snapshots.map((snapshot) => ({ ...snapshot })),
        differences: snapshots.slice(1).map((snapshot) => diffReports(snapshots[0], snapshot)),
      };
      report.screenshots = snapshots.flatMap((snapshot) => snapshot.screenshots ?? []);
    }
    if (options.screenshot && report.screenshots.length) {
      let destination = resolveSafePath(options.screenshot, options, '--screenshot');
      if (fs.existsSync(destination) && fs.statSync(destination).isDirectory()) {
        destination = path.join(destination, `${activeRun.id}.${options.screenshotFormat}`);
      }
      await writeFileSecure(destination, await fsp.readFile(report.screenshots[0].path));
      report.screenshots.push({ ...report.screenshots[0], role: 'output', path: destination });
    }
    report.durationMs = snapshots.reduce(
      (total: number, snapshot: any) => total + snapshot.durationMs,
      0,
    );
    await persistRun(report, activeRun);
    logInfo(options, `Saved run ${activeRun.id}: ${activeRun.report}`);
    if (outPath) {
      // --out is the comprehensive report; stdout remains an agent view.
      await writeFileSecure(
        outPath,
        JSON.stringify(selectSections(report, options), null, options.pretty ? 2 : 0),
      );
    }
    function formatActionTarget(act: any): string {
      if (act.type === 'key') return `key "${act.value || 'unknown'}"`;
      if (act.type === 'scroll') return `scroll ${act.value || 'view'}`;
      const target = act.target;
      if (target && typeof target === 'object') {
        const name = target.name || target.accessibleName || '';
        const tag = target.tag || '';
        if (name) return `"${name}" (${tag || act.value || '@ref'})`;
        if (tag) return `${tag} (${act.value || '@ref'})`;
      }
      return act.value || act.selector || '@ref';
    }

    if (options.actions.length > 0 && !options.full && !options.focus) {
      if (options.format === 'text' && !options.delta) {
        for (const act of report.interactions?.actions || []) {
          if (act.status === 'executed' || act.status === 'performed') {
            process.stdout.write(`✓ Executed ${act.type} on ${formatActionTarget(act)}\n`);
          } else if (act.status === 'skipped') {
            process.stdout.write(
              `⚠ Skipped ${act.type} on ${formatActionTarget(act)}: ${act.reason || 'safety gate'}\n`,
            );
          }
        }
      }
      if (
        options.delta &&
        (report.interactions?.beforeSnapshot || report.interactions?.afterSnapshot)
      ) {
        const delta = diffInteractiveSnapshots(
          report.interactions?.beforeSnapshot?.interactive?.items ?? [],
          report.interactions?.afterSnapshot?.interactive?.items ?? report.interactive?.items ?? [],
          report.interactions?.beforeSnapshot?.interactiveTreeText ?? '',
          report.interactions?.afterSnapshot?.interactiveTreeText ??
            report.interactiveTreeText ??
            '',
        );
        process.stdout.write(serializeOutput(delta, options));
        if (!report.ok) process.exitCode = 1;
        return;
      }
    }
    if (
      options.delta &&
      (report.interactions?.beforeSnapshot || report.interactions?.afterSnapshot)
    ) {
      const delta = diffInteractiveSnapshots(
        report.interactions?.beforeSnapshot?.interactive?.items ?? [],
        report.interactions?.afterSnapshot?.interactive?.items ?? report.interactive?.items ?? [],
        report.interactions?.beforeSnapshot?.interactiveTreeText ?? '',
        report.interactions?.afterSnapshot?.interactiveTreeText ?? report.interactiveTreeText ?? '',
      );
      process.stdout.write(serializeOutput(delta, options));
      if (!report.ok) process.exitCode = 1;
      return;
    }
    process.stdout.write(serializeOutput(outputView(report, options), options));
    if (!report.ok) process.exitCode = 1;
  } catch (error: any) {
    const payload = {
      ok: false,
      schemaVersion: SCHEMA_VERSION,
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
      generatedAt: new Date().toISOString(),
      run: activeRun,
      error: {
        code: error.code || 'ERROR',
        message: redactString(error.message, options?.redact ?? 'sensitive'),
      },
    };
    if (activeRun && !fs.existsSync(activeRun.report)) {
      await persistRun(payload, activeRun).catch(() => {});
    }
    process.stdout.write(`${JSON.stringify(payload, null, options?.pretty ? 2 : 0)}\n`);
    process.stderr.write(
      `${TOOL_NAME}: ${redactString(error.message, options?.redact ?? 'sensitive')}\n`,
    );
    process.exitCode = error.exitCode || 1;
  } finally {
    if (options?.ephemeral && activeRun?.directory) {
      await fsp.rm(activeRun.directory, { recursive: true, force: true }).catch(() => {});
      const runsDir = path.dirname(activeRun.directory);
      const remainingRuns = await fsp.readdir(runsDir).catch(() => ['non-empty']);
      if (remainingRuns.length === 0) {
        await fsp.rm(runsDir, { recursive: true, force: true }).catch(() => {});
        const parent = path.dirname(runsDir);
        const remainingParent = await fsp.readdir(parent).catch(() => ['non-empty']);
        if (remainingParent.length === 0) {
          await fsp.rm(parent, { recursive: true, force: true }).catch(() => {});
        }
      }
    }
    await cleanup();
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    process.removeListener('SIGBREAK', onBreak);
    process.removeListener('SIGHUP', onHangup);
  }
}
