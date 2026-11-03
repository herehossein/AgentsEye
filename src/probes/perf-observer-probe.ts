// @ts-nocheck
export function inPagePerformanceObserver() {
  const slot = '__agentsEyePerformanceV1';
  if (globalThis[slot]) return;
  const values = { lcp: null, cls: null, fcp: null, fid: null, inp: null };
  const supported = {};
  const observed = {};
  const errors = [];
  const entries = [];
  const observers = [];
  const interactions = new Map();
  const interactionIds = new Set();
  let clsWindow = null;
  let lcpFinalized = false;
  let hidden = document.visibilityState === 'hidden';
  let firstHiddenTime = hidden ? 0 : Infinity;
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const note = (type, entry, value) => {
    observed[type] = (observed[type] || 0) + 1;
    entries.push({ type, name: entry.name || null, startTime: entry.startTime,
      duration: finite(entry.duration) ? entry.duration : null, value });
    if (entries.length > 80) entries.shift();
  };
  const interactionCount = () => finite(performance.interactionCount)
    ? performance.interactionCount : interactionIds.size;
  const updateInp = (entry) => {
    if (!entry.interactionId || !finite(entry.duration) || entry.duration < 0) return;
    if (interactionIds.size < 10_000) interactionIds.add(entry.interactionId);
    interactions.set(entry.interactionId, Math.max(interactions.get(entry.interactionId) || 0, entry.duration));
    if (interactions.size > 200) {
      const smallest = [...interactions].sort((a, b) => a[1] - b[1])[0];
      interactions.delete(smallest[0]);
    }
    const durations = [...interactions.values()].sort((a, b) => b - a);
    // The worst interaction, dropping one outlier per 50 actual interactions
    // (98th percentile). Never infer an unobserved interaction duration of zero.
    values.inp = durations[Math.floor(interactionCount() / 50)] ?? null;
  };
  const handlers = {
    'largest-contentful-paint': (list) => {
      if (lcpFinalized) return;
      for (const entry of list) {
        if (finite(entry.startTime) && entry.startTime < firstHiddenTime) {
          values.lcp = entry.startTime;
          note('largest-contentful-paint', entry, values.lcp);
        }
      }
    },
    'layout-shift': (list) => {
      for (const entry of list) {
        if (entry.hadRecentInput || !finite(entry.value) || !finite(entry.startTime)) continue;
        // Session windows: gap < 1 second, total duration < 5 seconds.
        if (!clsWindow || entry.startTime - clsWindow.last >= 1000 || entry.startTime - clsWindow.start >= 5000) {
          clsWindow = { start: entry.startTime, last: entry.startTime, value: entry.value };
        } else { clsWindow.value += entry.value; clsWindow.last = entry.startTime; }
        values.cls = Math.max(values.cls ?? 0, clsWindow.value);
        note('layout-shift', entry, entry.value);
      }
    },
    paint: (list) => {
      for (const entry of list) {
        if (entry.name === 'first-contentful-paint' && finite(entry.startTime) && entry.startTime < firstHiddenTime) {
          values.fcp = entry.startTime;
          note('paint', entry, values.fcp);
        }
      }
    },
    'first-input': (list) => {
      for (const entry of list) {
        if (values.fid === null && finite(entry.processingStart) && finite(entry.startTime) && entry.startTime < firstHiddenTime) {
          values.fid = Math.max(0, entry.processingStart - entry.startTime);
          note('first-input', entry, values.fid);
        }
        if (supported.event) updateInp(entry);
      }
    },
    event: (list) => {
      for (const entry of list) {
        if (entry.interactionId && finite(entry.duration)) {
          updateInp(entry);
          note('event', entry, entry.duration);
        }
      }
    },
  };
  const drain = () => {
    for (const { observer, type } of observers) {
      try { handlers[type](observer.takeRecords()); } catch (error) { errors.push(String(error.message)); }
    }
    // interactionCount can advance even when sub-threshold events aren't emitted.
    if (interactions.size) {
      const durations = [...interactions.values()].sort((a, b) => b - a);
      values.inp = durations[Math.floor(interactionCount() / 50)] ?? null;
    }
    return { installed: true, values: { ...values }, supported: { ...supported }, observed: { ...observed },
      entries: entries.slice(), errors: errors.slice(0, 20), interactionCount: interactionCount(),
      inpEstimated: !finite(performance.interactionCount),
      inpDurationThreshold: supported.event ? 16 : null,
      provisional: { lcp: !lcpFinalized, cls: !hidden, inp: !hidden },
      scope: 'main-frame document lifetime; no cross-origin iframe or BFCache aggregation' };
  };
  Object.defineProperty(globalThis, slot, { value: { drain }, configurable: true });
  for (const type of Object.keys(handlers)) {
    supported[type] = false;
    try {
      if (typeof PerformanceObserver !== 'function' || !PerformanceObserver.supportedEntryTypes?.includes(type)) continue;
      const observer = new PerformanceObserver((list) => handlers[type](list.getEntries()));
      observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
      supported[type] = true;
      observers.push({ observer, type });
    } catch (error) { errors.push(`${type}: ${error.message}`); }
  }
  const finalizeLcp = (event) => {
    if (event && !event.isTrusted) return;
    drain();
    lcpFinalized = true;
    observers.find((item) => item.type === 'largest-contentful-paint')?.observer.disconnect();
  };
  document.addEventListener('pointerdown', finalizeLcp, { capture: true, once: true });
  document.addEventListener('keydown', finalizeLcp, { capture: true, once: true });
  document.addEventListener('visibilitychange', () => {
    hidden = document.visibilityState === 'hidden';
    if (hidden) {
      firstHiddenTime = Math.min(firstHiddenTime, performance.now());
      finalizeLcp();
    }
  }, { capture: true });
  globalThis.addEventListener('pagehide', () => { hidden = true; finalizeLcp(); }, { capture: true });
}
