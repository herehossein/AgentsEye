import { sleep, logInfo } from '../utils/helpers.js';
import { redactUrl, redactReport } from '../security/redaction.js';
import { auditAndSanitizeReport } from '../security/prompt-injection.js';
import {
  validateResolvedTargetUrl,
  validateTargetUrl,
  isPrivateHost,
} from '../security/url-guard.js';
import { InspectorError } from '../errors/errors.js';
import { DEFAULTS, SCHEMA_VERSION, TOOL_NAME, TOOL_VERSION } from '../config/constants.js';
import { makeProbeConfig, inPageProbe } from '../probes/dom-probe.js';
import { evaluate } from '../cdp/client.js';
import {
  attachCaptureHandlers,
  preparePage,
  waitForLoad,
  waitForSelector,
  waitForNetworkIdle,
} from '../cdp/capture.js';
import {
  installPerformanceObservers,
  collectPerformance,
  collectCookies,
  collectA11y,
  collectFrameTree,
  takeScreenshot,
} from '../cdp/collectors.js';
import { cleanupDomRefs, performInteractions } from '../interactions/runner.js';
import { sanitizeOptionsForReport } from '../reporting/views.js';
import { formatInteractiveTreeText } from '../reporting/formatters.js';
import type { CdpClient } from '../cdp/client.js';

export async function inspectPage(cdp: CdpClient, options: any, browserInfo?: any): Promise<any> {
  const warnings: string[] = [];
  const startedAt = Date.now();
  const state = attachCaptureHandlers(cdp, options);

  let disposeGuard: (() => Promise<void>) | null = null;
  try {
    disposeGuard = await preparePage(cdp, options, warnings);
    await installPerformanceObservers(cdp, warnings);
    const initialFrame = await cdp.send('Page.getFrameTree');
    state.mainFrameId = initialFrame.frameTree?.frame?.id ?? null;
    const targetUrl = await validateResolvedTargetUrl(options.url, {
      timeoutMs: options.timeoutMs,
    });
    logInfo(options, `Navigating to ${redactUrl(targetUrl.toString())}`);
    const navigation = await cdp.send('Page.navigate', { url: targetUrl.toString() });
    if (navigation.errorText) {
      if (navigation.errorText.includes('ERR_HTTP_RESPONSE_CODE_FAILURE')) {
        warnings.push(`Navigation reported HTTP error response code: ${navigation.errorText}`);
      } else {
        throw new InspectorError(`Navigation failed: ${navigation.errorText}`, 'NAVIGATION_FAILED');
      }
    }
    state.mainFrameId = navigation.frameId || state.mainFrameId;
    await waitForLoad(state, options, warnings);

    if (options.waitFor) {
      const found = await waitForSelector(cdp, options.waitFor, options);
      if (!found) warnings.push(`Selector did not appear before timeout: ${options.waitFor}`);
    }
    if (!(await waitForNetworkIdle(state, options))) {
      warnings.push('Network-idle deadline reached; pending requests remain in the report');
    }
    if (options.waitMs > 0) await sleep(options.waitMs);

    const finalUrlRaw = await evaluate(cdp, 'location.href', options).catch(() =>
      targetUrl.toString(),
    );
    let parsedFinalUrl: URL;
    try {
      if (finalUrlRaw && !String(finalUrlRaw).startsWith('chrome-error:')) {
        parsedFinalUrl = validateTargetUrl(String(finalUrlRaw));
      } else {
        parsedFinalUrl = targetUrl;
      }
    } catch {
      parsedFinalUrl = targetUrl;
    }
    const finalUrl = parsedFinalUrl.toString();
    if (isPrivateHost(parsedFinalUrl.hostname)) {
      warnings.push('Target is a private/loopback host; only inspect trusted applications.');
    }

    // Probe with one retry if the execution context was replaced by a late SPA navigation.
    const probeConfig = makeProbeConfig(options);
    const probeExpression = `(${inPageProbe.toString()})(${JSON.stringify(probeConfig)})`;
    let probe: any = null;
    let lastProbeError: any = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        probe = await evaluate(cdp, probeExpression, options, {
          timeoutMs: Math.max(options.timeoutMs, 45_000),
        });
        break;
      } catch (error: any) {
        lastProbeError = error;
        if (!/context|destroyed|navigat/i.test(error.message)) break;
        await sleep(500);
      }
    }
    if (!probe) {
      throw new InspectorError(
        `DOM probe failed: ${lastProbeError?.message ?? 'unknown error'}`,
        'PROBE_FAILED',
      );
    }
    if (probe.error) {
      throw new InspectorError(`DOM probe returned an error: ${probe.error}`, 'PROBE_FAILED');
    }

    const interactions = await performInteractions(cdp, options, probe);
    if (interactions.finalProbe) probe = interactions.finalProbe;
    warnings.push(...interactions.warnings);
    warnings.push(...(probe.warnings || []));
    const performanceInfo = await collectPerformance(cdp, probe.page, warnings);
    const cookies = options.showCookies
      ? await collectCookies(cdp, finalUrl, options)
      : await collectCookies(cdp, finalUrl, { ...options, showCookies: false });
    const a11y = await collectA11y(cdp, options, warnings);
    const frames = await collectFrameTree(cdp, warnings);
    const screenshots = await takeScreenshot(cdp, options, warnings);

    const networkEntries = state.network.entries.map((entry: any) => ({
      requestId: entry.requestId,
      url: entry.url,
      method: entry.method,
      resourceType: entry.resourceType,
      initiatorType: entry.initiatorType,
      status: entry.status,
      statusText: entry.statusText,
      mimeType: entry.mimeType,
      fromDiskCache: entry.fromDiskCache ?? false,
      fromServiceWorker: entry.fromServiceWorker ?? false,
      state: entry.state === 'sent' ? 'pending' : entry.state,
      sent: true,
      streaming: Boolean(entry.streaming),
      redirected: Boolean(entry.redirected),
      failed: Boolean(entry.failed || (entry.status != null && entry.status >= 400)),
      aborted: Boolean(entry.aborted),
      errorText: entry.errorText,
      canceled: entry.canceled,
      blockedReason: entry.blockedReason,
      durationMs: entry.durationMs ?? null,
      encodedDataLength: entry.encodedDataLength ?? null,
    }));
    const statusClasses: Record<string, number> = {
      sent: networkEntries.length,
      completed: 0,
      failed: 0,
      aborted: 0,
      canceled: 0,
      pending: 0,
    };
    let failedCount = 0;
    for (const entry of networkEntries) {
      statusClasses[entry.state] = (statusClasses[entry.state] || 0) + 1;
      if (entry.state === 'failed' || (entry.status != null && entry.status >= 400))
        failedCount += 1;
      if (entry.status != null) {
        const cls = `${Math.floor(entry.status / 100)}xx`;
        statusClasses[cls] = (statusClasses[cls] || 0) + 1;
      }
    }
    const byType: Record<string, number> = {};
    for (const entry of networkEntries) {
      const type = entry.resourceType || 'Other';
      byType[type] = (byType[type] || 0) + 1;
    }
    const failures = networkEntries
      .filter((entry: any) => entry.failed || (entry.status != null && entry.status >= 400))
      .slice(0, 50);
    const slowest = [...networkEntries]
      .filter((entry: any) => typeof entry.durationMs === 'number')
      .sort((a: any, b: any) => b.durationMs - a.durationMs)
      .slice(0, 10);

    const mainDocument = state.mainDocumentResponse;
    const httpStatus = mainDocument?.status ?? null;

    const report: any = {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
      generatedAt: new Date().toISOString(),
      durationMs: null,
      target: {
        requestedUrl: targetUrl.toString(),
        finalUrl,
        title: probe.page?.title ?? null,
        httpStatus,
        mimeType: mainDocument?.mimeType ?? null,
      },
      environment: {
        browser: browserInfo?.version?.Browser ?? null,
        protocolVersion: browserInfo?.version?.['Protocol-Version'] ?? null,
        executable: browserInfo?.executable ?? null,
        viewport: { ...options.viewport },
        touch: options.touch || Boolean(options.viewport.mobile),
        userAgent: probe.page?.navigator?.userAgent ?? null,
        colorScheme: options.colorScheme,
        reducedMotion: options.reducedMotion,
        timezone: options.timezone,
        locale: options.locale,
        headers: options.headers.map((header: any) => header.name),
      },
      page: probe.page,
      dom: probe.dom,
      landmarks: probe.landmarks,
      headings: probe.headings,
      headingsOutline:
        probe.headings?.items?.map((h: any) => `h${h.level}: ${h.text || '(empty)'}`) ?? [],
      forms: probe.forms,
      interactive: probe.interactive,
      interactiveTreeText: probe.interactive?.items
        ? formatInteractiveTreeText(probe.interactive.items)
        : '',
      images: probe.images,
      frames,
      network: options.network
        ? {
            total: networkEntries.length,
            failed: failedCount,
            statusClasses,
            requests: networkEntries,
            summary: {
              total: networkEntries.length,
              failed: failedCount,
              statusClasses,
              byType,
              truncated: state.network.truncated,
              dropped: state.network.dropped,
            },
            failures,
            slowest,
          }
        : null,
      console: options.console
        ? {
            entries: state.console.entries,
            errors: state.console.entries.filter((entry: any) =>
              ['error', 'assert'].includes(entry.type),
            ),
            counts: state.console.counts,
            truncated: state.console.truncated,
          }
        : null,
      errors: state.errors,
      dialogs: state.dialogs,
      a11y,
      performance: performanceInfo,
      storage: probe.storage,
      cookies,
      cssVars: probe.cssVars,
      screenshots,
      issues: probe.issues,
      interactions: interactions.enabled ? interactions : null,
      warnings: Array.from(new Set(warnings)),
      meta: {
        options: sanitizeOptionsForReport(options, finalUrl),
        limits: {
          maxNodes: options.maxNodes,
          maxDepth: options.maxDepth,
          textLimit: options.textLimit,
          attributeLimit: options.attributeLimit,
          maxNetwork: options.maxNetwork,
          maxConsole: options.maxConsole,
          maxA11y: options.maxA11y,
          maxStorage: DEFAULTS.maxStorage,
          maxCssVars: DEFAULTS.maxCssVars,
        },
        truncation: {
          dom: Boolean(probe.dom?.truncated || probe.dom?.stats?.truncated),
          nodesDropped: probe.dom?.stats?.droppedNodes ?? 0,
          network: Boolean(state.network.truncated),
          networkDropped: state.network.dropped,
          console: Boolean(state.console.truncated),
          a11y: Boolean(a11y?.truncated),
          storage: Boolean(
            probe.storage?.localStorage?.truncated || probe.storage?.sessionStorage?.truncated,
          ),
          cssVars: Boolean(probe.cssVars?.truncated),
          screenshots: false,
        },
        crossOriginIframes: probe.dom?.stats?.crossOriginIframes ?? 0,
        notes: [
          'Rectangles with `.viewport` are relative to the layout viewport; `.document` adds scroll offsets.',
          'Under mobile emulation `window.innerWidth/Height` may be scaled; use `documentClientWidth/Height` (the CSS layout viewport used by media queries) and `visualViewport` for layout analysis.',
          'Hidden nodes are included unless --visible-only is set; use rendered/hasBox/hiddenReason to interpret them.',
          'Cross-origin iframe DOMs are listed in `frames` but not expanded.',
          'A virtual keyboard cannot be simulated; use visualViewport metrics and scrollLock.trapRisk.',
        ],
      },
    };

    report.durationMs = Date.now() - startedAt;
    const redacted = redactReport(report, options.redact);
    return auditAndSanitizeReport(redacted, options.sanitizeInjections);
  } finally {
    await cleanupDomRefs(cdp).catch(() => {});
    state.dispose();
    if (disposeGuard) await disposeGuard();
  }
}
