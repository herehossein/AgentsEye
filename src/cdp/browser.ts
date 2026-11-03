import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import { TOOL_NAME, BROWSER_ENV_KEYS, DEFAULTS } from '../config/constants.js';
import { UsageError, InspectorError } from '../errors/errors.js';
import { sleep } from '../utils/helpers.js';
import { normalizeHost, validateCdpEndpoint, validateResolvedHostname, validateResolvedTargetUrl } from '../security/url-guard.js';
import { loadWebSocketCtor, connectCdp, CdpClient } from './client.js';

export function browserCandidates(): string[] {
  const candidates: string[] = [];
  for (const envKey of BROWSER_ENV_KEYS) {
    if (process.env[envKey]) candidates.push(process.env[envKey]!);
  }

  if (process.platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env['PROGRAMFILES(X86)'];
    const localAppData = process.env.LOCALAPPDATA;
    for (const root of [programFiles, programFilesX86]) {
      if (!root) continue;
      candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      candidates.push(path.join(root, 'Chromium', 'Application', 'chrome.exe'));
      candidates.push(path.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
    }
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      candidates.push(path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
    );
  } else {
    candidates.push(
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
      'microsoft-edge',
      'microsoft-edge-stable',
      'brave-browser'
    );
  }
  return candidates;
}

export function commandExists(command: string): boolean {
  const which = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = spawnSync(which, [command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    return result.status === 0 && String(result.stdout ?? '').trim().length > 0;
  } catch {
    return false;
  }
}

export function findBrowser(explicit?: string): string {
  if (explicit) {
    const hasPathSeparator = explicit.includes('/') || explicit.includes('\\');
    if (hasPathSeparator) {
      const absolute = path.resolve(explicit);
      if (!fs.existsSync(absolute)) {
        throw new InspectorError(`Browser executable not found: ${absolute}`, 'BROWSER_NOT_FOUND');
      }
      if (process.platform === 'win32' && !absolute.toLowerCase().endsWith('.exe')) {
        throw new UsageError(`Browser executable on Windows must be an .exe binary: ${absolute}`);
      }
      return absolute;
    }
    const knownCommands = new Set([
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
      'microsoft-edge',
      'microsoft-edge-stable',
      'msedge',
      'brave-browser',
      'chrome',
    ]);
    if (!knownCommands.has(explicit) && !commandExists(explicit)) {
      throw new UsageError(`Refusing to execute unknown browser command: ${explicit}`);
    }
    return explicit;
  }

  for (const candidate of browserCandidates()) {
    if (!candidate) continue;
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (fs.existsSync(candidate)) return candidate;
    } else if (commandExists(candidate)) {
      return candidate;
    }
  }
  throw new InspectorError(
    'No Chromium-based browser found. Install Chrome/Edge/Chromium or pass --browser <path>.',
    'BROWSER_NOT_FOUND'
  );
}

export async function getFreePort(): Promise<number> {
  const server = net.createServer();
  server.unref();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) throw new InspectorError('Could not allocate a local debugging port');
  return port;
}

export async function httpJson(url: string, { method = 'GET', timeoutMs = 5_000 } = {}): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new InspectorError(
        `HTTP ${response.status} ${response.statusText} from ${url}: ${text.slice(0, 200)}`
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new InspectorError(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface AttachedCdpResult {
  cdp: CdpClient;
  cleanup: () => Promise<void>;
  version: any;
  endpoint: string;
  browserContextId?: string;
  targetId?: string;
}

export interface AttachToCdpOptions {
  allowRemoteCdp?: boolean;
  timeoutMs?: number;
  lookup?: (hostname: string, options?: any) => Promise<any>;
  connect?: (wsUrl: string, options?: any) => Promise<any>;
  getJson?: (url: string, options?: any) => Promise<any>;
}

export async function attachToCdp(
  raw: unknown,
  {
    allowRemoteCdp = false,
    timeoutMs = DEFAULTS.timeoutMs,
    lookup = dnsLookup as any,
    connect = connectCdp,
    getJson = httpJson,
  }: AttachToCdpOptions = {}
): Promise<AttachedCdpResult> {
  const endpoint = validateCdpEndpoint(raw, allowRemoteCdp);
  await validateResolvedHostname(endpoint.hostname, { lookup, timeoutMs, loopbackOnly: !allowRemoteCdp });
  let version = null;
  let wsEndpoint: URL;
  if (endpoint.protocol === 'ws:' || endpoint.protocol === 'wss:') {
    if (!/^\/devtools\/browser\/[^/]+\/?$/.test(endpoint.pathname)) {
      throw new UsageError('--cdp requires a browser WebSocket endpoint, not a user page endpoint');
    }
    wsEndpoint = endpoint;
  } else {
    const versionUrl = new URL('/json/version', endpoint);
    version = await getJson(versionUrl.toString(), { timeoutMs });
    if (!version?.webSocketDebuggerUrl) {
      throw new InspectorError('CDP browser endpoint is unavailable', 'CDP_BROWSER_ENDPOINT_REQUIRED');
    }
    wsEndpoint = validateCdpEndpoint(version.webSocketDebuggerUrl, allowRemoteCdp);
    const sameTransport = wsEndpoint.protocol === (endpoint.protocol === 'https:' ? 'wss:' : 'ws:');
    if (
      !sameTransport ||
      normalizeHost(wsEndpoint.hostname) !== normalizeHost(endpoint.hostname) ||
      (wsEndpoint.port || (sameTransport && endpoint.protocol === 'https:' ? '443' : '80')) !==
        (endpoint.port || (endpoint.protocol === 'https:' ? '443' : '80')) ||
      !/^\/devtools\/browser\/[^/]+\/?$/.test(wsEndpoint.pathname)
    ) {
      throw new InspectorError('CDP discovery returned an unexpected browser endpoint', 'CDP_ENDPOINT_MISMATCH');
    }
  }
  const browserCdp = await connect(wsEndpoint.toString(), { commandTimeoutMs: timeoutMs });
  let browserContextId: string | undefined;
  let targetId: string | undefined;
  let sessionId: string | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const subscriptions = new Set<() => void>();
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      for (const off of subscriptions) off();
      subscriptions.clear();
      const cleanupOptions = { timeoutMs: Math.min(timeoutMs, 3_000) };
      try {
        if (targetId) await browserCdp.send('Target.closeTarget', { targetId }, cleanupOptions).catch(() => {});
        if (browserContextId) await browserCdp.send('Target.disposeBrowserContext', { browserContextId }, cleanupOptions).catch(() => {});
      } finally {
        browserCdp.close();
      }
    })();
    return cleanupPromise;
  };
  try {
    ({ browserContextId } = await browserCdp.send('Target.createBrowserContext', { disposeOnDetach: true }));
    if (!browserContextId) throw new InspectorError('Could not create isolated browser context', 'CDP_ISOLATION_FAILED');
    // Security: Block all downloads in this browser context
    await browserCdp.send('Browser.setDownloadBehavior', {
      behavior: 'deny',
      browserContextId,
    }).catch(() => {});
    // Security: Reset/deny all permissions in this browser context
    await browserCdp.send('Browser.grantPermissions', {
      permissions: [],
      browserContextId,
    }).catch(() => {});
    ({ targetId } = await browserCdp.send('Target.createTarget', { url: 'about:blank', browserContextId }));
    if (!targetId) throw new InspectorError('Could not create isolated target', 'CDP_ISOLATION_FAILED');
    // Security: Intercept and auto-close unmanaged child windows / popups
    const offTargetCreated = browserCdp.on('Target.targetCreated', async ({ targetInfo }: any) => {
      if (targetInfo.targetId !== targetId && targetInfo.browserContextId === browserContextId) {
        await browserCdp.send('Target.closeTarget', { targetId: targetInfo.targetId }).catch(() => {});
      }
    });
    subscriptions.add(offTargetCreated as any);
    ({ sessionId } = await browserCdp.send('Target.attachToTarget', { targetId, flatten: true }));
    if (!sessionId) throw new InspectorError('Could not attach isolated target', 'CDP_ISOLATION_FAILED');
    const cdp: CdpClient = {
      send: (method: string, params: Record<string, unknown> = {}, commandOptions: any = {}) =>
        browserCdp.send(method, params, { ...commandOptions, sessionId }),
      on: (method: string, handler: (params: any, sessionId?: string) => void) => {
        const off = browserCdp.on(method, (params: any, eventSessionId?: string) => {
          if (eventSessionId === sessionId) handler(params, eventSessionId);
        });
        subscriptions.add(off as any);
        return () => {
          subscriptions.delete(off as any);
          return (off as any)();
        };
      },
      close: () => {
        void cleanup();
      },
      socket: browserCdp.socket,
    };
    return { cdp, cleanup, version, endpoint: wsEndpoint.toString(), browserContextId, targetId };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export interface LaunchedBrowserResult {
  child: ChildProcess;
  port: number;
  tempDir: string;
  executable: string;
  version: any;
  endpoint: string;
  cdp: CdpClient;
  cleanup: () => Promise<void>;
  getStderr: () => string;
}

export async function launchBrowser(options: any, log: (msg: string) => void = () => {}): Promise<LaunchedBrowserResult> {
  // Keep this check before process/profile allocation for direct API callers.
  await validateResolvedTargetUrl(options.url, { timeoutMs: options.timeoutMs });
  await loadWebSocketCtor();
  const executable = findBrowser(options.browser);
  const port = await getFreePort();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `${TOOL_NAME}-`));
  let child: ChildProcess | undefined;
  let attached: AttachedCdpResult | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      try {
        await attached?.cleanup();
      } finally {
        try {
          await stopBrowser(child);
        } finally {
          await removeTempDir(tempDir);
        }
      }
    })();
    return cleanupPromise;
  };
  let stderr = '';
  try {
    const args = [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${tempDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,InterestFeedContentSuggestions,CalculateNativeWinOcclusion,DownloadBubble,DownloadBubbleV2',
      '--deny-permission-prompts',
      '--metrics-recording-only',
      '--mute-audio',
      '--password-store=basic',
      '--use-mock-keychain',
      '--disable-gpu',
      `--window-size=${options.viewport.width},${options.viewport.height}`,
    ];
    if (!options.headed) args.unshift('--headless=new');
    if (options.noSandbox) args.unshift('--no-sandbox');
    if (options.ignoreCertificateErrors) args.unshift('--ignore-certificate-errors');
    if (options.noProxy) args.unshift('--no-proxy-server');
    if (options.hideScrollbars) args.unshift('--hide-scrollbars');
    for (const extra of options.extraBrowserArgs ?? []) args.push(extra);
    args.push('about:blank');

    log(`Launching ${executable}`);
    child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let spawnError: any;
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });
    child.stdout?.on('data', () => {});
    child.on('error', (error) => {
      spawnError = error;
    });

    const startTimeout = Math.min(Math.max(options.timeoutMs, 15_000), 30_000);
    const deadline = Date.now() + startTimeout;
    let version: any;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) {
        throw new InspectorError(
          `Browser exited during startup (${spawnError?.code || child.signalCode || child.exitCode}).\n${stderr.slice(-2_000)}`,
          'BROWSER_START_FAILED'
        );
      }
      try {
        version = await httpJson(`http://127.0.0.1:${port}/json/version`, {
          timeoutMs: Math.min(1_000, Math.max(1, deadline - Date.now())),
        });
        break;
      } catch {
        await sleep(150);
      }
    }
    if (!version) {
      throw new InspectorError(
        `Browser did not expose DevTools within ${startTimeout}ms.\n${stderr.slice(-2_000)}`,
        'BROWSER_START_TIMEOUT'
      );
    }
    attached = await attachToCdp(`http://127.0.0.1:${port}`, { timeoutMs: startTimeout });
    return {
      child,
      port,
      tempDir,
      executable,
      version,
      endpoint: attached.endpoint,
      cdp: attached.cdp,
      cleanup,
      getStderr: () => stderr,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function stopBrowser(child?: ChildProcess): Promise<void> {
  if (!child?.pid) return;
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const waitForExit = (timeoutMs: number) =>
    new Promise<void>((resolve) => {
      if (exited()) {
        resolve();
        return;
      }
      const done = () => {
        clearTimeout(timer);
        child.off('exit', done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      child.once('exit', done);
    });
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 10_000,
        });
      } else {
        try {
          process.kill(-child.pid!, signal);
        } catch {
          child.kill(signal);
        }
      }
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already exited */
      }
    }
  };
  if (!exited()) {
    kill('SIGTERM');
    await waitForExit(2_000);
  }
  // Ensure all orphaned children in the process tree are eliminated
  kill('SIGKILL');
  await waitForExit(1_000);
}

export async function removeTempDir(dir?: string): Promise<void> {
  if (!dir) return;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fsp.rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
      return;
    } catch {
      await sleep(250 * (attempt + 1));
    }
  }
}
