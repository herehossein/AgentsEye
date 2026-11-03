import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS } from '../config/constants.js';
import { redactValueForKey } from '../security/redaction.js';
import { resolveSafePath, assertFileDoesNotExist } from '../security/path-guard.js';
import { writeFileSecure, parsePngSize } from '../utils/helpers.js';
import { inPagePerformanceObserver } from '../probes/perf-observer-probe.js';
import { CdpClient, evaluate } from './client.js';

export async function collectCookies(cdp: CdpClient, finalUrl: string, options: any): Promise<any> {
  try {
    const result = await cdp.send('Network.getCookies', { urls: [finalUrl] });
    const cookies = Array.isArray(result.cookies) ? result.cookies : [];
    return {
      count: cookies.length,
      entries: cookies.slice(0, DEFAULTS.maxStorage).map((cookie: any) => ({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : null,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite ?? null,
        session: cookie.session,
        size: cookie.size,
        value: options.showCookies
          ? options.redact === 'none'
            ? cookie.value
            : redactValueForKey(cookie.name, cookie.value, options.redact)
          : undefined,
      })),
      truncated: cookies.length > DEFAULTS.maxStorage,
    };
  } catch (error: any) {
    return { count: 0, entries: [], error: error.message };
  }
}

export async function collectA11y(cdp: CdpClient, options: any, warnings: string[]): Promise<any> {
  if (!options.a11y) return null;
  try {
    await cdp.send('Accessibility.enable');
    const result = await cdp.send('Accessibility.getFullAXTree', { depth: -1 });
    const nodes = Array.isArray(result.nodes) ? result.nodes : [];
    const importantProperties = new Set([
      'level',
      'checked',
      'expanded',
      'disabled',
      'required',
      'focused',
      'modal',
      'valuetext',
      'valuemin',
      'valuemax',
    ]);
    // Static text nodes duplicate DOM text (already inspected and redacted) and
    // can expose sensitive form values as accessibility names.
    const ignoredRoles = new Set(['StaticText', 'InlineTextBox', 'LineBreak']);
    const visibleNodes = nodes.filter(
      (node: any) => !node.ignored && !ignoredRoles.has(node.role?.value)
    );
    const filtered = visibleNodes.slice(0, options.maxA11y);
    return {
      count: visibleNodes.length,
      truncated: visibleNodes.length > filtered.length,
      nodes: filtered.map((node: any) => ({
        nodeId: node.nodeId,
        role: node.role?.value ?? null,
        accessibleName: node.name?.value ?? null,
        description: node.description?.value ?? null,
        properties: Object.fromEntries(
          (node.properties || [])
            .filter((property: any) => importantProperties.has(property.name))
            .map((property: any) => [property.name, property.value?.value ?? property.value?.type ?? null])
        ),
      })),
    };
  } catch (error: any) {
    warnings.push(`Accessibility tree unavailable: ${error.message}`);
    return null;
  }
}

export async function collectFrameTree(cdp: CdpClient, warnings: string[]): Promise<any[]> {
  try {
    const tree = await cdp.send('Page.getFrameTree');
    const frames: any[] = [];
    const walk = (node: any) => {
      if (!node?.frame) return;
      frames.push({
        id: node.frame.id,
        parentId: node.frame.parentId ?? null,
        url: node.frame.url ?? null,
        name: node.frame.name ?? null,
        securityOrigin: node.frame.securityOrigin ?? null,
        mimeType: node.frame.mimeType ?? null,
        unreachableUrl: node.frame.unreachableUrl ?? null,
      });
      for (const child of node.childFrames || []) walk(child);
    };
    walk(tree.frameTree);
    return frames;
  } catch (error: any) {
    warnings.push(`Frame tree unavailable: ${error.message}`);
    return [];
  }
}

export async function installPerformanceObservers(cdp: CdpClient, warnings: string[] = []): Promise<string | null> {
  try {
    const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(${inPagePerformanceObserver.toString()})()`,
    });
    return result.identifier ?? null;
  } catch (error: any) {
    warnings.push(`Performance observers could not be installed before navigation: ${error.message}`);
    return null;
  }
}

export async function collectPerformance(cdp: CdpClient, _page: any, warnings: string[]): Promise<any> {
  const fromPage: any = {
    timeOrigin: null,
    navigation: null,
    paints: null,
    resources: null,
    webVitals: { lcp: null, cls: null, fcp: null, fid: null, inp: null },
    observers: { installed: false, supported: {}, observed: {}, entries: [] },
  };
  try {
    const evaluated = await evaluate(
      cdp,
      `(() => {
        const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
        const paints = performance.getEntriesByType ? performance.getEntriesByType('paint') : [];
        const resources = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
        const observers = (globalThis.__agentsEyePerformanceV1 || globalThis.__runtimeInspectorPerformanceV1)?.drain() || {
          installed: false, supported: {}, observed: {}, entries: [],
        };
        const observedVitals = observers.values || {};
        const fcp = paints.find((entry) => entry.name === 'first-contentful-paint');
        const webVitals = {
          lcp: observedVitals.lcp ?? null,
          cls: observedVitals.cls ?? null,
          fcp: observedVitals.fcp ?? fcp?.startTime ?? null,
          fid: observedVitals.fid ?? null,
          inp: observedVitals.inp ?? null,
        };
        return {
          webVitals,
          observers,
          timeOrigin: performance.timeOrigin ?? null,
          navigation: nav ? {
            type: nav.type,
            startTime: nav.startTime,
            duration: nav.duration,
            domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
            loadEventEnd: nav.loadEventEnd,
            transferSize: nav.transferSize,
            encodedBodySize: nav.encodedBodySize,
            decodedBodySize: nav.decodedBodySize,
            redirectCount: nav.redirectCount,
          } : null,
          paints: paints.map((p) => ({ name: p.name, startTime: p.startTime })),
          resources: {
            count: resources.length,
            transferSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
          },
          memory: performance.memory ? {
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            usedJSHeapSize: performance.memory.usedJSHeapSize,
          } : null,
        };
      })()`,
      { timeoutMs: 10_000 }
    );
    Object.assign(fromPage, evaluated || {});
    if (!fromPage.observers.installed) {
      warnings.push('Performance observers were not installed before navigation; unobserved web vitals are null.');
    }
    for (const error of fromPage.observers.errors || []) warnings.push(`Performance observer: ${error}`);
  } catch (error: any) {
    warnings.push(`Page performance entries unavailable: ${error.message}`);
  }

  let cdpMetrics: any = null;
  try {
    const metrics = await cdp.send('Performance.getMetrics');
    const wanted = new Set([
      'Timestamp',
      'Documents',
      'Frames',
      'JSEventListeners',
      'Nodes',
      'LayoutCount',
      'RecalcStyleCount',
      'LayoutDuration',
      'RecalcStyleDuration',
      'ScriptDuration',
      'TaskDuration',
      'JSHeapUsedSize',
      'JSHeapTotalSize',
    ]);
    cdpMetrics = Object.fromEntries(
      (metrics.metrics || [])
        .filter((metric: any) => wanted.has(metric.name))
        .map((metric: any) => [metric.name, metric.value])
    );
  } catch (error: any) {
    warnings.push(`CDP performance metrics unavailable: ${error.message}`);
  }

  return { page: fromPage, cdp: cdpMetrics };
}

export async function takeScreenshot(cdp: CdpClient, options: any, warnings: string[]): Promise<any[]> {
  if (!options.screenshot) return [];
  const format = options.screenshotFormat;
  const quality =
    format === 'png' ? undefined : Math.max(0, Math.min(100, options.screenshotQuality));
  const params: any = {
    format,
    fromSurface: true,
    captureBeyondViewport: Boolean(options.fullPage),
  };
  if (quality !== undefined) params.quality = quality;

  if (options.fullPage) {
    try {
      const metrics = await cdp.send('Page.getLayoutMetrics');
      const content = metrics.cssContentSize || metrics.contentSize;
      if (content) {
        const maxDimension = 16_000;
        const width = Math.min(content.width, maxDimension);
        const height = Math.min(content.height, maxDimension);
        if (content.width > maxDimension || content.height > maxDimension) {
          warnings.push(
            `Full-page screenshot clipped to ${maxDimension}px (content ${Math.round(content.width)}x${Math.round(content.height)})`
          );
        }
        params.clip = { x: 0, y: 0, width, height, scale: 1 };
      }
    } catch (error: any) {
      warnings.push(`Full-page metrics unavailable: ${error.message}`);
    }
  }

  let result: any;
  try {
    result = await cdp.send('Page.captureScreenshot', params, {
      timeoutMs: Math.max(options.timeoutMs, 30_000),
    });
  } catch (error: any) {
    warnings.push(`Screenshot failed: ${error.message}`);
    return [];
  }
  if (!result?.data) {
    warnings.push('Screenshot returned no data');
    return [];
  }

  const buffer = Buffer.from(result.data, 'base64');
  let filePath = resolveSafePath(options.screenshot, options, '--screenshot');
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    filePath = path.join(filePath, `screenshot-${stamp}.${format}`);
  }
  assertFileDoesNotExist(filePath);
  await writeFileSecure(filePath, buffer);
  const pngSize = format === 'png' ? parsePngSize(buffer) : null;
  return [
    {
      role: 'artifact',
      path: filePath,
      format,
      bytes: buffer.length,
      fullPage: Boolean(options.fullPage),
      width: pngSize?.width ?? null,
      height: pngSize?.height ?? null,
    },
  ];
}
