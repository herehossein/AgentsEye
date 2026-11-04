// @ts-nocheck
import { DEFAULT_STYLE_PROPS, DEFAULTS } from '../config/constants.js';
import type { InspectorOptions, ProbeConfig } from '../types/options.js';

export function makeProbeConfig(options: InspectorOptions): ProbeConfig {
  return {
    selector: options.selector,
    allMatches: options.allMatches,
    maxNodes: options.maxNodes,
    maxDepth: options.maxDepth,
    textLimit: options.textLimit,
    attributeLimit: options.attributeLimit,
    styleProps: options.styleProps,
    compactStyles:
      options.compactStyles !== false &&
      options.styleProps.length === DEFAULT_STYLE_PROPS.length &&
      options.styleProps.every((prop) => DEFAULT_STYLE_PROPS.includes(prop)),
    visibleOnly: options.visibleOnly,
    includeShadowDom: options.includeShadowDom,
    includeIframes: options.includeIframes,
    includeTemplates: options.includeTemplates,
    includeCssVars: options.includeCssVars,
    maxCssVars: DEFAULTS.maxCssVars,
    maxLandmarks: DEFAULTS.maxLandmarks,
    maxHeadings: DEFAULTS.maxHeadings,
    maxForms: DEFAULTS.maxForms,
    maxInteractive: DEFAULTS.maxInteractive,
    interactiveScope: options.interactiveScope,
    maxImages: DEFAULTS.maxImages,
    maxStorage: DEFAULTS.maxStorage,
    maxStorageValueLength: DEFAULTS.maxStorageValueLength,
    storageMode: options.showStorage || options.focus === 'storage' ? 'values' : 'keys',
    pageTextLimit: DEFAULTS.pageTextLimit,
    breakpoints: DEFAULTS.breakpoints,
    maxIssues: DEFAULTS.maxIssues,
  };
}

export function inPageProbe(config) {
  const W = typeof window !== 'undefined' ? window : null;
  const D = typeof document !== 'undefined' ? document : null;
  if (!D || !W) return { error: 'No document available' };

  const warnings = [];
  const stats = {
    nodes: 0,
    elementNodes: 0,
    textNodes: 0,
    visibleElements: 0,
    hiddenElements: 0,
    shadowRoots: 0,
    iframes: 0,
    crossOriginIframes: 0,
    templates: 0,
    maxDepthReached: 0,
    droppedNodes: 0,
    truncated: false,
  };
  const styleCache = new WeakMap();
  const hiddenCache = new WeakMap();
  const frameCache = new WeakMap();
  const nodeLimit = Math.max(1, Math.min(Number(config.maxNodes) || 3000, 100000));
  const depthLimit = Math.max(0, Math.min(Number(config.maxDepth) || 0, 200));
  let nextIndex = 0;

  const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
  const norm = (value) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  const cut = (value, limit) => {
    const text = norm(value);
    if (limit <= 0) return '';
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  };
  const escapeIdent = (value) => {
    const text = String(value ?? '');
    if (W.CSS && typeof W.CSS.escape === 'function') return W.CSS.escape(text);
    return text.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  };
  const styleOf = (el) => {
    if (!el || el.nodeType !== 1) return null;
    if (styleCache.has(el)) return styleCache.get(el);
    let style = null;
    try {
      style = (el.ownerDocument?.defaultView || W).getComputedStyle(el);
    } catch {
      style = null;
    }
    styleCache.set(el, style);
    return style;
  };

  const compactSelector = (el) => {
    if (!el || el.nodeType !== 1) return null;
    let selector = el.tagName.toLowerCase();
    if (el.id) selector += `#${escapeIdent(el.id)}`;
    const classes = Array.from(el.classList || []).slice(0, 3);
    if (classes.length) selector += `.${classes.map(escapeIdent).join('.')}`;
    return selector;
  };

  const cssPath = (el, maxParts = 6) => {
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1 && parts.length < maxParts) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${escapeIdent(current.id)}`;
        parts.unshift(part);
        return parts.join(' > ');
      }
      const classes = Array.from(current.classList || []).slice(0, 2);
      if (classes.length) part += `.${classes.map(escapeIdent).join('.')}`;
      const parent = current.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName,
        );
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    const prefix = current && current.nodeType === 1 ? '… > ' : '';
    return prefix + parts.join(' > ');
  };

  // Rects use the inspected top viewport, including same-origin frame borders.
  // Axis-aligned CSS scaling is handled; rotated/perspective frames are approximate.
  const frameSpace = (view, depth = 0) => {
    if (!view || view === W) return { x: 0, y: 0, sx: 1, sy: 1 };
    if (frameCache.has(view)) return frameCache.get(view);
    if (depth >= 50) return null;
    try {
      const frame = view.frameElement;
      if (!frame) return null;
      const parent = frameSpace(frame.ownerDocument.defaultView, depth + 1);
      if (!parent) return null;
      const box = frame.getBoundingClientRect();
      const sx = frame.offsetWidth > 0 ? box.width / frame.offsetWidth : 1;
      const sy = frame.offsetHeight > 0 ? box.height / frame.offsetHeight : 1;
      const space = {
        x: parent.x + (box.left + (frame.clientLeft || 0) * sx) * parent.sx,
        y: parent.y + (box.top + (frame.clientTop || 0) * sy) * parent.sy,
        sx: parent.sx * sx,
        sy: parent.sy * sy,
      };
      frameCache.set(view, space);
      return space;
    } catch {
      return null;
    }
  };

  const rectOf = (el) => {
    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      return null;
    }
    const space = frameSpace(el.ownerDocument?.defaultView || W);
    if (!space) return null;
    const left = space.x + rect.left * space.sx;
    const right = space.x + rect.right * space.sx;
    const top = space.y + rect.top * space.sy;
    const bottom = space.y + rect.bottom * space.sy;
    const width = rect.width * space.sx;
    const height = rect.height * space.sy;
    const scrollX = W.scrollX ?? 0;
    const scrollY = W.scrollY ?? 0;
    return {
      viewport: {
        top: round(top),
        right: round(right),
        bottom: round(bottom),
        left: round(left),
        width: round(width),
        height: round(height),
      },
      document: {
        top: round(top + scrollY),
        right: round(right + scrollX),
        bottom: round(bottom + scrollY),
        left: round(left + scrollX),
        width: round(width),
        height: round(height),
      },
    };
  };

  const ownText = (el, limit) => {
    // Script/style source can contain credentials and is not rendered content.
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) return '';
    let text = '';
    for (const child of Array.from(el.childNodes || [])) {
      if (child.nodeType === 3) {
        const value = child.nodeValue ?? '';
        if (value.trim()) stats.textNodes += 1;
        text += ` ${value}`;
      }
    }
    return cut(text, limit);
  };

  const textOf = (el) => {
    if (!el) return '';
    // Avoid repeatedly materializing the textContent of large application subtrees.
    const limit = Math.max(240, config.textLimit * 2);
    const stack = [el];
    let text = '';
    let visited = 0;
    while (stack.length && text.length < limit && visited++ < 256) {
      const node = stack.pop();
      if (node.nodeType === 3)
        text += ` ${String(node.nodeValue || '').slice(0, limit - text.length)}`;
      else if (!['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)) {
        const children = node.childNodes || [];
        for (let i = Math.min(children.length, 256) - 1; i >= 0; i -= 1) stack.push(children[i]);
      }
    }
    return text;
  };

  const basicName = (el, limit) => {
    if (!el || el.nodeType !== 1) return '';
    const aria = el.getAttribute('aria-label');
    if (aria) return cut(aria, limit);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => textOf((el.getRootNode?.() || el.ownerDocument || D).getElementById?.(id)))
        .join(' ');
      if (norm(text)) return cut(text, limit);
    }
    if (el.tagName === 'IMG') return cut(el.getAttribute('alt') || '', limit);
    const title = el.getAttribute('title');
    if (title) return cut(title, limit);
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) return cut(placeholder, limit);
    }
    return cut(textOf(el), limit);
  };

  const testIdOf = (el) => {
    for (const name of ['data-testid', 'data-test', 'data-test-id', 'data-cy', 'data-qa']) {
      const value = el.getAttribute(name);
      if (value) return value;
    }
    return null;
  };

  const redactInputValue = (el) => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password') return '[REDACTED:PASSWORD]';
    const name = `${el.getAttribute('name') || ''} ${el.id || ''}`;
    if (/(?:token|secret|password|passwd|api[_-]?key|auth|session|csrf|xsrf)/i.test(name)) {
      return '[REDACTED]';
    }
    const value = el.value;
    if (value == null) return null;
    return cut(value, Math.max(config.textLimit * 2, 240));
  };

  const styleValue = (style, prop) => {
    if (!style) return null;
    try {
      const value = style.getPropertyValue(prop);
      return value === '' ? null : value;
    } catch {
      return null;
    }
  };

  const defaultStyles = {
    position: 'static',
    visibility: 'visible',
    opacity: '1',
    'overflow-x': 'visible',
    'overflow-y': 'visible',
    'z-index': 'auto',
    'background-color': ['rgba(0, 0, 0, 0)', 'transparent'],
    'min-width': ['0px', 'auto'],
    'max-width': 'none',
    padding: '0px',
    margin: '0px',
    'flex-direction': 'row',
    'align-items': 'normal',
    'justify-content': 'normal',
    gap: 'normal',
    'grid-template-columns': 'none',
    transform: 'none',
    'pointer-events': 'auto',
    'white-space': 'normal',
    'word-break': 'normal',
    'text-overflow': 'clip',
  };
  const readStyles = (style, rendered) => {
    if (!style) return null;
    // Compact mode is enabled only for the default property selection by makeProbeConfig.
    const props =
      rendered || !config.compactStyles
        ? config.styleProps
        : config.styleProps.length
          ? ['display', 'position', 'visibility', 'opacity']
          : [];
    const out = {};
    for (const prop of props) {
      const value = styleValue(style, prop);
      if (value == null) continue;
      const defaults = defaultStyles[prop];
      if (
        config.compactStyles &&
        (Array.isArray(defaults) ? defaults.includes(value) : defaults === value)
      )
        continue;
      out[prop] = value;
    }
    return out;
  };

  const isSensitiveControl = (el) => {
    const control = el.closest ? el.closest('input,select,textarea') || el : el;
    const type = (control.getAttribute('type') || '').toLowerCase();
    const name = `${control.getAttribute('name') || ''} ${control.id || ''}`;
    return (
      type === 'password' ||
      /(?:token|secret|password|passwd|api[_-]?key|apikey|auth|session|csrf|xsrf)/i.test(name)
    );
  };

  const attributesOf = (el) => {
    const attributes = {};
    let count = 0;
    const limit = config.attributeLimit;
    for (const attribute of Array.from(el.attributes || [])) {
      if (count >= limit) break;
      if (
        attribute.name === 'value' &&
        ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(el.tagName)
      ) {
        attributes[attribute.name] = isSensitiveControl(el)
          ? '[REDACTED]'
          : cut(attribute.value, Math.max(config.textLimit * 2, 240));
      } else {
        attributes[attribute.name] = cut(attribute.value, Math.max(config.textLimit * 2, 240));
      }
      count += 1;
    }
    return {
      attributes: Object.keys(attributes).length ? attributes : undefined,
      attributeCount: (el.attributes || []).length,
      attributesTruncated: (el.attributes || []).length > count,
    };
  };

  const isInteractive = (el) =>
    /^(BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|OPTION|LABEL)$/.test(el.tagName) ||
    (el.tagName === 'A' && el.hasAttribute('href')) ||
    [
      'button',
      'link',
      'menuitem',
      'tab',
      'checkbox',
      'radio',
      'switch',
      'slider',
      'textbox',
      'combobox',
      'searchbox',
    ].includes((el.getAttribute('role') || '').toLowerCase()) ||
    (el.hasAttribute('tabindex') && el.tabIndex >= 0) ||
    el.hasAttribute('onclick') ||
    el.isContentEditable;

  const composedParent = (el) => {
    if (el.assignedSlot) return el.assignedSlot;
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode?.();
    if (root?.host) return root.host;
    try {
      return el.ownerDocument?.defaultView?.frameElement || null;
    } catch {
      return null;
    }
  };
  const ancestorHidden = (el) => {
    if (hiddenCache.has(el)) return hiddenCache.get(el);
    const chain = [];
    let current = el;
    let reason = null;
    while (current && chain.length < 500) {
      if (hiddenCache.has(current)) {
        reason = hiddenCache.get(current);
        break;
      }
      chain.push(current);
      current = composedParent(current);
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const ancestor = chain[i];
      const style = styleOf(ancestor);
      if (!reason && styleValue(style, 'display') === 'none') reason = 'display:none';
      if (!reason && Number.parseFloat(styleValue(style, 'opacity') || '1') <= 0)
        reason = 'opacity:0';
      if (!reason && styleValue(style, 'content-visibility') === 'hidden')
        reason = 'content-visibility:hidden';
      if (!reason && ancestor.getRootNode?.()?.nodeType === 11 && !ancestor.getRootNode().host)
        reason = 'detached-fragment';
      hiddenCache.set(ancestor, reason);
    }
    return hiddenCache.get(el) || null;
  };

  const visibleState = (el, style, rect) => {
    const display = styleValue(style, 'display');
    const visibility = styleValue(style, 'visibility');
    const blocked = ancestorHidden(el);
    // visibility is inherited but can be overridden by a descendant; opacity/display cannot.
    const rendered = !blocked && visibility !== 'hidden' && visibility !== 'collapse';
    const width = rect?.viewport.width ?? 0;
    const height = rect?.viewport.height ?? 0;
    const hasBox = width > 0 && height > 0;
    const inViewport =
      rendered &&
      hasBox &&
      (rect?.viewport.bottom ?? 0) > 0 &&
      (rect?.viewport.right ?? 0) > 0 &&
      (rect?.viewport.top ?? 0) < (W.innerHeight || 0) &&
      (rect?.viewport.left ?? 0) < (W.innerWidth || 0);
    let hiddenReason = blocked
      ? hiddenCache.get(el) === blocked &&
        (styleValue(style, 'display') === 'none' ||
          Number.parseFloat(styleValue(style, 'opacity') || '1') <= 0 ||
          styleValue(style, 'content-visibility') === 'hidden')
        ? blocked
        : `ancestor:${blocked}`
      : null;
    if (!rendered && !hiddenReason) hiddenReason = `visibility:${visibility}`;
    else if (rendered && !hasBox && display !== 'contents') hiddenReason = 'zero-size';
    return { rendered, hasBox, inViewport, hiddenReason };
  };

  const scrollOf = (el, style) => {
    let scrollHeight;
    let scrollWidth;
    let clientHeight;
    let clientWidth;
    try {
      scrollHeight = el.scrollHeight;
      scrollWidth = el.scrollWidth;
      clientHeight = el.clientHeight;
      clientWidth = el.clientWidth;
    } catch {
      return null;
    }
    const overflowY = styleValue(style, 'overflow-y') || styleValue(style, 'overflow') || '';
    const overflowX = styleValue(style, 'overflow-x') || styleValue(style, 'overflow') || '';
    const isScrollOverflow = (value) => /auto|scroll|hidden|clip|overlay/.test(value);
    const scrollableY = scrollHeight > clientHeight + 1;
    const scrollableX = scrollWidth > clientWidth + 1;
    const isScrollContainer =
      (isScrollOverflow(overflowY) && scrollableY) || (isScrollOverflow(overflowX) && scrollableX);
    if (!isScrollContainer) return null;
    return {
      scrollTop: round(el.scrollTop),
      scrollLeft: round(el.scrollLeft),
      scrollHeight,
      scrollWidth,
      clientHeight,
      clientWidth,
      scrollableY,
      scrollableX,
      overflowX,
      overflowY,
    };
  };

  const scopeOf = (el) => {
    const parts = [];
    let current = el;
    for (let depth = 0; current && depth < 50; depth += 1) {
      const root = current.getRootNode?.();
      if (root?.host) {
        parts.unshift(`${cssPath(root.host)}::shadow`);
        current = root.host;
      } else {
        let frame;
        try {
          frame = current.ownerDocument?.defaultView?.frameElement;
        } catch {
          break;
        }
        if (!frame) break;
        parts.unshift(`${cssPath(frame)}::frame`);
        current = frame;
      }
    }
    return { scope: parts.length ? parts.join(' > ') : 'document' };
  };

  const elementPath = (el) => {
    if (!el || el.nodeType !== 1) return null;
    return {
      ...scopeOf(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: Array.from(el.classList || []).slice(0, 5),
      selector: compactSelector(el),
      cssPath: cssPath(el),
      rect: rectOf(el),
    };
  };

  const activeElement = () => {
    try {
      return elementPath(D.activeElement);
    } catch {
      return null;
    }
  };

  const walkChildren = (parent, depth, inShadow) => {
    const children = [];
    for (const child of parent.children || []) {
      if (stats.elementNodes >= nodeLimit) {
        stats.truncated = true;
        stats.droppedNodes += 1;
        break;
      }
      const walked = walk(child, depth, inShadow);
      if (walked) children.push(walked);
    }
    return children;
  };

  function walk(node, depth, parentIsShadow) {
    if (!node) return null;
    if (depth > depthLimit) {
      stats.truncated = true;
      return null;
    }
    if (node.nodeType === 9) {
      return node.documentElement ? walk(node.documentElement, depth, parentIsShadow) : null;
    }
    if (node.nodeType === 11) {
      const children = walkChildren(node, depth, parentIsShadow);
      return children.length ? { type: 'fragment', children } : null;
    }
    if (node.nodeType === 3) {
      const text = cut(node.nodeValue, config.textLimit);
      if (!text) return null;
      return { type: 'text', text };
    }
    if (node.nodeType !== 1) return null;

    if (stats.elementNodes >= nodeLimit) {
      stats.truncated = true;
      stats.droppedNodes += 1;
      return null;
    }

    const el = node;
    const style = styleOf(el);
    const rect = rectOf(el);
    const state = visibleState(el, style, rect);
    if (!state.rendered) stats.hiddenElements += 1;
    else if (state.hasBox) stats.visibleElements += 1;

    if (config.visibleOnly && !state.rendered) {
      // visibility:hidden can be overridden by descendants; display/opacity cannot.
      stats.elementNodes += 1;
      if (ancestorHidden(el)) return null;
      const children = walkChildren(el, depth + 1, parentIsShadow);
      if (config.includeShadowDom && el.shadowRoot)
        children.push(...walkChildren(el.shadowRoot, depth + 1, true));
      return children.length ? { type: 'fragment', children } : null;
    }

    const index = nextIndex++;
    stats.nodes += 1;
    stats.elementNodes += 1;
    stats.maxDepthReached = Math.max(stats.maxDepthReached, depth);

    const nodeOut = {
      index,
      depth,
      tag: el.tagName.toLowerCase(),
      selector: compactSelector(el),
      children: [],
    };
    if (el.namespaceURI && !/^http:\/\/www\.w3\.org\/1999\/xhtml$/i.test(el.namespaceURI)) {
      nodeOut.namespace = el.namespaceURI;
    }
    if (parentIsShadow) nodeOut.inShadowRoot = true;
    if (el.id) nodeOut.id = el.id;
    const classNames = Array.from(el.classList || []);
    if (classNames.length) nodeOut.classes = classNames.slice(0, 20);
    const role = el.getAttribute('role');
    if (role) nodeOut.role = role;
    if (el.getAttribute('aria-hidden') === 'true') nodeOut.ariaHidden = true;
    const testId = testIdOf(el);
    if (testId) nodeOut.testId = testId;
    if (isInteractive(el)) nodeOut.interactive = true;

    const own = ownText(el, config.textLimit);
    if (own) nodeOut.ownText = own;
    const accessibleName = basicName(el, config.textLimit);
    if (accessibleName && isInteractive(el)) nodeOut.accessibleName = accessibleName;

    const attrs = attributesOf(el);
    if (attrs.attributes) nodeOut.attributes = attrs.attributes;
    if (attrs.attributeCount) nodeOut.attributeCount = attrs.attributeCount;
    if (attrs.attributesTruncated) nodeOut.attributesTruncated = true;

    nodeOut.rect = rect;
    nodeOut.rendered = state.rendered;
    nodeOut.hasBox = state.hasBox;
    nodeOut.inViewport = state.inViewport;
    if (state.hiddenReason) nodeOut.hiddenReason = state.hiddenReason;
    const styles = readStyles(style, state.rendered);
    if (styles && Object.keys(styles).length) nodeOut.styles = styles;

    const scroll = scrollOf(el, style);
    if (scroll) nodeOut.scroll = scroll;

    const position = styleValue(style, 'position');
    if (position === 'fixed' || position === 'sticky') {
      nodeOut.positioning = position;
      nodeOut.inset = {
        top: styleValue(style, 'top'),
        right: styleValue(style, 'right'),
        bottom: styleValue(style, 'bottom'),
        left: styleValue(style, 'left'),
        zIndex: styleValue(style, 'z-index'),
      };
    }

    if (el.tagName === 'CANVAS') {
      nodeOut.canvas = {
        width: el.width,
        height: el.height,
        cssWidth: rect?.viewport.width ?? 0,
        cssHeight: rect?.viewport.height ?? 0,
      };
    }

    if (el.childElementCount > 0) nodeOut.children = walkChildren(el, depth + 1, parentIsShadow);

    if (config.includeShadowDom && el.shadowRoot) {
      stats.shadowRoots += 1;
      const shadowChildren = [];
      for (const child of Array.from(el.shadowRoot.children)) {
        const walked = walk(child, depth + 1, true);
        if (walked) shadowChildren.push(walked);
      }
      nodeOut.shadowRoot = {
        mode: el.shadowRoot.mode || 'open',
        children: shadowChildren,
      };
    }

    if (config.includeTemplates && el.tagName === 'TEMPLATE' && el.content) {
      stats.templates += 1;
      const templateChildren = [];
      for (const child of Array.from(el.content.children)) {
        const walked = walk(child, depth + 1, parentIsShadow);
        if (walked) templateChildren.push(walked);
      }
      nodeOut.templateContent = { children: templateChildren };
    }

    if (config.includeIframes && el.tagName === 'IFRAME') {
      stats.iframes += 1;
      try {
        const frameDoc = el.contentDocument;
        if (frameDoc && frameDoc.documentElement) {
          const frameRoot = walk(frameDoc.documentElement, depth + 1, parentIsShadow);
          if (frameRoot) nodeOut.frameContent = frameRoot;
        } else {
          stats.crossOriginIframes += 1;
          nodeOut.crossOrigin = true;
          warnings.push('Cross-origin iframe DOM not expanded');
        }
      } catch {
        stats.crossOriginIframes += 1;
        nodeOut.crossOrigin = true;
        warnings.push('Cross-origin iframe DOM not expanded');
      }
    }

    return nodeOut;
  }

  // One bounded composed-tree enumeration is shared by all summary queries.
  const summaryElements = [];
  const pendingElements = [D.documentElement];
  while (pendingElements.length && summaryElements.length < nodeLimit) {
    const el = pendingElements.pop();
    if (!el) continue;
    summaryElements.push(el);
    const children = Array.from(el.children || []);
    if (config.includeShadowDom && el.shadowRoot) children.push(...el.shadowRoot.children);
    if (config.includeIframes && el.tagName === 'IFRAME') {
      try {
        if (el.contentDocument?.documentElement) children.push(el.contentDocument.documentElement);
      } catch {
        /* cross-origin */
      }
    }
    for (let index = children.length - 1; index >= 0; index -= 1)
      pendingElements.push(children[index]);
  }
  if (pendingElements.length)
    warnings.push('Summary traversal reached --max-nodes; counts are lower bounds');
  const deepQuery = (selector) => summaryElements.filter((el) => el.matches(selector));

  const queryRoots = () => {
    if (!config.selector) {
      return { roots: [D.documentElement], selectorMatched: true, matchCount: 1 };
    }
    try {
      const matches = deepQuery(config.selector);
      if (matches.length === 0) {
        warnings.push(`Selector matched no elements: ${config.selector}`);
        return { roots: [D.documentElement], selectorMatched: false, matchCount: 0 };
      }
      return {
        roots: config.allMatches ? matches : [matches[0]],
        selectorMatched: true,
        matchCount: matches.length,
      };
    } catch {
      warnings.push(`Invalid selector: ${config.selector}`);
      return { roots: [D.documentElement], selectorMatched: false, matchCount: 0 };
    }
  };

  const rootsInfo = queryRoots();
  const trees = [];
  for (const root of rootsInfo.roots) {
    const tree = walk(root, 0, false);
    if (tree) trees.push(tree);
  }

  const collectLandmarks = () => {
    const definitions = {
      header: 'header, [role="banner"]',
      navigation: 'nav, [role="navigation"]',
      main: 'main, [role="main"]',
      complementary: 'aside, [role="complementary"]',
      contentinfo: 'footer, [role="contentinfo"]',
      form: 'form, [role="form"]',
      dialog: 'dialog, [role="dialog"]',
    };
    const out = {};
    for (const [name, selector] of Object.entries(definitions)) {
      let elements = [];
      try {
        elements = deepQuery(selector);
      } catch {
        elements = [];
      }
      out[name] = {
        count: elements.length,
        items: elements.slice(0, config.maxLandmarks).map((el) => ({
          ...elementPath(el),
          accessibleName: cut(basicName(el, config.textLimit), config.textLimit),
        })),
        truncated: elements.length > config.maxLandmarks,
      };
    }
    return out;
  };

  const collectHeadings = () => {
    let elements = [];
    try {
      elements = deepQuery('h1,h2,h3,h4,h5,h6');
    } catch {
      elements = [];
    }
    return {
      count: elements.length,
      items: elements.slice(0, config.maxHeadings).map((el) => ({
        level: Number(el.tagName.slice(1)),
        text: cut(textOf(el), config.textLimit),
        id: el.id || undefined,
        cssPath: cssPath(el),
        rect: rectOf(el),
      })),
      truncated: elements.length > config.maxHeadings,
    };
  };

  const collectForms = () => {
    let elements = [];
    try {
      elements = deepQuery('input,select,textarea');
    } catch {
      elements = [];
    }
    const items = elements.slice(0, config.maxForms).map((el) => {
      const style = styleOf(el);
      const rect = rectOf(el);
      const label =
        el.labels && el.labels.length ? cut(textOf(el.labels[0]), config.textLimit) : null;
      return {
        ...scopeOf(el),
        validation: {
          valid: el.validity?.valid ?? null,
          message: el.validationMessage || null,
          pattern: el.getAttribute('pattern'),
          min: el.getAttribute('min'),
          max: el.getAttribute('max'),
        },
        rendered: visibleState(el, style, rect).rendered,
        tag: el.tagName.toLowerCase(),
        type:
          (el.getAttribute('type') || (el.tagName === 'INPUT' ? 'text' : '')).toLowerCase() || null,
        name: el.getAttribute('name') || null,
        id: el.id || null,
        placeholder: el.getAttribute('placeholder') || null,
        label,
        accessibleName: cut(basicName(el, config.textLimit), config.textLimit),
        value: el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? redactInputValue(el) : null,
        checked: typeof el.checked === 'boolean' ? el.checked : null,
        disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
        readOnly: Boolean(el.readOnly),
        required: Boolean(el.required) || el.getAttribute('aria-required') === 'true',
        fontSize: styleValue(style, 'font-size'),
        rect,
        cssPath: cssPath(el),
      };
    });
    return { count: elements.length, items, truncated: elements.length > config.maxForms };
  };

  const collectInteractive = () => {
    const selector =
      'a[href],button,summary,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[tabindex],[onclick]';
    let elements = [];
    try {
      elements = deepQuery(selector);
    } catch {
      elements = [];
    }
    const seen = new Set();
    const items = [];
    for (const el of elements) {
      if (seen.has(el)) continue;
      seen.add(el);
      const rect = rectOf(el);
      const style = styleOf(el);
      const width = rect?.viewport.width ?? 0;
      const height = rect?.viewport.height ?? 0;
      const rendered = visibleState(el, style, rect).rendered && width > 0 && height > 0;
      items.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || null,
        accessibleName: cut(basicName(el, config.textLimit), config.textLimit),
        text: cut(textOf(el), config.textLimit),
        href: el.getAttribute('href'),
        tabIndex: el.tabIndex,
        disabled:
          Boolean(el.disabled) ||
          el.getAttribute('aria-disabled') === 'true' ||
          el.getAttribute('disabled') != null,
        rendered,
        smallTouchTarget:
          rendered &&
          !el.disabled &&
          el.getAttribute('aria-disabled') !== 'true' &&
          !(el.tagName === 'A' && el.closest('p') && styleValue(style, 'display') === 'inline') &&
          isInteractive(el) &&
          (width < 44 || height < 44),
        fontSize: styleValue(style, 'font-size'),
        rect,
        cssPath: cssPath(el),
      });
      if (items.length >= config.maxInteractive) break;
    }
    return { count: elements.length, items, truncated: elements.length > items.length };
  };

  const collectImages = () => {
    let elements = [];
    try {
      elements = deepQuery('img');
    } catch {
      elements = [];
    }
    const items = elements.slice(0, config.maxImages).map((el) => ({
      src: el.currentSrc || el.getAttribute('src') || null,
      alt: el.getAttribute('alt'),
      missingAlt: !el.hasAttribute('alt'),
      title: el.getAttribute('title') || null,
      loading: el.getAttribute('loading') || null,
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
      rect: rectOf(el),
      cssPath: cssPath(el),
    }));
    return {
      count: elements.length,
      missingAltCount: items.filter((item) => item.missingAlt).length,
      items,
      truncated: elements.length > config.maxImages,
    };
  };

  const collectDuplicateIds = () => {
    const counts = new Map();
    let elements = [];
    try {
      elements = deepQuery('[id]');
    } catch {
      elements = [];
    }
    for (const el of elements) {
      counts.set(el.id, (counts.get(el.id) || 0) + 1);
    }
    const duplicates = [];
    for (const [id, count] of counts) {
      if (count > 1) duplicates.push({ id, count });
    }
    return duplicates.slice(0, 50);
  };

  const collectCssVars = () => {
    if (!config.includeCssVars) return null;
    const names = new Set();
    const limit = config.maxCssVars;
    const collectFromRules = (rules) => {
      for (const rule of Array.from(rules || [])) {
        if (names.size >= limit) return;
        let cssText = '';
        try {
          cssText = rule.cssText || '';
        } catch {
          cssText = '';
        }
        const regex = /--[A-Za-z0-9_-]+\s*:/g;
        let match;
        while ((match = regex.exec(cssText)) && names.size < limit) {
          names.add(match[0].slice(0, -1).trim());
        }
        if (rule.cssRules) {
          try {
            collectFromRules(rule.cssRules);
          } catch {
            // ignored
          }
        }
      }
    };
    for (const sheet of Array.from(D.styleSheets || [])) {
      if (names.size >= limit) break;
      try {
        collectFromRules(sheet.cssRules);
      } catch {
        warnings.push('Cross-origin stylesheet rules not readable');
      }
    }
    const rootStyle = styleOf(D.documentElement);
    const vars = {};
    for (const name of Array.from(names).slice(0, limit)) {
      const value = styleValue(rootStyle, name);
      if (value) vars[name] = value.slice(0, 300);
    }
    return {
      count: Object.keys(vars).length,
      vars,
      ...vars,
      truncated: names.size >= limit,
    };
  };

  const collectMedia = () => {
    const mq = (query) => {
      try {
        return W.matchMedia(query).matches;
      } catch {
        return null;
      }
    };
    return {
      breakpoints: (config.breakpoints || []).map((px) => ({
        px,
        minWidth: mq(`(min-width:${px}px)`),
        maxWidth: mq(`(max-width:${px}px)`),
      })),
      prefersColorSchemeDark: mq('(prefers-color-scheme: dark)'),
      prefersReducedMotion: mq('(prefers-reduced-motion: reduce)'),
      portrait: mq('(orientation: portrait)'),
      pointerFine: mq('(pointer: fine)'),
      hover: mq('(hover: hover)'),
      displayModeStandalone: mq('(display-mode: standalone)'),
    };
  };

  const readStorage = (kind) => {
    try {
      const storage = W[kind];
      if (!storage) return { available: false, error: 'unavailable' };
      const entries = [];
      const record = {};
      const limit = Math.min(storage.length, config.maxStorage);
      for (let i = 0; i < limit; i += 1) {
        const key = storage.key(i);
        if (key == null) continue;
        const raw = storage.getItem(key) ?? '';
        const value =
          config.storageMode === 'values'
            ? raw.slice(0, config.maxStorageValueLength)
            : '[REDACTED]';
        entries.push({
          key,
          value,
          length: raw.length,
          truncated: raw.length > config.maxStorageValueLength,
        });
        record[key] = value;
      }
      return {
        available: true,
        count: storage.length,
        entries,
        ...record,
        truncated: storage.length > entries.length,
      };
    } catch (error) {
      return { available: false, error: String(error?.message ?? error) };
    }
  };

  const docEl = D.documentElement;
  const body = D.body;
  const scrollEl = D.scrollingElement || docEl;
  const docStyle = styleOf(docEl);
  const bodyStyle = styleOf(body);
  const htmlOverflowX =
    styleValue(docStyle, 'overflow-x') || styleValue(docStyle, 'overflow') || 'visible';
  const htmlOverflowY =
    styleValue(docStyle, 'overflow-y') || styleValue(docStyle, 'overflow') || 'visible';
  const bodyOverflowX =
    styleValue(bodyStyle, 'overflow-x') || styleValue(bodyStyle, 'overflow') || 'visible';
  const bodyOverflowY =
    styleValue(bodyStyle, 'overflow-y') || styleValue(bodyStyle, 'overflow') || 'visible';
  const scrollLocked =
    htmlOverflowY === 'hidden' ||
    htmlOverflowX === 'hidden' ||
    bodyOverflowY === 'hidden' ||
    bodyOverflowX === 'hidden';
  const innerHeight = W.innerHeight || docEl?.clientHeight || 0;
  const innerWidth = W.innerWidth || docEl?.clientWidth || 0;

  const viewportWidth = docEl?.clientWidth || innerWidth;
  const overflowElements = [];
  let contentBottom = Math.max(docEl?.scrollHeight || 0, body?.scrollHeight || 0);
  for (const el of summaryElements) {
    if (el.ownerDocument !== D || el === docEl || el === body) continue;
    const rect = rectOf(el);
    const state = visibleState(el, styleOf(el), rect);
    if (!state.rendered || !state.hasBox) continue;
    contentBottom = Math.max(contentBottom, rect.document.bottom);
    if (rect.viewport.left < -1 || rect.viewport.right > viewportWidth + 1) {
      // A nested scrollport clips deliberately wide children, not document overflow.
      let clipped = false;
      for (
        let parent = composedParent(el), depth = 0;
        parent && parent !== body && parent !== docEl && depth < 200;
        parent = composedParent(parent), depth += 1
      ) {
        if (
          /^(auto|scroll|hidden|clip|overlay)$/.test(
            styleValue(styleOf(parent), 'overflow-x') || '',
          )
        ) {
          clipped = true;
          break;
        }
      }
      if (!clipped && overflowElements.length < 20)
        overflowElements.push({ cssPath: cssPath(el), rect: rect.viewport });
    }
  }

  const page = {
    url: W.location.href,
    title: D.title,
    readyState: D.readyState,
    contentType: D.contentType,
    characterSet: D.characterSet,
    compatMode: D.compatMode,
    doctype: D.doctype
      ? { name: D.doctype.name, publicId: D.doctype.publicId, systemId: D.doctype.systemId }
      : null,
    lang: docEl?.getAttribute('lang') || D.lang || '',
    dir: docEl?.getAttribute('dir') || D.dir || '',
    viewportMeta: D.querySelector('meta[name="viewport"]')?.getAttribute('content') || null,
    metaDescription: D.querySelector('meta[name="description"]')?.getAttribute('content') || null,
    canonical: D.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
    ogTitle: D.querySelector('meta[property="og:title"]')?.getAttribute('content') || null,
    themeColor: D.querySelector('meta[name="theme-color"]')?.getAttribute('content') || null,
    textPreview: cut(body?.innerText ?? docEl?.textContent ?? '', config.pageTextLimit),
    metrics: {
      innerWidth,
      innerHeight,
      devicePixelRatio: W.devicePixelRatio,
      scrollX: W.scrollX,
      scrollY: W.scrollY,
      documentClientWidth: docEl?.clientWidth ?? null,
      documentClientHeight: docEl?.clientHeight ?? null,
      documentScrollWidth: docEl?.scrollWidth ?? null,
      documentScrollHeight: docEl?.scrollHeight ?? null,
      bodyClientWidth: body?.clientWidth ?? null,
      bodyScrollWidth: body?.scrollWidth ?? null,
      bodyScrollHeight: body?.scrollHeight ?? null,
      horizontalOverflow:
        (docEl?.scrollWidth ?? 0) > viewportWidth + 1 || overflowElements.length > 0,
      activeAnimations: (typeof D.getAnimations === 'function' ? D.getAnimations() : []).filter(
        (a) => a.playState === 'running',
      ).length,
      overflowElements,
      contentBottom,
      verticalOverflow: (docEl?.scrollHeight ?? 0) > (docEl?.clientHeight ?? 0) + 1,
      scrollTop: scrollEl?.scrollTop ?? null,
      scrollLeft: scrollEl?.scrollLeft ?? null,
      screen: W.screen
        ? {
            width: W.screen.width,
            height: W.screen.height,
            availWidth: W.screen.availWidth,
            availHeight: W.screen.availHeight,
            colorDepth: W.screen.colorDepth,
            pixelDepth: W.screen.pixelDepth,
            orientation: W.screen.orientation?.type || null,
          }
        : null,
      visualViewport: W.visualViewport
        ? {
            width: W.visualViewport.width,
            height: W.visualViewport.height,
            offsetTop: W.visualViewport.offsetTop,
            offsetLeft: W.visualViewport.offsetLeft,
            pageTop: W.visualViewport.pageTop,
            pageLeft: W.visualViewport.pageLeft,
            scale: W.visualViewport.scale,
          }
        : null,
    },
    scrollLock: {
      htmlOverflowX,
      htmlOverflowY,
      bodyOverflowX,
      bodyOverflowY,
      locked: scrollLocked,
      trapRisk:
        /^(hidden|clip)$/.test(htmlOverflowY) || /^(hidden|clip)$/.test(bodyOverflowY)
          ? contentBottom > innerHeight + Math.max(32, innerHeight * 0.1)
          : false,
    },
    activeElement: activeElement(),
    hasFocus: typeof D.hasFocus === 'function' ? D.hasFocus() : null,
    hidden: D.hidden,
    visibilityState: D.visibilityState,
    selection: cut(W.getSelection?.()?.toString?.() ?? '', 500),
    navigator: {
      userAgent: W.navigator?.userAgent ?? null,
      language: W.navigator?.language ?? null,
      languages: W.navigator?.languages ? Array.from(W.navigator.languages).slice(0, 5) : null,
      platform: W.navigator?.platform ?? null,
      vendor: W.navigator?.vendor ?? null,
      hardwareConcurrency: W.navigator?.hardwareConcurrency ?? null,
      deviceMemory: W.navigator?.deviceMemory ?? null,
      maxTouchPoints: W.navigator?.maxTouchPoints ?? null,
      onLine: W.navigator?.onLine ?? null,
      cookieEnabled: W.navigator?.cookieEnabled ?? null,
      doNotTrack: W.navigator?.doNotTrack ?? null,
      timezone:
        typeof Intl !== 'undefined' && Intl.DateTimeFormat
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || null
          : null,
    },
    media: collectMedia(),
  };

  const landmarks = collectLandmarks();
  const headings = collectHeadings();
  const forms = collectForms();
  const interactive = collectInteractive();
  const images = collectImages();
  const duplicateIds = collectDuplicateIds();
  const cssVars = collectCssVars();
  const storage = {
    localStorage: readStorage('localStorage'),
    sessionStorage: readStorage('sessionStorage'),
  };

  const issues = [];
  // Contrast is a solid-color heuristic, not a complete WCAG audit. Skip images,
  // gradients and translucent/filtered ancestry rather than guessing a backdrop.
  const colorRgb = (value) => {
    const match = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(
      value || '',
    );
    return match
      ? { rgb: match.slice(1, 4).map(Number), alpha: match[4] == null ? 1 : Number(match[4]) }
      : null;
  };
  const luminance = (rgb) =>
    rgb
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  let contrastSamples = 0;
  for (const el of summaryElements) {
    if (contrastSamples >= 12) break;
    const style = styleOf(el);
    const state = visibleState(el, style, rectOf(el));
    if (
      !state.rendered ||
      !state.hasBox ||
      !Array.from(el.childNodes || []).some((node) => node.nodeType === 3 && node.nodeValue?.trim())
    )
      continue;
    const foreground = colorRgb(styleValue(style, 'color'));
    if (!foreground || foreground.alpha !== 1) continue;
    let background = null,
      uncertain = false;
    for (
      let parent = el, depth = 0;
      parent && depth < 200;
      parent = composedParent(parent), depth += 1
    ) {
      const ancestorStyle = styleOf(parent);
      const image = styleValue(ancestorStyle, 'background-image');
      if (
        (image && image !== 'none') ||
        Number(styleValue(ancestorStyle, 'opacity') || '1') !== 1 ||
        (styleValue(ancestorStyle, 'filter') && styleValue(ancestorStyle, 'filter') !== 'none')
      ) {
        uncertain = true;
        break;
      }
      const color = colorRgb(styleValue(ancestorStyle, 'background-color'));
      if (color?.alpha === 1 && !background) background = color;
      else if (color && color.alpha > 0 && color.alpha < 1 && !background) {
        uncertain = true;
        break;
      }
    }
    if (uncertain || !background) continue;
    const a = luminance(foreground.rgb),
      b = luminance(background.rgb);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = Number.parseFloat(styleValue(style, 'font-size') || '0');
    const large = size >= 24 || (size >= 18.66 && Number(styleValue(style, 'font-weight')) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      contrastSamples += 1;
      issues.push({
        code: 'low-text-contrast',
        severity: 'warn',
        cssPath: cssPath(el),
        message: `solid-color text contrast ${round(ratio)}:1 is below ${large ? 3 : 4.5}:1 (heuristic)`,
      });
    }
  }
  if (page.metrics.horizontalOverflow) {
    issues.push({
      code: 'horizontal-document-overflow',
      severity: 'warn',
      message: `content extends beyond viewport width ${viewportWidth}px (${overflowElements.length} sampled elements)`,
      elements: overflowElements,
    });
  }
  if (page.scrollLock.trapRisk) {
    issues.push({
      code: 'scroll-lock-trap-risk',
      severity: 'error',
      message: `vertical scrolling is locked with content height ${contentBottom}px > viewport ${innerHeight}px`,
    });
  }
  const smallTargets = interactive.items.filter((item) => item.smallTouchTarget).slice(0, 20);
  for (const target of smallTargets) {
    issues.push({
      code: 'small-touch-target',
      severity: 'info',
      message: `${target.tag} ${target.accessibleName || target.text || target.cssPath} is ${target.rect?.viewport.width}x${target.rect?.viewport.height}`,
      cssPath: target.cssPath,
    });
  }
  const smallInputs = forms.items
    .filter((item) => {
      if (!item.rendered || item.type === 'hidden') return false;
      const size = Number.parseFloat(item.fontSize || '0');
      return Number.isFinite(size) && size > 0 && size < 16;
    })
    .slice(0, 20);
  for (const input of smallInputs) {
    issues.push({
      code: 'input-font-below-16px',
      severity: 'warn',
      message: `${input.tag}${input.name ? `[name="${input.name}"]` : ''} font-size ${input.fontSize} is below 16px (iOS focus-zoom and readability risk)`,
      cssPath: input.cssPath,
    });
  }
  const missingAlt = images.items.filter((item) => item.missingAlt).slice(0, 20);
  for (const image of missingAlt) {
    issues.push({
      code: 'image-missing-alt',
      severity: 'info',
      message: `img missing alt attribute (${image.src || 'no src'})`,
      cssPath: image.cssPath,
    });
  }
  for (const duplicate of duplicateIds.slice(0, 10)) {
    issues.push({
      code: 'duplicate-id',
      severity: 'warn',
      message: `id="${duplicate.id}" appears ${duplicate.count} times`,
    });
  }
  if (page.metrics.activeAnimations > 0) {
    warnings.push(
      `Page has ${page.metrics.activeAnimations} running CSS/Web animations; minor layout shifts during intentional motion are expected.`,
    );
  }

  const dom = {
    selector: config.selector || null,
    selectorMatched: rootsInfo.selectorMatched,
    matchCount: rootsInfo.matchCount,
    allMatches: Boolean(config.allMatches),
    stats,
    trees: trees.length === 1 ? trees[0] : trees,
    tree: trees.length === 1 ? trees[0] : trees,
    roots: trees.length > 1 ? trees.length : undefined,
    truncated: stats.truncated,
    warnings: Array.from(new Set(warnings)),
  };

  return {
    page,
    dom,
    landmarks,
    headings,
    forms,
    interactive,
    images,
    duplicateIds,
    cssVars,
    storage,
    issues: issues.slice(0, config.maxIssues),
    warnings: Array.from(new Set(warnings)),
  };
}
