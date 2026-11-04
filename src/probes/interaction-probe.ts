// @ts-nocheck
export function interactionSafety(target, allowDestructive = false, automatic = false) {
  if (!target) return 'Target not found';
  if (!target.connected) return 'Target is stale or detached';
  if (!target.visible) return 'Target is hidden or outside the viewport';
  if (target.disabled) return 'Target or its ancestor is disabled/inert';
  if (target.navigation) return 'Links and navigation controls are never clicked';
  if (target.submission) return 'Form submission/reset controls are never clicked';
  if (target.file) return 'File controls are never clicked';
  if (target.editable) return 'Editable and value-changing form controls are not explored';
  const label = String(target.safetyText || target.name || '')
    .normalize('NFKC')
    .replace(/[‌‍_-]/g, ' ');
  if (
    !allowDestructive &&
    /\b(?:delete|remove|clear|drop|purge|destroy|wipe|format|pay|payment|purchase|buy|order|checkout|logout|sign\s*out|log\s*out|submit|send|save|confirm|reset|discard|unsubscribe|cancel\s*(?:subscription|membership|plan|account))\b|حذف|پاک|پرداخت|خرید|سفارش|خروج|ارسال|ذخیره|تایید|تأیید|لغو|نابود|پاکسازی/i.test(
      label,
    )
  ) {
    return 'Potentially destructive action blocked by text safety policy';
  }
  if (automatic && !target.toggle) return 'Not a recognized UI toggle';
  return null;
}

// This is serialized into the page. References live in a WeakMap/Map rather than

export function inPageInteractionProbe(command, safety) {
  const slot = '__agentsEyeInteractionsV1';
  let state = globalThis[slot];
  if (!state || state.document !== document) {
    state = {
      document,
      ids: new WeakMap(),
      targets: new Map(),
      nextId: 0,
      token: `${performance.timeOrigin}:${Math.random()}`,
      href: location.href,
      navigation: 0,
    };
    Object.defineProperty(globalThis, slot, { value: state, configurable: true });
  }
  if (state.href !== location.href) {
    state.href = location.href;
    state.navigation += 1;
  }
  const roots = [document];
  // Deliberately exclude iframe contents: CDP mouse coordinates are main-frame
  // coordinates and cross-origin frames cannot be conservatively inspected here.
  const elements = [];
  for (let i = 0; i < roots.length && elements.length < 5000; i += 1) {
    for (const el of roots[i].querySelectorAll('*')) {
      elements.push(el);
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (elements.length >= 5000) break;
    }
  }
  const parent = (el) => el.parentElement || el.getRootNode?.().host || null;
  const ancestors = (el) => {
    const list = [];
    for (let node = el; node; node = parent(node)) list.push(node);
    return list;
  };
  const rectOf = (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const nameOf = (el) => {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) return '';
    const labelledBy = el.getAttribute('aria-labelledby');
    const labelledText = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => el.getRootNode().getElementById?.(id)?.textContent || '')
          .join(' ')
      : '';
    return (
      el.getAttribute('aria-label') ||
      labelledText ||
      el.getAttribute('title') ||
      (el.tagName === 'INPUT' ? '' : el.textContent) ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  };
  const describe = (el) => {
    if (!state.ids.has(el)) {
      const id = `${state.token}:${++state.nextId}`;
      state.ids.set(el, id);
      state.targets.set(id, el);
      // Keep strong references bounded; evicted candidates safely become stale.
      if (state.targets.size > 6000) state.targets.delete(state.targets.keys().next().value);
    }
    const chain = ancestors(el);
    const rect = rectOf(el);
    const style = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const type = (el.type || el.getAttribute('type') || '').toLowerCase();
    const name = nameOf(el);
    const expanded = el.getAttribute('aria-expanded');
    const popup = el.getAttribute('aria-haspopup');
    const button = tag === 'button' || role === 'button' || (tag === 'input' && type === 'button');
    const summary = tag === 'summary' && parent(el)?.tagName === 'DETAILS';
    const toggle =
      summary ||
      role === 'tab' ||
      (button &&
        (expanded === 'true' ||
          expanded === 'false' ||
          ['true', 'menu', 'listbox', 'dialog', 'tree', 'grid'].includes(popup) ||
          /^(?:(?:open|close|toggle|show|hide|expand|collapse)\s+)?(?:menu|navigation|dropdown|accordion|hamburger|sidebar|tabs?|more options)(?:\s|$)|منو|فهرست|باز کردن منو|بستن منو/i.test(
            name,
          )));
    const disabled = chain.some(
      (node) =>
        node.disabled ||
        node.inert ||
        node.hasAttribute('disabled') ||
        node.getAttribute('aria-disabled') === 'true' ||
        node.getAttribute('aria-hidden') === 'true' ||
        node.hasAttribute('inert'),
    );
    const navigation = chain.some(
      (node) =>
        ['A', 'AREA'].includes(node.tagName) ||
        node.hasAttribute('href') ||
        node.hasAttribute('download') ||
        node.getAttribute('role') === 'link',
    );
    const submission = chain.some((node) => {
      const nodeTag = node.tagName.toLowerCase();
      const nodeType = (node.type || node.getAttribute('type') || '').toLowerCase();
      return (
        (nodeTag === 'button' &&
          (nodeType === 'reset' ||
            nodeType === 'submit' ||
            (Boolean(node.form || node.closest?.('form')) && nodeType !== 'button'))) ||
        (nodeTag === 'input' && ['submit', 'image', 'reset'].includes(nodeType))
      );
    });
    const file = chain.some(
      (node) =>
        (node.tagName === 'INPUT' && node.type === 'file') ||
        (node.tagName === 'LABEL' && node.control?.type === 'file'),
    );
    const editable = chain.some(
      (node) =>
        node.isContentEditable ||
        ['TEXTAREA', 'SELECT'].includes(node.tagName) ||
        (node.tagName === 'INPUT' && node.type !== 'button') ||
        (node.tagName === 'LABEL' && Boolean(node.control)) ||
        ['checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'combobox'].includes(
          node.getAttribute('role'),
        ),
    );
    const visible =
      el.isConnected &&
      el.getClientRects().length > 0 &&
      style.display !== 'none' &&
      style.visibility === 'visible' &&
      Number(style.opacity) > 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.x < innerWidth &&
      rect.y < innerHeight &&
      rect.x + rect.width > 0 &&
      rect.y + rect.height > 0;
    return {
      id: state.ids.get(el),
      tag,
      role,
      name: name.slice(0, 180),
      // Use the whole label for safety, not the truncated display name.
      safetyText: [
        name,
        el.textContent || '',
        el.getAttribute('title') || '',
        el.id || '',
        el.getAttribute('name') || '',
        el.getAttribute('aria-label') || '',
      ].join(' '),
      rect,
      connected: Boolean(el.isConnected),
      visible,
      disabled,
      navigation,
      submission,
      file,
      editable,
      toggle,
      expanded,
      selected: el.getAttribute('aria-selected'),
    };
  };
  const publicTarget = (info) => {
    const { safetyText: _safetyText, ...safe } = info;
    return safe;
  };
  const context = {
    documentToken: state.token,
    navigationToken: state.navigation,
    url: `${location.origin}${location.pathname}`,
  };
  if (command.op === 'snapshot') {
    const nodes = elements.slice(0, 500).map((el) => {
      const info = describe(el);
      const style = getComputedStyle(el);
      return {
        id: info.id,
        tag: info.tag,
        role: info.role,
        name:
          ['BUTTON', 'SUMMARY', 'A'].includes(el.tagName) || ['button', 'tab'].includes(info.role)
            ? info.name
            : null,
        rect: info.rect,
        visible: info.visible,
        expanded: info.expanded,
        selected: info.selected,
        display: style.display,
        visibility: style.visibility,
        position: style.position,
      };
    });
    return {
      ...context,
      scroll: { x: scrollX, y: scrollY },
      viewport: { width: innerWidth, height: innerHeight },
      nodes,
      truncated: elements.length > nodes.length,
    };
  }
  if (command.op === 'scan') {
    const candidates = [];
    const skipped = [];
    for (const el of elements) {
      if (
        !['BUTTON', 'SUMMARY', 'INPUT'].includes(el.tagName) &&
        !['button', 'tab'].includes(el.getAttribute('role'))
      )
        continue;
      const info = describe(el);
      if (!info.toggle) continue;
      const reason = safety(info, command.allowDestructive, true);
      if (reason) {
        if (skipped.length < 100) skipped.push({ target: publicTarget(info), reason });
      } else if (candidates.length < 100) candidates.push(publicTarget(info));
    }
    return { ...context, candidates, skipped };
  }
  if (command.op === 'keySafety') {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) {
      return {
        ...context,
        reason: command.key === 'Enter' ? 'No safe focused control for Enter' : null,
      };
    }
    let focused = el;
    while (focused.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    const info = describe(focused);
    const escapeOrTab = ['Escape', 'Tab'].includes(command.key);
    const reason = escapeOrTab
      ? null
      : info.editable
        ? 'Key could modify a form control'
        : ['Enter', 'Space'].includes(command.key)
          ? safety(info, command.allowDestructive, false)
          : null;
    return { ...context, reason, target: publicTarget(info) };
  }
  let target = null;
  const isRef = typeof command.selector === 'string' && /^@e\d+$/i.test(command.selector.trim());
  if (command.id) target = state.targets.get(command.id);
  else if (isRef) {
    const refKey = command.selector.trim();
    const rawNum = refKey.replace(/^@e/i, '');
    const registry =
      globalThis.__agentsEyeRefsV1 ||
      (typeof window !== 'undefined' ? window.__agentsEyeRefsV1 : undefined);
    if (registry && registry.map && registry.map.has(refKey)) {
      const candidate = registry.map.get(refKey);
      if (candidate && candidate.isConnected) target = candidate;
    }
    if (!target) {
      // Fallback across main document and open shadow roots
      for (const root of roots) {
        if (typeof root.querySelector !== 'function') continue;
        target = root.querySelector(
          `[data-agentseye-ref="${rawNum}"],[data-agentseye-ref="${refKey}"],[data-agentseye-ref="e${rawNum}"]`,
        );
        if (target && target.isConnected) break;
      }
    }
    if (!target || !target.isConnected) {
      return {
        ...context,
        status: 'skipped',
        reason: `Element ref ${refKey} not found or stale`,
      };
    }
  } else {
    try {
      for (const root of roots) {
        target = root.querySelector(command.selector);
        if (target) break;
      }
    } catch {
      return { ...context, reason: 'Invalid CSS selector' };
    }
  }
  if (!target) return { ...context, reason: 'Target not found or stale' };

  if (command.op === 'scrollIntoView') {
    target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    return { ...context, status: 'applied', target: command.selector };
  }
  const info = describe(target);
  const reason = safety(info, command.allowDestructive, command.automatic);
  if (reason) return { ...context, reason, target: publicTarget(info) };
  const left = Math.max(0, info.rect.x);
  const top = Math.max(0, info.rect.y);
  const right = Math.min(innerWidth, info.rect.x + info.rect.width);
  const bottom = Math.min(innerHeight, info.rect.y + info.rect.height);
  const x = (left + right) / 2;
  const y = (top + bottom) / 2;
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const deeper = hit.shadowRoot.elementFromPoint?.(x, y);
    if (!deeper || deeper === hit) break;
    hit = deeper;
  }
  if (!hit || !ancestors(hit).includes(target)) {
    return {
      ...context,
      reason: 'Target is covered or failed hit testing',
      target: publicTarget(info),
    };
  }
  // A clickable descendant may have a different purpose from the selected
  // container. Recheck it too, including its ancestors, before native dispatch.
  const hitInfo = describe(hit);
  const hitReason = safety(hitInfo, command.allowDestructive, false);
  if (hitReason) return { ...context, reason: hitReason, target: publicTarget(info) };
  return { ...context, reason: null, target: publicTarget(info), point: { x, y } };
}
