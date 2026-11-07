import { sleep } from '../utils/helpers.js';
import { CdpClient, evaluate } from '../cdp/client.js';
import { waitForSelector } from '../cdp/capture.js';
import { inPageProbe, makeProbeConfig } from '../probes/dom-probe.js';
import { interactionSafety, inPageInteractionProbe } from '../probes/interaction-probe.js';
import { formatInteractiveTreeText } from '../reporting/formatters.js';

export const DOM_CLEANUP_SCRIPT = `(() => {
  try {
    const scrub = (root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('[data-agentseye-ref]').forEach((el) => {
        el.removeAttribute('data-agentseye-ref');
      });
      root.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) scrub(el.shadowRoot);
      });
    };
    scrub(document);
    if (globalThis.__agentsEyeRefsV1) {
      globalThis.__agentsEyeRefsV1.map?.clear();
      delete globalThis.__agentsEyeRefsV1;
    }
  } catch {}
})()`;

export async function cleanupDomRefs(cdp: CdpClient, evaluationOptions: any = {}): Promise<void> {
  try {
    await evaluate(cdp, DOM_CLEANUP_SCRIPT, evaluationOptions);
  } catch {}
}

export function diffInteractionSnapshots(before: any, after: any): any {
  if (!before || !after) return null;
  const previous = new Map((before.nodes || []).map((node: any) => [node.id, node]));
  const next = new Map((after.nodes || []).map((node: any) => [node.id, node]));
  const added = [...next.values()].filter((node: any) => !previous.has(node.id));
  const removed = [...previous.values()].filter((node: any) => !next.has(node.id));
  const layoutChanged: any[] = [];
  const stateChanged: any[] = [];
  for (const [id, node] of next as any) {
    const old: any = previous.get(id);
    if (!old) continue;
    if (
      ['x', 'y', 'width', 'height'].some(
        (key) => Math.abs((node.rect?.[key] || 0) - (old.rect?.[key] || 0)) > 0.5,
      )
    ) {
      layoutChanged.push({ id, before: old.rect, after: node.rect });
    }
    const changes: Record<string, any> = {};
    const stateKeys = new Set([
      'visible',
      'expanded',
      'selected',
      'display',
      'visibility',
      'position',
      'name',
      'disabled',
      'class',
      'className',
      'aria-expanded',
    ]);
    for (const key of Object.keys(node)) {
      if (!['id', 'rect', 'tag'].includes(key)) stateKeys.add(key);
    }
    for (const key of Object.keys(old)) {
      if (!['id', 'rect', 'tag'].includes(key)) stateKeys.add(key);
    }
    for (const key of stateKeys) {
      if (old[key] !== node[key])
        changes[key] = { before: old[key] ?? null, after: node[key] ?? null };
    }
    if (Object.keys(changes).length) stateChanged.push({ id, changes });
  }

  const getConsoleList = (snap: any) => {
    if (!snap) return [];
    if (Array.isArray(snap.console)) return snap.console;
    if (Array.isArray(snap.console?.entries)) return snap.console.entries;
    if (Array.isArray(snap.events)) return snap.events;
    return [];
  };
  const beforeConsole = getConsoleList(before);
  const afterConsole = getConsoleList(after);
  const consoleEvents = afterConsole.slice(beforeConsole.length);
  const consoleErrors = consoleEvents.filter((e: any) =>
    ['error', 'assert'].includes(String(e.type || e.level || '').toLowerCase()),
  );
  const consoleWarnings = consoleEvents.filter((e: any) =>
    ['warn', 'warning'].includes(String(e.type || e.level || '').toLowerCase()),
  );

  const getErrorList = (snap: any) => {
    if (!snap) return [];
    if (Array.isArray(snap.errors)) return snap.errors;
    const list: any[] = [];
    if (Array.isArray(snap.errors?.uncaught)) list.push(...snap.errors.uncaught);
    if (Array.isArray(snap.errors?.logErrors)) list.push(...snap.errors.logErrors);
    return list;
  };
  const beforeErrors = getErrorList(before);
  const afterErrors = getErrorList(after);
  const newErrors = [...afterErrors.slice(beforeErrors.length), ...consoleErrors];

  const urlChanged = Boolean(before.url && after.url && before.url !== after.url);
  const navigationChanged =
    before.documentToken !== after.documentToken ||
    before.navigationToken !== after.navigationToken ||
    urlChanged;
  const scrollChanged =
    before.scroll?.x !== after.scroll?.x || before.scroll?.y !== after.scroll?.y;

  const summary = {
    added: added.length,
    removed: removed.length,
    layoutChanged: layoutChanged.length,
    stateChanged: stateChanged.length,
    navigationChanged,
    scrollChanged,
    urlChanged,
    newErrors: newErrors.length,
    consoleEvents: consoleEvents.length,
  };
  return {
    summary,
    added,
    removed,
    layoutChanged,
    stateChanged,
    navigationChanged,
    scrollChanged,
    urlChanged,
    console: consoleEvents,
    consoleEvents,
    newErrors,
    newWarnings: consoleWarnings,
    truncated: Boolean(before.truncated || after.truncated),
  };
}

export function interactionKeyDefinition(value: unknown): any {
  const key = String(value);
  const definitions: Record<string, [number, string, string, string?]> = {
    Enter: [13, 'Enter', 'Enter', '\r'],
    Escape: [27, 'Escape', 'Escape'],
    Tab: [9, 'Tab', 'Tab'],
    Space: [32, ' ', 'Space', ' '],
    ArrowLeft: [37, 'ArrowLeft', 'ArrowLeft'],
    ArrowUp: [38, 'ArrowUp', 'ArrowUp'],
    ArrowRight: [39, 'ArrowRight', 'ArrowRight'],
    ArrowDown: [40, 'ArrowDown', 'ArrowDown'],
    Home: [36, 'Home', 'Home'],
    End: [35, 'End', 'End'],
    PageUp: [33, 'PageUp', 'PageUp'],
    PageDown: [34, 'PageDown', 'PageDown'],
  };
  const definition = Object.hasOwn(definitions, key) ? definitions[key] : null;
  if (!definition) return null;
  const [codeNumber, keyName, code, text] = definition;
  return {
    key: keyName,
    code,
    windowsVirtualKeyCode: codeNumber,
    nativeVirtualKeyCode: codeNumber,
    ...(text ? { text, unmodifiedText: text } : {}),
  };
}

export async function performInteractions(
  cdp: CdpClient,
  options: any,
  beforeProbe: any = null,
): Promise<any> {
  const requested = Array.isArray(options.actions) ? options.actions : [];
  const enabled = Boolean(options.explore || requested.length);
  const warning = options.explore
    ? '--explore clicks UI controls and can have application side effects. Read-only is the default; --allow-destructive only disables the text blacklist, not navigation/submission safeguards.'
    : 'Explicit interactions can have application side effects. Read-only is the default.';
  const telemetry: any = {
    enabled,
    readOnly: !enabled,
    warnings: enabled ? [warning] : [],
    actions: [],
    exploration: {
      enabled: Boolean(options.explore),
      limit: 0,
      attempted: 0,
      performed: 0,
      skipped: [],
      stoppedReason: null,
    },
    beforeSnapshot: null,
    afterSnapshot: null,
    diff: null,
    finalProbe: beforeProbe,
  };
  if (!enabled) return telemetry;
  const evaluationOptions = { ...options, timeoutMs: options.timeoutMs ?? 10_000 };
  const probe = (command: any, timeoutMs = evaluationOptions.timeoutMs) =>
    evaluate(
      cdp,
      `(${inPageInteractionProbe.toString()})(${JSON.stringify({
        ...command,
        allowDestructive: Boolean(options.allowDestructive),
      })}, (${interactionSafety.toString()}))`,
      evaluationOptions,
      { timeoutMs },
    );
  let baseline: any;
  try {
    baseline = await probe({ op: 'snapshot' });
    const beforeInteractive = beforeProbe?.interactive || null;
    const beforeTreeText = beforeInteractive?.items
      ? formatInteractiveTreeText(beforeInteractive.items)
      : '';
    telemetry.beforeSnapshot = {
      ...baseline,
      interactive: beforeInteractive,
      interactiveTreeText: beforeTreeText,
    };
    telemetry.afterSnapshot = {
      ...baseline,
      interactive: beforeInteractive,
      interactiveTreeText: beforeTreeText,
    };
  } catch (error: any) {
    telemetry.warnings.push(
      `Interaction snapshot unavailable; no inputs dispatched: ${error.message}`,
    );
    return telemetry;
  }
  const sameDocument = (snapshot: any) =>
    snapshot &&
    snapshot.documentToken === baseline.documentToken &&
    snapshot.navigationToken === baseline.navigationToken;
  let stop = false;
  let inputSent = false;
  const run = async (action: any, automatic = false, candidate: any = null) => {
    const record: any = {
      type: action.type,
      value: String(action.value ?? ''),
      automatic,
      status: 'skipped',
      reason: null,
      target: null,
      before: telemetry.afterSnapshot,
      after: null,
      diff: null,
    };
    telemetry.actions.push(record);
    try {
      const live = await probe({ op: 'snapshot' });
      record.before = live;
      if (!sameDocument(live)) {
        stop = true;
        record.reason = 'Document or URL changed; remaining interactions stopped';
        return;
      }
      if (action.type === 'click' || action.type === 'hover') {
        let target = await probe({
          op: 'target',
          type: action.type,
          selector: action.value,
          id: candidate?.id,
          automatic,
        });
        record.target = target?.target || null;
        if (!sameDocument(target)) {
          stop = true;
          record.reason = 'Document changed';
          return;
        }
        if (target.reason) {
          record.reason = target.reason;
          return;
        }
        inputSent = true;
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          ...target.point,
          button: 'none',
        });
        // Mouse movement itself can expose overlays or replace a target. Never
        // use cached coordinates or resolve a replacement by selector for a click.
        if (action.type === 'click') {
          target = await probe({ op: 'verify', id: target.target.id, automatic });
          if (!sameDocument(target)) {
            stop = true;
            record.reason = 'Document changed during hover';
            return;
          }
          if (target.reason) {
            record.reason = target.reason;
            return;
          }
          try {
            await cdp.send('Input.dispatchMouseEvent', {
              type: 'mousePressed',
              ...target.point,
              button: 'left',
              buttons: 1,
              clickCount: 1,
            });
          } finally {
            // Release even if the pressed command fails after delivery.
            await cdp.send('Input.dispatchMouseEvent', {
              type: 'mouseReleased',
              ...target.point,
              button: 'left',
              buttons: 0,
              clickCount: 1,
            });
          }
        }
      } else if (action.type === 'scroll') {
        const valStr = String(action.value ?? '').trim();
        const deltaMatch =
          /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(
            valStr,
          );
        if (deltaMatch) {
          const deltaX = Number(deltaMatch[1]);
          const deltaY = Number(deltaMatch[2]);
          if (
            ![deltaX, deltaY].every(Number.isFinite) ||
            Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 100_000
          ) {
            record.reason = 'Scroll requires finite X,Y deltas within 100000 pixels';
            return;
          }
          inputSent = true;
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: Math.max(0, (live.viewport.width - 1) / 2),
            y: Math.max(0, (live.viewport.height - 1) / 2),
            deltaX,
            deltaY,
          });
        } else {
          const scrollRes = await probe({
            op: 'scrollIntoView',
            selector: valStr,
          });
          if (!sameDocument(scrollRes)) {
            stop = true;
            record.reason = 'Document changed';
            return;
          }
          if (scrollRes.reason) {
            record.reason = scrollRes.reason;
            return;
          }
          record.target = scrollRes.target || null;
          inputSent = true;
        }
      } else if (action.type === 'key') {
        const definition = interactionKeyDefinition(action.value);
        if (!definition) {
          record.reason =
            'Unsupported key; only navigation keys, Enter, Space, Tab and Escape are accepted';
          return;
        }
        const keySafety = await probe({ op: 'keySafety', key: action.value });
        if (!sameDocument(keySafety)) {
          stop = true;
          record.reason = 'Document changed';
          return;
        }
        if (keySafety.reason) {
          record.reason = keySafety.reason;
          return;
        }
        inputSent = true;
        const { text: _text, unmodifiedText: _unmodifiedText, ...release } = definition;
        try {
          await cdp.send('Input.dispatchKeyEvent', {
            type: definition.text ? 'keyDown' : 'rawKeyDown',
            ...definition,
          });
        } finally {
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...release });
        }
      } else {
        record.reason = 'Unsupported interaction type';
        return;
      }
      record.status = 'performed';
      await sleep(150);
    } catch (error: any) {
      record.status = 'failed';
      record.reason = error.message;
      // An uncertain dispatch must never be followed by more automatic inputs.
      stop = true;
    } finally {
      try {
        record.after = await probe({ op: 'snapshot' });
        record.diff = diffInteractionSnapshots(record.before, record.after);
        telemetry.afterSnapshot = record.after;
        if (!sameDocument(record.after)) {
          stop = true;
          telemetry.warnings.push(
            'Interaction changed the document or URL; remaining inputs were stopped.',
          );
        }
      } catch (error: any) {
        telemetry.warnings.push(`Post-interaction snapshot unavailable: ${error.message}`);
        stop = true;
      }
    }
  };
  if (requested.length > 100)
    telemetry.warnings.push('Explicit actions capped at 100 per inspection.');
  for (const action of requested.slice(0, 100)) {
    if (stop) break;
    await run(action);
  }
  if (options.explore && !stop) {
    const limit = Math.max(
      0,
      Math.min(50, Number.isFinite(options.maxExplore) ? Math.floor(options.maxExplore) : 8),
    );
    telemetry.exploration.limit = limit;
    const visited = new Set<string>();
    for (let i = 0; i < limit && !stop; i += 1) {
      let scan: any;
      try {
        scan = await probe({ op: 'scan' });
      } catch (error: any) {
        telemetry.warnings.push(`Exploration scan failed: ${error.message}`);
        stop = true;
        break;
      }
      if (!sameDocument(scan)) {
        stop = true;
        break;
      }
      for (const skipped of scan.skipped || []) {
        if (
          !telemetry.exploration.skipped.some(
            (item: any) => item.target.id === skipped.target.id,
          ) &&
          telemetry.exploration.skipped.length < 100
        ) {
          telemetry.exploration.skipped.push(skipped);
        }
      }
      const candidate = scan.candidates.find((item: any) => !visited.has(item.id));
      if (!candidate) break;
      visited.add(candidate.id);
      telemetry.exploration.attempted += 1;
      await run({ type: 'click', value: candidate.name || candidate.tag }, true, candidate);
      if (telemetry.actions.at(-1)?.status === 'performed') telemetry.exploration.performed += 1;
    }
  }
  const lastAction = telemetry.actions.at(-1);
  if (
    options.waitAfter &&
    !stop &&
    lastAction?.status === 'performed' &&
    telemetry.actions.some((action: any) => !action.automatic && action.status === 'performed')
  ) {
    let waitWarning: string | null = null;
    try {
      const found = await waitForSelector(
        cdp,
        options.waitAfter,
        evaluationOptions,
        async (timeoutMs) => {
          if (!sameDocument(await probe({ op: 'context' }, timeoutMs)))
            throw new Error('Document or URL changed');
        },
      );
      if (!found)
        waitWarning = `--wait-after selector did not appear before timeout: ${options.waitAfter}`;
    } catch (error: any) {
      waitWarning = `--wait-after stopped: ${error.message}`;
    }
    try {
      lastAction.after = await probe({ op: 'snapshot' });
      lastAction.diff = diffInteractionSnapshots(lastAction.before, lastAction.after);
      telemetry.afterSnapshot = lastAction.after;
      if (!sameDocument(lastAction.after)) {
        stop = true;
        // Navigation can race the final negative selector poll at the deadline.
        waitWarning = '--wait-after stopped: Document or URL changed';
        telemetry.warnings.push(
          'Interaction changed the document or URL; remaining inputs were stopped.',
        );
      }
    } catch (error: any) {
      waitWarning = `--wait-after stopped: Post-wait interaction snapshot unavailable: ${error.message}`;
      stop = true;
    }
    if (waitWarning) telemetry.warnings.push(waitWarning);
  }
  if (stop)
    telemetry.exploration.stoppedReason =
      'Stopped after navigation, document replacement, or an uncertain interaction';
  telemetry.diff = diffInteractionSnapshots(telemetry.beforeSnapshot, telemetry.afterSnapshot);
  if (inputSent && beforeProbe) {
    try {
      telemetry.finalProbe = await evaluate(
        cdp,
        `(${inPageProbe.toString()})(${JSON.stringify(makeProbeConfig(options))})`,
        evaluationOptions,
        { timeoutMs: Math.max(evaluationOptions.timeoutMs, 45_000) },
      );
      if (telemetry.finalProbe?.interactive) {
        telemetry.afterSnapshot = {
          ...telemetry.afterSnapshot,
          interactive: telemetry.finalProbe.interactive,
          interactiveTreeText: formatInteractiveTreeText(
            telemetry.finalProbe.interactive.items || [],
          ),
        };
      }
    } catch (error: any) {
      telemetry.warnings.push(`Final DOM probe unavailable: ${error.message}`);
    }
  }
  await cleanupDomRefs(cdp, evaluationOptions);
  return telemetry;
}
