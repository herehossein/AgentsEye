import { UsageError, InspectorError } from '../errors/errors.js';
import { shortText, safeJsonStringify, sleep } from '../utils/helpers.js';
import {
  validateTargetUrl,
  isPrivateHost,
  validateResolvedTargetUrl,
} from '../security/url-guard.js';
import { redactString, serializeRemoteObject } from '../security/redaction.js';
import { CdpClient, evaluate } from './client.js';

export interface CaptureState {
  network: {
    enabled: boolean;
    requests: Map<string, any>;
    activeRequests: Map<string, any>;
    entries: any[];
    dropped: number;
    truncated: boolean;
  };
  console: {
    enabled: boolean;
    entries: any[];
    counts: Record<string, number>;
    truncated: boolean;
  };
  errors: {
    uncaught: any[];
    logErrors: any[];
  };
  dialogs: any[];
  mainDocumentResponse: { status: number | null; mimeType: string | null } | null;
  mainFrameId: string | null;
  finalUrl: string | null;
  loadFired: boolean;
  inflight: number;
  lastNetworkActivity: number;
  dispose: () => void;
}

export function attachCaptureHandlers(cdp: CdpClient, options: any): CaptureState {
  const disposers: Array<() => void> = [];
  const listen = (method: string, handler: (params: any) => void) =>
    disposers.push(cdp.on(method, handler));
  const state: CaptureState = {
    network: {
      enabled: options.network,
      requests: new Map(),
      activeRequests: new Map(),
      entries: [],
      dropped: 0,
      truncated: false,
    },
    console: { enabled: options.console, entries: [], counts: {}, truncated: false },
    errors: { uncaught: [], logErrors: [] },
    dialogs: [],
    mainDocumentResponse: null,
    mainFrameId: null,
    finalUrl: null,
    loadFired: false,
    inflight: 0,
    lastNetworkActivity: Date.now(),
    dispose: () => {
      for (const off of disposers.splice(0)) off();
      state.network.activeRequests.clear();
      state.inflight = 0;
    },
  };
  const activeCounted = (record: any) => Boolean(record && !record.streaming);
  const setActive = (requestId: string, record: any) => {
    const previous = state.network.activeRequests.get(requestId);
    if (activeCounted(previous)) state.inflight -= 1;
    state.network.activeRequests.set(requestId, record);
    if (activeCounted(record)) state.inflight += 1;
  };
  const deleteActive = (requestId: string) => {
    const previous = state.network.activeRequests.get(requestId);
    if (activeCounted(previous)) state.inflight -= 1;
    state.network.activeRequests.delete(requestId);
    return previous;
  };
  const isStreaming = (type: string, mimeType = '') =>
    type === 'WebSocket' || type === 'EventSource' || /^text\/event-stream(?:;|$)/i.test(mimeType);
  const finishEntry = (entry: any, params: any, requestState: string) => {
    if (!entry || entry.finishedAt != null) return;
    entry.state = requestState;
    entry.finishedAt = params.timestamp;
    if (Number.isFinite(params.timestamp) && Number.isFinite(entry.startedAt)) {
      entry.durationMs = Math.max(0, Math.round((params.timestamp - entry.startedAt) * 1000));
    }
  };
  const applyResponse = (entry: any, response: any = {}) => {
    if (!entry) return;
    entry.status = response.status ?? null;
    entry.statusText = response.statusText ?? null;
    entry.mimeType = response.mimeType ?? null;
    entry.fromDiskCache = Boolean(response.fromDiskCache);
    entry.fromServiceWorker = Boolean(response.fromServiceWorker);
    entry.encodedDataLength = response.encodedDataLength ?? null;
  };

  listen('Network.requestWillBeSent', (params: any) => {
    const previous = state.network.requests.get(params.requestId);
    if (params.redirectResponse) {
      applyResponse(previous, params.redirectResponse);
      finishEntry(previous, params, 'completed');
      if (previous) previous.redirected = true;
    }
    const streaming = isStreaming(params.type);
    setActive(params.requestId, { streaming });
    if (!streaming) state.lastNetworkActivity = Date.now();
    // Telemetry caps must never truncate the independent idle tracker.
    state.network.requests.delete(params.requestId);
    if (!options.network) return;
    if (state.network.entries.length >= options.maxNetwork) {
      state.network.truncated = true;
      state.network.dropped += 1;
      return;
    }
    const entry: any = {
      requestId: params.requestId,
      frameId: params.frameId,
      url: params.request?.url,
      method: params.request?.method,
      postData: params.request?.postData
        ? shortText(redactString(params.request.postData, options.redact), 500)
        : null,
      resourceType: params.type,
      initiatorType: params.initiator?.type ?? null,
      startedAt: params.timestamp,
      status: null,
      state: 'sent',
      failed: false,
      streaming,
    };
    state.network.requests.set(params.requestId, entry);
    state.network.entries.push(entry);
  });
  listen('Network.responseReceived', (params: any) => {
    const entry = state.network.requests.get(params.requestId);
    applyResponse(entry, params.response);
    const active = state.network.activeRequests.get(params.requestId);
    if (active && isStreaming(params.type, params.response?.mimeType)) {
      if (!active.streaming) state.inflight -= 1;
      active.streaming = true;
      if (entry) entry.streaming = true;
    }
    if (
      params.type === 'Document' &&
      (params.frameId === state.mainFrameId ||
        (!state.mainFrameId && params.response?.url === options.url))
    ) {
      state.mainDocumentResponse = {
        status: params.response?.status ?? null,
        mimeType: params.response?.mimeType ?? null,
      };
    }
    if (!active?.streaming) state.lastNetworkActivity = Date.now();
  });
  listen('Network.loadingFinished', (params: any) => {
    const active = deleteActive(params.requestId);
    if (active && !active.streaming) state.lastNetworkActivity = Date.now();
    const entry = state.network.requests.get(params.requestId);
    finishEntry(entry, params, 'completed');
    if (entry) entry.encodedDataLength = params.encodedDataLength ?? entry.encodedDataLength;
    state.network.requests.delete(params.requestId);
  });
  listen('Network.loadingFailed', (params: any) => {
    const active = deleteActive(params.requestId);
    if (active && !active.streaming) state.lastNetworkActivity = Date.now();
    const entry = state.network.requests.get(params.requestId);
    const aborted = /(?:^|::)ERR_ABORTED\b/.test(params.errorText || '');
    const canceled = Boolean(params.canceled);
    finishEntry(entry, params, canceled ? 'canceled' : aborted ? 'aborted' : 'failed');
    if (entry) {
      entry.failed = !aborted && !canceled;
      entry.aborted = aborted;
      entry.canceled = canceled;
      entry.errorText = params.errorText;
      entry.blockedReason = params.blockedReason ?? null;
    }
    state.network.requests.delete(params.requestId);
  });

  if (options.console) {
    listen('Runtime.consoleAPICalled', (params: any) => {
      const type = params.type || 'log';
      state.console.counts[type] = (state.console.counts[type] || 0) + 1;
      if (type === 'warning') state.console.counts.warn = (state.console.counts.warn || 0) + 1;
      if (type === 'warn') state.console.counts.warning = (state.console.counts.warning || 0) + 1;
      if (state.console.entries.length >= options.maxConsole) {
        state.console.truncated = true;
        return;
      }
      const args = (params.args || []).map((arg: any) =>
        serializeRemoteObject(arg, options.redact),
      );
      const text = args
        .map((a: any) => (typeof a === 'string' ? a : safeJsonStringify(a)))
        .join(' ');
      state.console.entries.push({
        type,
        text,
        message: text,
        timestamp: params.timestamp,
        args,
        stack: (params.stackTrace?.callFrames || []).slice(0, 5).map((frame: any) => ({
          functionName: frame.functionName || null,
          url: frame.url || null,
          lineNumber: frame.lineNumber,
          columnNumber: frame.columnNumber,
        })),
      });
    });
    listen('Runtime.exceptionThrown', (params: any) => {
      if (state.errors.uncaught.length >= options.maxConsole) return;
      const details = params.exceptionDetails || {};
      state.errors.uncaught.push({
        text:
          details.exception?.description ||
          details.text ||
          details.exception?.value ||
          'Uncaught exception',
        url: details.url || null,
        lineNumber: details.lineNumber ?? null,
        columnNumber: details.columnNumber ?? null,
        stack: (details.stackTrace?.callFrames || []).slice(0, 8).map((frame: any) => ({
          functionName: frame.functionName || null,
          url: frame.url || null,
          lineNumber: frame.lineNumber,
          columnNumber: frame.columnNumber,
        })),
      });
    });
    listen('Log.entryAdded', (params: any) => {
      const entry = params.entry || {};
      if (entry.level === 'error' && state.errors.logErrors.length < options.maxConsole) {
        state.errors.logErrors.push({
          text: entry.text || '',
          url: entry.url || null,
          lineNumber: entry.lineNumber ?? null,
          source: entry.source || null,
        });
      }
    });
  }
  listen('Page.javascriptDialogOpening', (params: any) => {
    if (state.dialogs.length < options.maxConsole) {
      state.dialogs.push({
        type: params.type || null,
        message: params.message || '',
        url: params.url || null,
      });
    }
    cdp.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
  });
  listen('Page.frameNavigated', (params: any) => {
    if (!params.frame?.parentId) {
      state.mainFrameId = params.frame.id || state.mainFrameId;
      state.finalUrl = params.frame.url || state.finalUrl;
    }
  });
  listen('Page.loadEventFired', () => {
    state.loadFired = true;
  });
  return state;
}

export const requestGuards = new WeakMap<any, () => Promise<void>>();

export async function installRequestGuard(
  cdp: CdpClient,
  options: any,
  warnings: string[],
): Promise<() => Promise<void>> {
  await requestGuards.get(cdp)?.();
  const customHeaders = options.headers ?? [];
  const blocks = options.block ?? [];
  const targetParsed = validateTargetUrl(options.url);
  const origin = targetParsed.origin;
  const isInitialTargetPrivate = isPrivateHost(targetParsed.hostname);
  const customNames = new Set(customHeaders.map((header: any) => header.name.toLowerCase()));
  if (customNames.has('host') || customNames.has(':authority')) {
    throw new UsageError('--header may not override routing headers');
  }
  const pending = new Set<Promise<void>>();
  let disposePromise: Promise<void> | undefined;
  const failRequest = async (requestId: string) => {
    try {
      await cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } catch {
      // An unresolved pause must not be resumed with potentially leaked headers.
      cdp.close();
    }
  };
  const handle = async (params: any) => {
    const requestId = params.requestId;
    try {
      let url: URL;
      try {
        url = new URL(params.request?.url);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          await validateResolvedTargetUrl(url.toString(), { timeoutMs: options.timeoutMs });
          if (!isInitialTargetPrivate && isPrivateHost(url.hostname)) {
            warnings.push(`Blocked navigation to private host ${url.hostname} from public origin.`);
            await failRequest(requestId);
            return;
          }
        } else if (!['about:', 'data:', 'blob:'].includes(url.protocol)) {
          await failRequest(requestId);
          return;
        }
      } catch {
        await failRequest(requestId);
        return;
      }
      if (!customHeaders.length) {
        await cdp.send('Fetch.continueRequest', { requestId });
        return;
      }
      // Strip our custom names before adding them for this exact origin. Apply
      // on every redirect hop; never use global Network.setExtraHTTPHeaders.
      const headers = Object.entries(params.request?.headers ?? {})
        .filter(([name]) => !customNames.has(name.toLowerCase()))
        .map(([name, value]) => ({ name, value: String(value) }));
      if (url.origin === origin) {
        for (const header of customHeaders)
          headers.push({ name: header.name, value: header.value });
      }
      await cdp.send('Fetch.continueRequest', { requestId, headers });
    } catch {
      warnings.push(
        'Request interception failed; request denied rather than forwarding custom headers.',
      );
      await failRequest(requestId);
    }
  };
  const off = cdp.on('Fetch.requestPaused', (params: any) => {
    const task = handle(params);
    pending.add(task);
    task.finally(() => pending.delete(task)).catch(() => {});
  });
  const dispose = () => {
    disposePromise ??= (async () => {
      // Keep the handler active until disabling releases any final pauses.
      try {
        await Promise.allSettled([...pending]);
        await cdp.send('Fetch.disable');
      } catch {
        cdp.close();
      } finally {
        off();
        if (requestGuards.get(cdp) === dispose) requestGuards.delete(cdp);
      }
    })();
    return disposePromise;
  };
  try {
    // Avoid inherited browser-wide headers and service worker forwarding paths.
    await cdp.send('Network.setExtraHTTPHeaders', { headers: {} });
    if (customHeaders.length) await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    if (blocks.length) await cdp.send('Network.setBlockedURLs', { urls: blocks });
    const patterns =
      customHeaders.length || blocks.length
        ? [{ urlPattern: '*', requestStage: 'Request' }]
        : [{ urlPattern: '*', requestStage: 'Request', resourceType: 'Document' }];
    await cdp.send('Fetch.enable', { patterns });
    requestGuards.set(cdp, dispose);
    if (!customHeaders.length && !blocks.length) {
      warnings.push(
        'Request interception guard is active for document navigations to block SSRF and cloud metadata exfiltration.',
      );
    } else {
      warnings.push(
        'Opt-in request interception validates paused request DNS and scopes custom headers by exact origin; it does not pin DNS or guarantee DNS rebinding protection.',
      );
    }
    return dispose;
  } catch {
    await dispose();
    throw new InspectorError(
      'Request interception guard could not be established safely; navigation refused.',
      'INTERCEPTION_SETUP_FAILED',
    );
  }
}

export async function preparePage(
  cdp: CdpClient,
  options: any,
  warnings: string[],
): Promise<() => Promise<void>> {
  await validateResolvedTargetUrl(options.url, { timeoutMs: options.timeoutMs });
  await cdp.send('Page.enable');
  try {
    await cdp.send('Page.setDownloadBehavior', { behavior: 'deny' });
  } catch {
    try {
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    } catch {}
  }
  await cdp.send('Runtime.enable');
  // Network.enable is observational and needed for idle/status even when the
  // user disables retaining network telemetry.
  await cdp.send('Network.enable', {
    maxTotalBufferSize: 10_000_000,
    maxResourceBufferSize: 5_000_000,
  });
  try {
    await cdp.send('Log.enable');
  } catch {
    warnings.push('Log domain unavailable');
  }
  try {
    await cdp.send('Performance.enable');
  } catch {
    warnings.push('Performance domain unavailable');
  }

  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: options.viewport.width,
      height: options.viewport.height,
      deviceScaleFactor: options.viewport.dpr,
      mobile: Boolean(options.viewport.mobile),
      screenWidth: options.viewport.width,
      screenHeight: options.viewport.height,
    });
  } catch (error: any) {
    warnings.push(`Viewport emulation failed: ${error.message}`);
  }
  if (options.touch || options.viewport.mobile) {
    try {
      await cdp.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 5,
      });
    } catch {
      warnings.push('Touch emulation unavailable');
    }
  }
  if (options.userAgent) {
    try {
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: options.userAgent,
      });
    } catch {
      warnings.push('User-Agent override unavailable');
    }
  }
  if (options.colorScheme || options.reducedMotion) {
    const features: any[] = [];
    if (options.colorScheme) {
      features.push({ name: 'prefers-color-scheme', value: options.colorScheme });
    }
    if (options.reducedMotion) {
      features.push({ name: 'prefers-reduced-motion', value: options.reducedMotion });
    }
    try {
      await cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features });
    } catch {
      warnings.push('Media emulation unavailable');
    }
  }
  if (options.timezone) {
    try {
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: options.timezone });
    } catch {
      warnings.push(`Timezone override failed: ${options.timezone}`);
    }
  }
  if (options.locale) {
    try {
      await cdp.send('Emulation.setLocaleOverride', { locale: options.locale });
    } catch {
      warnings.push(`Locale override failed: ${options.locale}`);
    }
  }
  if (options.disableCache) {
    try {
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    } catch {
      warnings.push('Cache could not be disabled');
    }
  }

  return installRequestGuard(cdp, options, warnings);
}

export async function waitForLoad(
  state: CaptureState,
  options: { timeoutMs: number },
  warnings?: string[],
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (!state.loadFired && Date.now() < deadline) {
    await sleep(50);
  }
  if (!state.loadFired) {
    if (state.mainFrameId && warnings) {
      warnings.push(
        `Navigation load event timed out after ${options.timeoutMs}ms; proceeding with available DOM`,
      );
      return;
    }
    throw new InspectorError(
      `Navigation did not reach the load event within ${options.timeoutMs}ms`,
      'NAVIGATION_TIMEOUT',
    );
  }
}

export async function waitForSelector(
  cdp: CdpClient,
  selector: string | undefined,
  options: { timeoutMs: number },
): Promise<boolean> {
  if (!selector) return true;
  const deadline = Date.now() + options.timeoutMs;
  const expression = `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
  while (Date.now() < deadline) {
    try {
      const found = await evaluate(cdp, expression, options, {
        timeoutMs: Math.min(5_000, options.timeoutMs),
      });
      if (found) return true;
    } catch {
      // The execution context may be replaced during a navigation; retry.
    }
    await sleep(100);
  }
  return false;
}

export async function waitForNetworkIdle(
  state: CaptureState,
  options: { networkIdle?: boolean; timeoutMs: number; idleMs: number },
): Promise<boolean> {
  if (!options.networkIdle) return true;
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const now = Date.now();
    if (state.inflight === 0 && now - state.lastNetworkActivity >= options.idleMs) return true;
    await sleep(Math.min(50, Math.max(1, deadline - now)));
  }
  return false;
}
