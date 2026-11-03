import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { TOOL_NAME, TOOL_VERSION, SCHEMA_VERSION } from '../config/constants.js';
import { UsageError } from '../errors/errors.js';
import { isWithin, validateRunId } from '../security/path-guard.js';
import { safeJsonStringify, writeFileSecure } from '../utils/helpers.js';

export function runsRoot(options: any = {}): string {
  if (options.testRunsDir) return path.resolve(options.testRunsDir);
  if (options.runsDir) return path.resolve(options.runsDir);
  if (options.cwd) return path.join(path.resolve(options.cwd), `.${TOOL_NAME}`, 'runs');
  if (options.temp || process.env.AGENTSEYE_TEMP === '1') {
    return path.join(os.tmpdir(), `.${TOOL_NAME}`, 'runs');
  }
  return path.join(process.cwd(), `.${TOOL_NAME}`, 'runs');
}

export interface RunLocation {
  id: string;
  directory: string;
  report: string;
  dom: string;
  isTemp: boolean;
}

export async function createRun(options: any = {}): Promise<RunLocation> {
  const root = runsRoot(options);
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const realRoot = await fsp.realpath(root);
  const isCustom = Boolean(options.testRunsDir || options.runsDir);
  const isTemp = Boolean(options.temp || process.env.AGENTSEYE_TEMP === '1' || isCustom);
  if (!isTemp) {
    const cwdReal = await fsp.realpath(process.cwd()).catch(() => process.cwd());
    if (!isWithin(cwdReal, realRoot)) {
      throw new UsageError('Run storage must not resolve outside the working directory');
    }
  }
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(6).toString('hex')}`;
  const directory = path.join(realRoot, id);
  await fsp.mkdir(directory, { mode: 0o700 });
  return { id, directory, report: path.join(directory, 'report.json'), dom: path.join(directory, 'dom.json'), isTemp };
}

export async function cleanRuns(options: any = {}): Promise<any> {
  let candidateRoots: string[];
  if (options.testRunsDir || options.runsDir) {
    candidateRoots = [runsRoot(options)];
  } else {
    const localRoot = path.join(process.cwd(), `.${TOOL_NAME}`, 'runs');
    const tempRoot = path.join(os.tmpdir(), `.${TOOL_NAME}`, 'runs');
    const legacyRoot = path.join(process.cwd(), '.runtime-inspector', 'runs');
    candidateRoots = [localRoot, tempRoot, legacyRoot];
  }
  let count = 0;

  if (options.cleanRunIds && options.cleanRunIds.length > 0) {
    for (const runId of options.cleanRunIds) {
      for (const root of candidateRoots) {
        try {
          const runDir = path.join(root, runId);
          if (fs.existsSync(runDir)) {
            await fsp.rm(runDir, { recursive: true, force: true });
            count++;
            const remaining = await fsp.readdir(root).catch(() => ['non-empty']);
            if (remaining.length === 0) {
              await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
              const parent = path.dirname(root);
              const remainingParent = await fsp.readdir(parent).catch(() => ['non-empty']);
              if (remainingParent.length === 0) {
                await fsp.rm(parent, { recursive: true, force: true }).catch(() => {});
              }
            }
          }
        } catch {}
      }
    }
  } else if (options.cleanOlderThan != null) {
    const cutoff = Date.now() - options.cleanOlderThan;
    for (const root of candidateRoots) {
      try {
        if (fs.existsSync(root)) {
          const entries = await fsp.readdir(root);
          for (const entry of entries) {
            const entryPath = path.join(root, entry);
            const stat = await fsp.stat(entryPath).catch(() => null);
            if (!stat || !stat.isDirectory()) continue;
            let timestamp = stat.mtimeMs;
            const dateMatch = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d+)?Z)/.exec(entry);
            if (dateMatch) {
              const iso = dateMatch[1].replace(/-/g, (_m, offset) => (offset > 10 ? ':' : '-'));
              const parsed = Date.parse(iso);
              if (!isNaN(parsed)) timestamp = parsed;
            }
            if (timestamp < cutoff) {
              await fsp.rm(entryPath, { recursive: true, force: true });
              count++;
            }
          }
          const remaining = await fsp.readdir(root).catch(() => ['non-empty']);
          if (remaining.length === 0) {
            await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
            const parent = path.dirname(root);
            const remainingParent = await fsp.readdir(parent).catch(() => ['non-empty']);
            if (remainingParent.length === 0) {
              await fsp.rm(parent, { recursive: true, force: true }).catch(() => {});
            }
          }
        }
      } catch {}
    }
  } else if (options.cleanAll) {
    for (const root of candidateRoots) {
      try {
        if (fs.existsSync(root)) {
          const entries = await fsp.readdir(root);
          count += entries.length;
          await fsp.rm(root, { recursive: true, force: true });
          const parent = path.dirname(root);
          const remaining = await fsp.readdir(parent).catch(() => ['non-empty']);
          if (remaining.length === 0) {
            await fsp.rm(parent, { recursive: true, force: true }).catch(() => {});
          }
        }
      } catch {}
    }
  }

  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    message: options.cleanAll
      ? 'All agentsEye runs and cached artifacts have been cleaned.'
      : `Cleaned ${count} run(s).`,
    count,
  };
}

export async function readRun(id: unknown, options: any = {}): Promise<any> {
  const validId = validateRunId(id);
  const candidateRoots: string[] = [];
  const primaryRoot = await fsp.realpath(runsRoot(options)).catch(() => null);
  if (primaryRoot) candidateRoots.push(primaryRoot);
  const tempRoot = await fsp.realpath(path.join(os.tmpdir(), `.${TOOL_NAME}`, 'runs')).catch(() => null);
  if (tempRoot && !candidateRoots.includes(tempRoot)) candidateRoots.push(tempRoot);
  const localRoot = await fsp.realpath(path.join(process.cwd(), `.${TOOL_NAME}`, 'runs')).catch(() => null);
  if (localRoot && !candidateRoots.includes(localRoot)) candidateRoots.push(localRoot);
  const legacyRoot = await fsp.realpath(path.join(process.cwd(), '.runtime-inspector', 'runs')).catch(() => null);
  if (legacyRoot && !candidateRoots.includes(legacyRoot)) candidateRoots.push(legacyRoot);

  if (!candidateRoots.length) {
    throw new UsageError('No saved runs found');
  }

  let realFile: string | null = null;
  let matchingRoot: string | null = null;
  for (const root of candidateRoots) {
    const file = path.join(root, validId, 'report.json');
    realFile = await fsp.realpath(file).catch(() => null);
    if (realFile && isWithin(root, realFile)) {
      matchingRoot = root;
      break;
    }
  }
  if (!realFile || !matchingRoot) {
    throw new UsageError(`Saved run not found: ${validId}`);
  }
  const stat = await fsp.stat(realFile);
  if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new UsageError('Saved report is not a supported JSON file');
  let report: any;
  try {
    report = JSON.parse(await fsp.readFile(realFile, 'utf8'));
  } catch {
    throw new UsageError(`Invalid saved JSON report: ${validId}`);
  }
  if (!report || typeof report !== 'object' || Array.isArray(report) || !report.schemaVersion) {
    throw new UsageError(`Unsupported saved report: ${validId}`);
  }
  return report;
}

export async function persistRun(report: any, run: RunLocation): Promise<void> {
  report.run = run;
  await writeFileSecure(run.dom, safeJsonStringify(report.dom ?? null));
  await writeFileSecure(run.report, safeJsonStringify(report));
}
