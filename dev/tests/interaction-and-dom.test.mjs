import test from 'node:test';
import assert from 'node:assert/strict';
import {
  interactionSafety,
  diffInteractionSnapshots,
  compactDom,
  minimalSummary,
  selectSections,
  inPageProbe,
  inPageInteractionProbe,
  makeProbeConfig,
  DOM_CLEANUP_SCRIPT,
  TOOL_NAME,
  TOOL_VERSION,
  SCHEMA_VERSION,
  formatInteractiveTreeText,
  compactInteractiveTree,
} from '../../dist/agentsEye.mjs';

// ============================================================================
// 1. interactionSafety
// ============================================================================

test('interactionSafety: destructive keywords blocked by default in English', () => {
  const destructiveWords = [
    'delete', 'remove', 'drop', 'purge', 'destroy',
    'wipe', 'format', 'reset', 'pay', 'checkout',
    'buy', 'cancel subscription',
  ];

  for (const word of destructiveWords) {
    const target = {
      connected: true,
      visible: true,
      name: `Click here to ${word} now`,
    };
    const result = interactionSafety(target, false, false);
    assert.equal(
      result,
      'Potentially destructive action blocked by text safety policy',
      `Expected "${word}" to be blocked as destructive, got: ${result}`
    );
  }
});

test('interactionSafety: destructive keywords blocked in Persian/multilingual variants', () => {
  const persianDestructive = [
    'حذف حساب کاربری',
    'پاک کردن اطلاعات',
    'پرداخت فاکتور',
    'خرید اشتراک',
    'ثبت سفارش',
    'خروج از حساب',
    'ارسال پیام',
    'ذخیره تغییرات',
    'تایید نهایی',
    'تأیید عملیات',
    'لغو اشتراک ماهانه',
    'نابودسازی داده‌ها',
    'پاکسازی کش',
  ];

  for (const text of persianDestructive) {
    const target = {
      connected: true,
      visible: true,
      safetyText: text,
    };
    const result = interactionSafety(target, false, false);
    assert.equal(
      result,
      'Potentially destructive action blocked by text safety policy',
      `Expected "${text}" to be blocked as destructive in Persian, got: ${result}`
    );
  }
});

test('interactionSafety: safe actions permitted when not destructive', () => {
  const safeActions = [
    'next', 'previous', 'load more', 'expand',
    'search', 'filter', 'tab', 'details', 'show more',
  ];

  for (const label of safeActions) {
    const target = {
      connected: true,
      visible: true,
      name: label,
      toggle: false,
    };
    const result = interactionSafety(target, false, false);
    assert.equal(result, null, `Expected "${label}" to be permitted, got: ${result}`);
  }
});

test('interactionSafety: allowDestructive flag permits destructive keywords but enforces safeguards', () => {
  const destructiveTarget = {
    connected: true,
    visible: true,
    name: 'Delete Account',
  };

  // Blocked when allowDestructive is false
  assert.equal(
    interactionSafety(destructiveTarget, false, false),
    'Potentially destructive action blocked by text safety policy'
  );

  // Permitted when allowDestructive is true
  assert.equal(interactionSafety(destructiveTarget, true, false), null);

  // Structural safeguards MUST remain active even with allowDestructive: true
  const linkTarget = {
    connected: true,
    visible: true,
    navigation: true,
    name: 'Delete Account Link',
  };
  assert.equal(
    interactionSafety(linkTarget, true, false),
    'Links and navigation controls are never clicked'
  );

  const submitTarget = {
    connected: true,
    visible: true,
    submission: true,
    name: 'Delete Form Submit',
  };
  assert.equal(
    interactionSafety(submitTarget, true, false),
    'Form submission/reset controls are never clicked'
  );

  const disabledTarget = {
    connected: true,
    visible: true,
    disabled: true,
    name: 'Delete Button',
  };
  assert.equal(
    interactionSafety(disabledTarget, true, false),
    'Target or its ancestor is disabled/inert'
  );

  const detachedTarget = {
    connected: false,
    visible: true,
    name: 'Delete Button',
  };
  assert.equal(
    interactionSafety(detachedTarget, true, false),
    'Target is stale or detached'
  );

  const hiddenTarget = {
    connected: true,
    visible: false,
    name: 'Delete Button',
  };
  assert.equal(
    interactionSafety(hiddenTarget, true, false),
    'Target is hidden or outside the viewport'
  );

  const fileTarget = {
    connected: true,
    visible: true,
    file: true,
    name: 'Upload',
  };
  assert.equal(
    interactionSafety(fileTarget, true, false),
    'File controls are never clicked'
  );

  const editableTarget = {
    connected: true,
    visible: true,
    editable: true,
    name: 'Search box',
  };
  assert.equal(
    interactionSafety(editableTarget, true, false),
    'Editable and value-changing form controls are not explored'
  );

  assert.equal(interactionSafety(null, true, false), 'Target not found');
});

test('interactionSafety: allows hover on navigation controls while blocking click', () => {
  const linkTarget = {
    connected: true,
    visible: true,
    navigation: true,
    name: 'Docs Menu',
  };
  assert.equal(
    interactionSafety(linkTarget, false, false, 'click'),
    'Links and navigation controls are never clicked'
  );
  assert.equal(interactionSafety(linkTarget, false, false, 'hover'), null);
});

test('interactionSafety: automatic exploration mode vs manual interaction mode', () => {
  const plainButton = {
    connected: true,
    visible: true,
    name: 'Click me',
    toggle: false,
  };

  // In manual mode (automatic: false), plain button is allowed
  assert.equal(interactionSafety(plainButton, false, false), null);

  // In automatic mode (automatic: true), non-toggle control is rejected
  assert.equal(
    interactionSafety(plainButton, false, true),
    'Not a recognized UI toggle'
  );

  const toggleControl = {
    connected: true,
    visible: true,
    name: 'Expand Section',
    toggle: true,
  };

  // In automatic mode, recognized toggle control is allowed
  assert.equal(interactionSafety(toggleControl, false, true), null);
});

// ============================================================================
// 2. diffInteractionSnapshots
// ============================================================================

test('diffInteractionSnapshots: identical snapshots produce clean/empty diff', () => {
  const snapshot = {
    documentToken: 'doc-token-1',
    navigationToken: 0,
    url: 'http://localhost:3000/app',
    scroll: { x: 0, y: 0 },
    nodes: [
      { id: 'btn-1', tag: 'button', rect: { x: 10, y: 20, width: 100, height: 40 }, visible: true, expanded: 'false' },
      { id: 'div-2', tag: 'div', rect: { x: 10, y: 70, width: 200, height: 100 }, visible: true },
    ],
  };

  const diff = diffInteractionSnapshots(snapshot, snapshot);
  assert.ok(diff, 'Diff should not be null');
  assert.equal(diff.summary.added, 0);
  assert.equal(diff.summary.removed, 0);
  assert.equal(diff.summary.layoutChanged, 0);
  assert.equal(diff.summary.stateChanged, 0);
  assert.equal(diff.summary.navigationChanged, false);
  assert.equal(diff.summary.scrollChanged, false);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.layoutChanged.length, 0);
  assert.equal(diff.stateChanged.length, 0);
  assert.equal(diff.navigationChanged, false);
  assert.equal(diff.scrollChanged, false);
});

test('diffInteractionSnapshots: detects elements added, removed, and layout changed', () => {
  const before = {
    documentToken: 'doc-1',
    navigationToken: 0,
    nodes: [
      { id: 'node-stay', tag: 'div', rect: { x: 0, y: 0, width: 100, height: 50 }, visible: true },
      { id: 'node-remove', tag: 'span', rect: { x: 0, y: 60, width: 80, height: 20 }, visible: true },
      { id: 'node-move', tag: 'p', rect: { x: 0, y: 90, width: 200, height: 30 }, visible: true },
    ],
  };

  const after = {
    documentToken: 'doc-1',
    navigationToken: 0,
    nodes: [
      { id: 'node-stay', tag: 'div', rect: { x: 0, y: 0, width: 100, height: 50 }, visible: true },
      // node-remove is gone
      { id: 'node-add', tag: 'dialog', rect: { x: 50, y: 50, width: 300, height: 200 }, visible: true },
      // node-move shifted y by 20px
      { id: 'node-move', tag: 'p', rect: { x: 0, y: 110, width: 200, height: 30 }, visible: true },
    ],
  };

  const diff = diffInteractionSnapshots(before, after);
  assert.equal(diff.summary.added, 1);
  assert.equal(diff.added[0].id, 'node-add');
  assert.equal(diff.summary.removed, 1);
  assert.equal(diff.removed[0].id, 'node-remove');
  assert.equal(diff.summary.layoutChanged, 1);
  assert.equal(diff.layoutChanged[0].id, 'node-move');
  assert.equal(diff.layoutChanged[0].before.y, 90);
  assert.equal(diff.layoutChanged[0].after.y, 110);
});

test('diffInteractionSnapshots: detects attribute changes (aria-expanded, disabled, class)', () => {
  const before = {
    documentToken: 'doc-1',
    navigationToken: 0,
    nodes: [
      {
        id: 'toggle-btn',
        tag: 'button',
        expanded: 'false',
        disabled: false,
        class: 'btn btn-collapsed',
        rect: { x: 0, y: 0, width: 50, height: 20 },
      },
    ],
  };

  const after = {
    documentToken: 'doc-1',
    navigationToken: 0,
    nodes: [
      {
        id: 'toggle-btn',
        tag: 'button',
        expanded: 'true',
        disabled: true,
        class: 'btn btn-expanded',
        rect: { x: 0, y: 0, width: 50, height: 20 },
      },
    ],
  };

  const diff = diffInteractionSnapshots(before, after);
  assert.equal(diff.summary.stateChanged, 1);
  const changeEntry = diff.stateChanged.find((item) => item.id === 'toggle-btn');
  assert.ok(changeEntry, 'toggle-btn should be present in stateChanged');
  assert.equal(changeEntry.changes.expanded.before, 'false');
  assert.equal(changeEntry.changes.expanded.after, 'true');
  assert.equal(changeEntry.changes.disabled.before, false);
  assert.equal(changeEntry.changes.disabled.after, true);
  assert.equal(changeEntry.changes.class.before, 'btn btn-collapsed');
  assert.equal(changeEntry.changes.class.after, 'btn btn-expanded');
});

test('diffInteractionSnapshots: detects console errors/warnings and navigation/URL change', () => {
  const before = {
    documentToken: 'doc-1',
    navigationToken: 0,
    url: 'http://localhost:3000/step1',
    console: [
      { type: 'log', text: 'Initializing' },
    ],
    nodes: [],
  };

  const after = {
    documentToken: 'doc-1',
    navigationToken: 0,
    url: 'http://localhost:3000/step2',
    console: [
      { type: 'log', text: 'Initializing' },
      { type: 'error', text: 'Uncaught TypeError in handler' },
      { type: 'warn', text: 'Layout shift observed' },
    ],
    nodes: [],
  };

  const diff = diffInteractionSnapshots(before, after);
  assert.equal(diff.navigationChanged, true);
  assert.equal(diff.urlChanged, true);
  assert.equal(diff.summary.navigationChanged, true);
  assert.equal(diff.summary.consoleEvents, 2);
  assert.equal(diff.summary.newErrors, 1);
  assert.equal(diff.newErrors.length, 1);
  assert.equal(diff.newErrors[0].text, 'Uncaught TypeError in handler');
  assert.equal(diff.newWarnings.length, 1);
  assert.equal(diff.newWarnings[0].text, 'Layout shift observed');
});

test('diffInteractionSnapshots: handles null, undefined, or empty inputs gracefully', () => {
  assert.equal(diffInteractionSnapshots(null, {}), null);
  assert.equal(diffInteractionSnapshots({}, null), null);
  assert.equal(diffInteractionSnapshots(null, null), null);

  const clean = diffInteractionSnapshots({}, {});
  assert.ok(clean);
  assert.equal(clean.summary.added, 0);
  assert.equal(clean.summary.removed, 0);
  assert.equal(clean.summary.navigationChanged, false);
});

// ============================================================================
// 3. compactDom
// ============================================================================

test('compactDom: handles deeply nested DOM nodes (>10 levels)', () => {
  // Build a 15-level deeply nested tree
  let root = { tag: 'div', selector: '#level-1', children: [] };
  let current = root;
  for (let i = 2; i <= 15; i++) {
    const child = { tag: 'div', selector: `#level-${i}`, children: [] };
    current.children.push(child);
    current = child;
  }

  const compacted = compactDom({ tree: root }, 100);
  assert.ok(compacted.trees.length > 0);

  // Traverse down and verify all 15 levels are present
  let depth = 0;
  let curr = compacted.trees[0];
  while (curr) {
    depth++;
    curr = curr.children?.[0];
  }
  assert.equal(depth, 15, `Expected 15 levels deep, found: ${depth}`);
  assert.equal(compacted.truncated, false);
});

test('compactDom: truncates large text content in nodes', () => {
  const longText = 'A'.repeat(500);
  const dom = {
    tree: {
      tag: 'p',
      selector: 'p.long',
      ownText: longText,
    },
  };

  const compacted = compactDom(dom, 100);
  const text = compacted.trees[0].text;
  assert.ok(text.length <= 160, `Text length ${text.length} should be capped at 160`);
  assert.equal(text, 'A'.repeat(160));
});

test('compactDom: respects maxNodes count caps and marks truncated', () => {
  const siblings = Array.from({ length: 25 }, (_, i) => ({
    tag: 'li',
    selector: `li#item-${i}`,
  }));

  const dom = {
    tree: {
      tag: 'ul',
      selector: 'ul.list',
      children: siblings,
    },
  };

  const compacted = compactDom(dom, 8);
  assert.equal(compacted.truncated, true);

  // Count total nodes emitted
  const countNodes = (node) => 1 + (node.children || []).reduce((acc, c) => acc + countNodes(c), 0);
  const total = compacted.trees.reduce((acc, t) => acc + countNodes(t), 0);
  assert.equal(total, 8, `Expected exactly 8 nodes emitted, got: ${total}`);
});

test('compactDom: handles edge cases (null/empty DOM, unusual tag names, missing child arrays)', () => {
  // Null DOM
  const nullDom = compactDom(null);
  assert.deepEqual(nullDom.trees, []);
  assert.equal(nullDom.truncated, false);

  // Empty DOM object
  const emptyDom = compactDom({});
  assert.deepEqual(emptyDom.trees, []);

  // Unusual tag names and missing child arrays
  const unusual = {
    tree: {
      tag: 'custom-web-component:v2',
      children: null,
      shadowRoot: {
        children: undefined,
      },
    },
  };

  const compactedUnusual = compactDom(unusual);
  assert.equal(compactedUnusual.trees.length, 1);
  assert.equal(compactedUnusual.trees[0].node, 'custom-web-component:v2');

  // Ignored tags (script, style) and invisible nodes
  const filteredDom = {
    tree: {
      tag: 'body',
      children: [
        { tag: 'script', ownText: 'console.log(1)' },
        { tag: 'style', ownText: 'body { color: red; }' },
        { tag: 'div', rendered: false, selector: '#hidden-by-css' },
        { tag: 'div', ariaHidden: true, selector: '#aria-hidden' },
        { tag: 'span', selector: '#visible-span' },
      ],
    },
  };

  const compactedFiltered = compactDom(filteredDom);
  assert.equal(compactedFiltered.trees[0].children.length, 1);
  assert.equal(compactedFiltered.trees[0].children[0].node, '#visible-span');
});

// ============================================================================
// 4. minimalSummary
// ============================================================================

test('minimalSummary: accurately extracts report summary, performance, issue counts, and fatal errors', () => {
  const report = {
    ok: false,
    schemaVersion: SCHEMA_VERSION,
    target: {
      title: 'Dashboard Page',
      requestedUrl: 'http://localhost:8080/dashboard?token=xyz',
      finalUrl: 'http://localhost:8080/dashboard',
      status: 500,
    },
    run: { id: 'run-123' },
    issues: [
      { code: 'HORIZONTAL_OVERFLOW', severity: 'error', message: 'Element overflows viewport horizontally' },
      { code: 'HORIZONTAL_OVERFLOW', severity: 'error', message: 'Second overflow element' },
      { code: 'CONTRAST_LOW', severity: 'warning', message: 'Insufficient color contrast' },
    ],
    errors: {
      uncaught: [{ message: 'Fatal crash in React render' }],
      logErrors: [{ text: 'Failed to load chunk 123' }],
    },
    console: {
      counts: { error: 2, warn: 1, log: 5 },
      entries: [
        { type: 'error', text: 'Error in analytics beacon' },
      ],
    },
    performance: {
      page: {
        webVitals: {
          lcp: 1450,
          cls: 0.02,
          fcp: 820,
        },
      },
    },
  };

  const summary = minimalSummary(report);
  assert.equal(summary.ok, false);
  assert.equal(summary.status, 500);
  assert.equal(summary.target.title, 'Dashboard Page');
  assert.equal(summary.target.requestedUrl, 'http://localhost:8080/dashboard?token=xyz');
  assert.equal(summary.target.finalUrl, 'http://localhost:8080/dashboard');

  // Issue counts
  assert.equal(summary.layout.issueCounts['HORIZONTAL_OVERFLOW'], 2);
  assert.equal(summary.layout.issueCounts['CONTRAST_LOW'], 1);
  assert.equal(summary.issues.length, 3);

  // Performance stats
  assert.equal(summary.performance.lcp, 1450);
  assert.equal(summary.performance.cls, 0.02);
  assert.equal(summary.performance.fcp, 820);

  // Fatal error indicators
  assert.equal(summary.errors.uncaughtCount, 1);
  assert.equal(summary.errors.logErrorCount, 1);
  assert.equal(summary.console.errors.length, 1);
  assert.equal(summary.console.counts.error, 2);
});

test('minimalSummary: handles null or empty reports without throwing', () => {
  const empty = minimalSummary({});
  assert.ok(empty);
  assert.equal(empty.issues.length, 0);
  assert.equal(empty.errors.uncaughtCount, 0);

  const nil = minimalSummary(null);
  assert.ok(nil);
  assert.equal(nil.issues.length, 0);
  assert.equal(nil.errors.uncaughtCount, 0);
});

// ============================================================================
// 5. selectSections
// ============================================================================

test('selectSections: filters report sections using only and skip options', () => {
  const fullReport = {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    generatedAt: '2026-10-31T20:00:00Z',
    durationMs: 150,
    target: { title: 'App' },
    warnings: [],
    meta: {},
    run: { id: 'r1' },
    errors: { uncaught: [], logErrors: [] },
    dialogs: [],
    // Optional sections:
    issues: [{ code: 'c1' }],
    dom: { tree: {} },
    storage: { localStorage: {} },
    network: { requests: [] },
    console: { entries: [] },
  };

  // 1. Using only string: 'issues,dom'
  const onlyResult = selectSections(fullReport, { only: 'issues,dom' });
  assert.ok('issues' in onlyResult);
  assert.ok('dom' in onlyResult);
  assert.ok(!('storage' in onlyResult));
  assert.ok(!('network' in onlyResult));
  assert.ok(!('console' in onlyResult));
  // Mandatory sections are always preserved
  assert.ok('ok' in onlyResult);
  assert.ok('target' in onlyResult);
  assert.ok('errors' in onlyResult);

  // 2. Using skip string: 'storage,network'
  const skipResult = selectSections(fullReport, { skip: 'storage,network' });
  assert.ok('issues' in skipResult);
  assert.ok('dom' in skipResult);
  assert.ok('console' in skipResult);
  assert.ok(!('storage' in skipResult));
  assert.ok(!('network' in skipResult));

  // 3. Combining only and skip
  const comboResult = selectSections(fullReport, { only: 'issues,dom,storage', skip: 'storage' });
  assert.ok('issues' in comboResult);
  assert.ok('dom' in comboResult);
  assert.ok(!('storage' in comboResult));
  assert.ok(!('network' in comboResult));

  // 4. Using array format
  const arrayResult = selectSections(fullReport, { only: ['issues'], skip: ['dom'] });
  assert.ok('issues' in arrayResult);
  assert.ok(!('dom' in arrayResult));
  assert.ok(!('storage' in arrayResult));
});

test('selectSections: handles edge cases (empty strings, non-existent sections, null inputs)', () => {
  const report = {
    ok: true,
    target: { title: 'Test' },
    issues: [],
    dom: {},
  };

  // Empty string in only/skip should be gracefully ignored (return all sections)
  const emptyOnly = selectSections(report, { only: '' });
  assert.ok('issues' in emptyOnly);
  assert.ok('dom' in emptyOnly);

  const emptySkip = selectSections(report, { skip: '' });
  assert.ok('issues' in emptySkip);
  assert.ok('dom' in emptySkip);

  // Non-existent section in only
  const nonExistent = selectSections(report, { only: 'nonExistentSection,issues' });
  assert.ok('issues' in nonExistent);
  assert.ok(!('dom' in nonExistent));

  // Null/undefined options or report
  assert.equal(selectSections(null, { only: 'issues' }), null);
  const noOpts = selectSections(report);
  assert.deepEqual(noOpts, report);
});

// ============================================================================
// 6. inPageProbe Universal Semantic Ref Indexing (@eN)
// ============================================================================

function createMockElement(tag, attrs = {}, children = []) {
  const attrMap = new Map(Object.entries(attrs));
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    children,
    childNodes: children,
    childElementCount: children.length,
    get attributes() {
      return Array.from(attrMap.entries()).map(([name, value]) => ({ name, value }));
    },
    closest: () => null,
    getAttribute: (k) => attrMap.get(k) ?? null,
    hasAttribute: (k) => attrMap.has(k),
    setAttribute: (k, v) => attrMap.set(k, String(v)),
    removeAttribute: (k) => attrMap.delete(k),
    matches: (s) => {
      if (s.includes('button') && tag === 'button') return true;
      if (s.includes('a[href]') && tag === 'a' && attrMap.has('href')) return true;
      if (s.includes('summary') && tag === 'summary') return true;
      if (s.includes('[role="tab"]') && attrMap.get('role') === 'tab') return true;
      return false;
    },
    contains(candidate) {
      if (candidate === this) return true;
      return children.some((child) => (child.contains ? child.contains(candidate) : child === candidate));
    },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 40, top: 0, bottom: 40, left: 0, right: 100 }),
  };
  return el;
}

test('inPageProbe assigns sequential @e1..@eN refs to all interactive elements', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;

  try {
    const btn1 = createMockElement('button', { id: 'btn-1', 'aria-label': 'Submit Form' });
    const link1 = createMockElement('a', { href: 'https://example.com/docs' }, []);
    const tab1 = createMockElement('div', { role: 'tab', 'aria-label': 'Settings Tab' });
    const body = createMockElement('body', {}, [btn1, link1, tab1]);
    const html = createMockElement('html', {}, [body]);

    const mockDoc = {
      documentElement: html,
      body,
      title: 'Test Ref Suite',
      readyState: 'complete',
      contentType: 'text/html',
      characterSet: 'UTF-8',
      compatMode: 'CSS1Compat',
      querySelector: () => null,
    };

    const mockWin = {
      location: { href: 'http://localhost/test' },
      innerWidth: 1024,
      innerHeight: 768,
      scrollX: 0,
      scrollY: 0,
      getComputedStyle: () => ({
        getPropertyValue: (p) => (p === 'visibility' ? 'visible' : p === 'display' ? 'block' : ''),
        visibility: 'visible',
        display: 'block',
        opacity: '1',
        cursor: 'default',
      }),
    };

    globalThis.document = mockDoc;
    globalThis.window = mockWin;

    const config = makeProbeConfig({ styleProps: [] });
    const report = inPageProbe(config);

    assert.ok(report.interactive);
    assert.equal(report.interactive.items.length, 3);
    assert.equal(report.interactive.truncated, false);

    assert.equal(report.interactive.items[0].ref, '@e1');
    assert.equal(report.interactive.items[0].tag, 'button');
    assert.equal(report.interactive.items[0].accessibleName, 'Submit Form');
    assert.equal(btn1.getAttribute('data-agentseye-ref'), 'e1');

    assert.equal(report.interactive.items[1].ref, '@e2');
    assert.equal(report.interactive.items[1].tag, 'a');
    assert.equal(link1.getAttribute('data-agentseye-ref'), 'e2');

    assert.equal(report.interactive.items[2].ref, '@e3');
    assert.equal(report.interactive.items[2].role, 'tab');
    assert.equal(tab1.getAttribute('data-agentseye-ref'), 'e3');

    const reg = mockWin.__agentsEyeRefsV1;
    assert.ok(reg);
    assert.equal(reg.map.get('@e1'), btn1);
    assert.equal(reg.map.get('e1'), btn1);
    assert.equal(reg.map.get('1'), btn1);
    assert.equal(reg.map.get('@e2'), link1);
    assert.equal(reg.map.get('@e3'), tab1);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
  }
});

test('inPageProbe filters out data-agentseye-ref from element attributes in dom tree', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;

  try {
    const btn = createMockElement('button', {
      id: 'pre-tagged',
      'data-agentseye-ref': 'e99',
      class: 'btn',
    });
    const body = createMockElement('body', {}, [btn]);
    const html = createMockElement('html', {}, [body]);

    const mockDoc = {
      documentElement: html,
      body,
      title: 'Probe Leak Test',
      readyState: 'complete',
      contentType: 'text/html',
      characterSet: 'UTF-8',
      compatMode: 'CSS1Compat',
      querySelector: () => null,
    };

    const mockWin = {
      location: { href: 'http://localhost/test' },
      innerWidth: 1024,
      innerHeight: 768,
      scrollX: 0,
      scrollY: 0,
      getComputedStyle: () => ({
        getPropertyValue: (p) => (p === 'visibility' ? 'visible' : p === 'display' ? 'block' : ''),
        visibility: 'visible',
        display: 'block',
        opacity: '1',
        cursor: 'default',
      }),
    };

    globalThis.document = mockDoc;
    globalThis.window = mockWin;

    const config = makeProbeConfig({ styleProps: [], maxDepth: 10 });
    const report = inPageProbe(config);

    const btnDomNode = report.dom?.tree?.children?.[0]?.children?.[0];
    assert.ok(btnDomNode);
    assert.equal(btnDomNode.attributes?.id, 'pre-tagged');
    assert.equal(btnDomNode.attributes?.['data-agentseye-ref'], undefined);
    assert.equal(btnDomNode.attributeCount, 2); // 'id' and 'class' (not counting data-agentseye-ref)
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
  }
});

test('inPageProbe respects --interactive-scope container boundary', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;

  try {
    const modalBtn = createMockElement('button', { id: 'modal-confirm', 'aria-label': 'Confirm' });
    const modal = createMockElement('div', { id: 'modal-container' }, [modalBtn]);
    const outsideBtn = createMockElement('button', { id: 'outside-btn', 'aria-label': 'Outside' });
    const body = createMockElement('body', {}, [modal, outsideBtn]);
    const html = createMockElement('html', {}, [body]);

    const mockDoc = {
      documentElement: html,
      body,
      title: 'Scoped Test',
      readyState: 'complete',
      contentType: 'text/html',
      characterSet: 'UTF-8',
      compatMode: 'CSS1Compat',
      querySelector: (selector) => (selector === '#modal-container' ? modal : null),
    };

    const mockWin = {
      location: { href: 'http://localhost/test' },
      innerWidth: 1024,
      innerHeight: 768,
      scrollX: 0,
      scrollY: 0,
      getComputedStyle: () => ({
        getPropertyValue: (p) => (p === 'visibility' ? 'visible' : p === 'display' ? 'block' : ''),
        visibility: 'visible',
        display: 'block',
        opacity: '1',
        cursor: 'default',
      }),
    };

    globalThis.document = mockDoc;
    globalThis.window = mockWin;

    const config = makeProbeConfig({ styleProps: [], interactiveScope: '#modal-container' });
    const report = inPageProbe(config);

    assert.ok(report.interactive);
    assert.equal(report.interactive.items.length, 1);
    assert.equal(report.interactive.items[0].ref, '@e1');
    assert.equal(report.interactive.items[0].accessibleName, 'Confirm');
    assert.equal(modalBtn.getAttribute('data-agentseye-ref'), 'e1');
    assert.equal(outsideBtn.getAttribute('data-agentseye-ref'), null);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
  }
});

// ============================================================================
// 7. inPageInteractionProbe Semantic Ref Resolution & Safety Gates
// ============================================================================

test('Ref resolution locates target by @eN and dispatches click', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;
  const prevLoc = globalThis.location;
  const prevPerf = globalThis.performance;

  try {
    const btn = createMockElement('button', { id: 'btn-target', 'aria-label': 'Safe Action' });
    btn.isConnected = true;
    btn.getClientRects = () => [{ x: 10, y: 10, width: 100, height: 40 }];
    btn.getRootNode = () => mockDoc;

    const mockDoc = {
      documentElement: btn,
      querySelectorAll: () => [btn],
      querySelector: () => btn,
      elementFromPoint: () => btn,
      location: { href: 'http://localhost/test', origin: 'http://localhost', pathname: '/test' },
    };

    const mockWin = {
      innerWidth: 1024,
      innerHeight: 768,
      getComputedStyle: () => ({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
      }),
    };

    globalThis.document = mockDoc;
    globalThis.window = mockWin;
    globalThis.location = mockDoc.location;
    globalThis.performance = { timeOrigin: 100 };
    globalThis.innerWidth = 1024;
    globalThis.innerHeight = 768;
    globalThis.getComputedStyle = mockWin.getComputedStyle;
    globalThis.__agentsEyeRefsV1 = {
      map: new Map([
        ['@e1', btn],
        ['e1', btn],
        ['1', btn],
      ]),
      document: mockDoc,
      nextId: 2,
    };

    const result = inPageInteractionProbe({ op: 'target', selector: '@e1' }, interactionSafety);
    assert.equal(result.reason, null);
    assert.ok(result.point);
    assert.equal(result.target.name, 'Safe Action');
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
    globalThis.location = prevLoc;
    globalThis.performance = prevPerf;
  }
});

test('Ref resolution gracefully skips stale or missing @eN refs with explicit reason', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;
  const prevLoc = globalThis.location;
  const prevPerf = globalThis.performance;

  try {
    const mockDoc = {
      querySelectorAll: () => [],
      querySelector: () => null,
      location: { href: 'http://localhost/test', origin: 'http://localhost', pathname: '/test' },
    };

    globalThis.document = mockDoc;
    globalThis.location = mockDoc.location;
    globalThis.performance = { timeOrigin: 100 };
    globalThis.__agentsEyeRefsV1 = {
      map: new Map(),
      document: mockDoc,
      nextId: 1,
    };

    const result = inPageInteractionProbe({ op: 'target', selector: '@e42' }, interactionSafety);
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'Element ref @e42 not found or stale');
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
    globalThis.location = prevLoc;
    globalThis.performance = prevPerf;
  }
});

test('Ref safety gates strictly block clicks on navigation links and submit buttons targeting @eN', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;
  const prevLoc = globalThis.location;
  const prevPerf = globalThis.performance;

  try {
    const link = createMockElement('a', { href: 'https://example.com/dest' });
    link.isConnected = true;
    link.getClientRects = () => [{ x: 10, y: 10, width: 100, height: 40 }];
    link.getRootNode = () => mockDoc;

    const submit = createMockElement('button', { type: 'submit' });
    submit.isConnected = true;
    submit.getClientRects = () => [{ x: 10, y: 10, width: 100, height: 40 }];
    submit.getRootNode = () => mockDoc;

    const mockDoc = {
      querySelectorAll: () => [link, submit],
      querySelector: () => null,
      elementFromPoint: () => null,
      location: { href: 'http://localhost/test', origin: 'http://localhost', pathname: '/test' },
    };

    globalThis.document = mockDoc;
    globalThis.location = mockDoc.location;
    globalThis.performance = { timeOrigin: 100 };
    globalThis.innerWidth = 1024;
    globalThis.innerHeight = 768;
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    globalThis.__agentsEyeRefsV1 = {
      map: new Map([
        ['@e1', link],
        ['@e2', submit],
      ]),
      document: mockDoc,
      nextId: 3,
    };

    const linkRes = inPageInteractionProbe({ op: 'target', selector: '@e1' }, interactionSafety);
    assert.equal(linkRes.reason, 'Links and navigation controls are never clicked');

    const submitRes = inPageInteractionProbe({ op: 'target', selector: '@e2' }, interactionSafety);
    assert.equal(submitRes.reason, 'Form submission/reset controls are never clicked');
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
    globalThis.location = prevLoc;
    globalThis.performance = prevPerf;
  }
});

test('Ref safety gates block destructive English and Persian keywords on @eN targets', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;
  const prevLoc = globalThis.location;
  const prevPerf = globalThis.performance;

  try {
    const deleteBtn = createMockElement('button', { 'aria-label': 'Delete repository permanently' });
    deleteBtn.isConnected = true;
    deleteBtn.getClientRects = () => [{ x: 10, y: 10, width: 100, height: 40 }];
    deleteBtn.getRootNode = () => mockDoc;

    const persianBtn = createMockElement('button', { 'aria-label': 'حذف حساب کاربری' });
    persianBtn.isConnected = true;
    persianBtn.getClientRects = () => [{ x: 10, y: 10, width: 100, height: 40 }];
    persianBtn.getRootNode = () => mockDoc;

    const mockDoc = {
      querySelectorAll: () => [deleteBtn, persianBtn],
      querySelector: () => null,
      elementFromPoint: () => null,
      location: { href: 'http://localhost/test', origin: 'http://localhost', pathname: '/test' },
    };

    globalThis.document = mockDoc;
    globalThis.location = mockDoc.location;
    globalThis.performance = { timeOrigin: 100 };
    globalThis.innerWidth = 1024;
    globalThis.innerHeight = 768;
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    globalThis.__agentsEyeRefsV1 = {
      map: new Map([
        ['@e1', deleteBtn],
        ['@e2', persianBtn],
      ]),
      document: mockDoc,
      nextId: 3,
    };

    const deleteRes = inPageInteractionProbe({ op: 'target', selector: '@e1' }, interactionSafety);
    assert.equal(deleteRes.reason, 'Potentially destructive action blocked by text safety policy');

    const persianRes = inPageInteractionProbe({ op: 'target', selector: '@e2' }, interactionSafety);
    assert.equal(persianRes.reason, 'Potentially destructive action blocked by text safety policy');
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
    globalThis.location = prevLoc;
    globalThis.performance = prevPerf;
  }
});

test('--scroll @eN successfully calls scrollIntoView on target element', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;
  const prevLoc = globalThis.location;
  const prevPerf = globalThis.performance;

  try {
    let scrollOptionsPassed = null;
    const targetEl = createMockElement('div', { id: 'section-heading' });
    targetEl.isConnected = true;
    targetEl.scrollIntoView = (options) => {
      scrollOptionsPassed = options;
    };
    targetEl.getClientRects = () => [{ x: 10, y: 10, width: 100, height: 40 }];
    targetEl.getRootNode = () => mockDoc;

    const mockDoc = {
      querySelectorAll: () => [targetEl],
      querySelector: () => targetEl,
      location: { href: 'http://localhost/test', origin: 'http://localhost', pathname: '/test' },
    };

    globalThis.document = mockDoc;
    globalThis.location = mockDoc.location;
    globalThis.performance = { timeOrigin: 100 };
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    globalThis.__agentsEyeRefsV1 = {
      map: new Map([['@e5', targetEl]]),
      document: mockDoc,
      nextId: 6,
    };

    const result = inPageInteractionProbe({ op: 'scrollIntoView', selector: '@e5' }, interactionSafety);
    assert.equal(result.status, 'applied');
    assert.equal(result.target, '@e5');
    assert.deepEqual(scrollOptionsPassed, { behavior: 'instant', block: 'center', inline: 'center' });
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
    globalThis.location = prevLoc;
    globalThis.performance = prevPerf;
  }
});

test('DOM hygiene cleans up data-agentseye-ref attributes after inspection', () => {
  const prevDoc = globalThis.document;
  const prevRefs = globalThis.__agentsEyeRefsV1;

  try {
    const btn = createMockElement('button', { 'data-agentseye-ref': '1' });
    const link = createMockElement('a', { 'data-agentseye-ref': '2' });
    const taggedElements = [btn, link];

    const mockDoc = {
      querySelectorAll: (sel) => {
        if (sel === '[data-agentseye-ref]') {
          return taggedElements.filter((el) => el.hasAttribute('data-agentseye-ref'));
        }
        return [];
      },
    };

    globalThis.document = mockDoc;
    globalThis.__agentsEyeRefsV1 = {
      map: new Map([
        ['@e1', btn],
        ['@e2', link],
      ]),
      document: mockDoc,
    };

    // Execute DOM_CLEANUP_SCRIPT
    new Function(DOM_CLEANUP_SCRIPT)();

    assert.equal(btn.getAttribute('data-agentseye-ref'), null);
    assert.equal(link.getAttribute('data-agentseye-ref'), null);
    assert.equal(globalThis.__agentsEyeRefsV1, undefined);
  } finally {
    globalThis.document = prevDoc;
    globalThis.__agentsEyeRefsV1 = prevRefs;
  }
});

test('inPageProbe skips child elements whose cursor: pointer is inherited from parentElement', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;

  try {
    const childSpan = createMockElement('span', { id: 'inner-label' });
    const parentCard = createMockElement('div', { id: 'card-container' }, [childSpan]);
    childSpan.parentElement = parentCard;
    const body = createMockElement('body', {}, [parentCard]);
    parentCard.parentElement = body;
    body.parentElement = null;
    const html = createMockElement('html', {}, [body]);

    const mockDoc = {
      documentElement: html,
      body,
      title: 'Inherited Cursor Test',
      readyState: 'complete',
      contentType: 'text/html',
      characterSet: 'UTF-8',
      compatMode: 'CSS1Compat',
      querySelector: () => null,
    };

    const mockWin = {
      location: { href: 'http://localhost/cursor-test' },
      innerWidth: 1024,
      innerHeight: 768,
      scrollX: 0,
      scrollY: 0,
      getComputedStyle: (el) => {
        const isPointer = el === parentCard || el === childSpan;
        return {
          getPropertyValue: (p) =>
            p === 'cursor' ? (isPointer ? 'pointer' : 'default') : p === 'visibility' ? 'visible' : 'block',
          visibility: 'visible',
          display: 'block',
          opacity: '1',
          cursor: isPointer ? 'pointer' : 'default',
        };
      },
    };

    globalThis.document = mockDoc;
    globalThis.window = mockWin;

    const config = makeProbeConfig({ styleProps: [] });
    const report = inPageProbe(config);

    assert.ok(report.interactive);
    // Only parentCard should be indexed; childSpan should be skipped
    assert.equal(report.interactive.items.length, 1);
    assert.equal(report.interactive.items[0].ref, '@e1');
    assert.equal(parentCard.getAttribute('data-agentseye-ref'), 'e1');
    assert.equal(childSpan.getAttribute('data-agentseye-ref'), null);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
  }
});

test('inPageInteractionProbe reports blocker descriptor when target is covered', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;
  const prevLoc = globalThis.location;
  const prevPerf = globalThis.performance;

  try {
    const targetEl = createMockElement('button', { id: 'target-btn' });
    targetEl.isConnected = true;
    targetEl.getClientRects = () => [{ x: 10, y: 10, width: 80, height: 20 }];
    targetEl.getRootNode = () => mockDoc;

    const blockerEl = createMockElement('header', { id: 'sticky-nav', class: 'navbar sticky' });
    blockerEl.className = 'navbar sticky';
    blockerEl.classList = ['navbar', 'sticky'];

    const mockDoc = {
      querySelectorAll: () => [targetEl],
      querySelector: () => targetEl,
      elementFromPoint: () => blockerEl,
      location: { href: 'http://localhost/test', origin: 'http://localhost', pathname: '/test' },
    };

    globalThis.document = mockDoc;
    globalThis.location = mockDoc.location;
    globalThis.performance = { timeOrigin: 100 };
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    globalThis.innerWidth = 1024;
    globalThis.innerHeight = 768;

    const result = inPageInteractionProbe({ selector: '#target-btn' }, interactionSafety);
    assert.match(result.reason, /^Target is covered by <header#sticky-nav\.navbar\.sticky> at click point \(\d+, \d+\)$/);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
    globalThis.location = prevLoc;
    globalThis.performance = prevPerf;
  }
});

test('inPageInteractionProbe considers hit-testing valid when label or span of checkbox is hit', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;
  const prevLoc = globalThis.location;
  const prevPerf = globalThis.performance;

  try {
    const inputEl = createMockElement('input', { type: 'checkbox', id: 'terms-chk' });
    inputEl.type = 'checkbox';
    inputEl.isConnected = true;
    inputEl.getClientRects = () => [{ x: 10, y: 10, width: 20, height: 20 }];
    inputEl.getRootNode = () => mockDoc;

    const spanEl = createMockElement('span', { class: 'custom-check' });
    const labelEl = createMockElement('label', { class: 'checkbox-wrap' }, [inputEl, spanEl]);
    labelEl.control = inputEl;
    spanEl.closest = (tag) => (tag === 'label' ? labelEl : null);
    inputEl.closest = (tag) => (tag === 'label' ? labelEl : null);

    const mockDoc = {
      querySelectorAll: () => [inputEl],
      querySelector: () => inputEl,
      elementFromPoint: () => spanEl,
      location: { href: 'http://localhost/test', origin: 'http://localhost', pathname: '/test' },
    };

    globalThis.document = mockDoc;
    globalThis.location = mockDoc.location;
    globalThis.performance = { timeOrigin: 100 };
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    globalThis.innerWidth = 1024;
    globalThis.innerHeight = 768;

    const result = inPageInteractionProbe({ selector: '#terms-chk' }, interactionSafety);
    assert.equal(result.reason, null);
    assert.ok(result.point);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
    globalThis.location = prevLoc;
    globalThis.performance = prevPerf;
  }
});

test('inPageInteractionProbe resolves uppercase @E1 case-insensitively', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;
  const prevLoc = globalThis.location;
  const prevPerf = globalThis.performance;

  try {
    const targetEl = createMockElement('button', { id: 'btn' });
    targetEl.isConnected = true;
    targetEl.getClientRects = () => [{ x: 10, y: 10, width: 100, height: 40 }];
    targetEl.getRootNode = () => mockDoc;

    const mockDoc = {
      querySelectorAll: () => [targetEl],
      querySelector: () => targetEl,
      elementFromPoint: () => targetEl,
      location: { href: 'http://localhost/test', origin: 'http://localhost', pathname: '/test' },
    };

    globalThis.document = mockDoc;
    globalThis.location = mockDoc.location;
    globalThis.performance = { timeOrigin: 100 };
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    globalThis.innerWidth = 1024;
    globalThis.innerHeight = 768;
    globalThis.__agentsEyeRefsV1 = {
      map: new Map([['@e1', targetEl]]),
      document: mockDoc,
      nextId: 2,
    };

    const result = inPageInteractionProbe({ selector: '@E1' }, interactionSafety);
    assert.equal(result.reason, null);
    assert.ok(result.point);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
    globalThis.location = prevLoc;
    globalThis.performance = prevPerf;
  }
});

test('inPageInteractionProbe scrollIntoView survives form property shadowing', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRefs = globalThis.__agentsEyeRefsV1;
  const prevLoc = globalThis.location;
  const prevPerf = globalThis.performance;
  const prevElement = globalThis.Element;

  let scrollCalledWith = null;
  class MockElementClass {}
  MockElementClass.prototype.scrollIntoView = function (options) {
    scrollCalledWith = { target: this, options };
  };
  globalThis.Element = MockElementClass;

  try {
    const formEl = createMockElement('form', { id: 'my-form' });
    formEl.isConnected = true;
    // Simulate property shadowing: form.scrollIntoView is an input element, not a function!
    formEl.scrollIntoView = { tagName: 'INPUT', name: 'scrollIntoView' };
    formEl.getClientRects = () => [{ x: 10, y: 10, width: 100, height: 40 }];
    formEl.getRootNode = () => mockDoc;

    const mockDoc = {
      querySelectorAll: () => [formEl],
      querySelector: () => formEl,
      location: { href: 'http://localhost/test', origin: 'http://localhost', pathname: '/test' },
    };

    globalThis.document = mockDoc;
    globalThis.location = mockDoc.location;
    globalThis.performance = { timeOrigin: 100 };
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    globalThis.__agentsEyeRefsV1 = {
      map: new Map([['@e1', formEl]]),
      document: mockDoc,
      nextId: 2,
    };

    const result = inPageInteractionProbe({ op: 'scrollIntoView', selector: '@e1' }, interactionSafety);
    assert.equal(result.status, 'applied');
    assert.ok(scrollCalledWith);
    assert.equal(scrollCalledWith.target, formEl);
    assert.deepEqual(scrollCalledWith.options, { behavior: 'instant', block: 'center', inline: 'center' });
  } finally {
    globalThis.Element = prevElement;
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.__agentsEyeRefsV1 = prevRefs;
    globalThis.location = prevLoc;
    globalThis.performance = prevPerf;
  }
});

test('DOM hygiene recursively scrubs data-agentseye-ref from nested shadow roots', () => {
  const prevDoc = globalThis.document;
  const prevRefs = globalThis.__agentsEyeRefsV1;

  try {
    const innerBtn = createMockElement('button', { 'data-agentseye-ref': 'e9' });
    const shadowRoot2 = {
      querySelectorAll: (sel) => {
        if (sel === '[data-agentseye-ref]') return [innerBtn];
        if (sel === '*') return [innerBtn];
        return [];
      },
    };

    const childHost = createMockElement('div', { id: 'child-host' });
    childHost.shadowRoot = shadowRoot2;

    const shadowRoot1 = {
      querySelectorAll: (sel) => {
        if (sel === '[data-agentseye-ref]') return [];
        if (sel === '*') return [childHost];
        return [];
      },
    };

    const parentHost = createMockElement('div', { id: 'parent-host' });
    parentHost.shadowRoot = shadowRoot1;

    const mockDoc = {
      querySelectorAll: (sel) => {
        if (sel === '[data-agentseye-ref]') return [];
        if (sel === '*') return [parentHost];
        return [];
      },
    };

    globalThis.document = mockDoc;
    globalThis.__agentsEyeRefsV1 = {
      map: new Map([['@e9', innerBtn]]),
      document: mockDoc,
    };

    new Function(DOM_CLEANUP_SCRIPT)();

    assert.equal(innerBtn.getAttribute('data-agentseye-ref'), null);
    assert.equal(globalThis.__agentsEyeRefsV1, undefined);
  } finally {
    globalThis.document = prevDoc;
    globalThis.__agentsEyeRefsV1 = prevRefs;
  }
});

// ============================================================================
// 6. formatInteractiveTreeText & compactInteractiveTree
// ============================================================================

test('formatInteractiveTreeText: formats interactive items into ultra-dense indented text', () => {
  const items = [
    { ref: '@e1', role: 'heading', name: 'Log in', level: 1, depth: 0 },
    {
      role: 'form',
      depth: 0,
    },
    {
      ref: '@e2',
      tag: 'input',
      role: 'textbox',
      type: 'email',
      placeholder: 'Email address',
      required: true,
      depth: 1,
    },
    {
      ref: '@e3',
      tag: 'button',
      role: 'button',
      name: 'Continue',
      depth: 1,
      disabled: true,
      url: 'https://example.com/submit',
    },
  ];

  const text = formatInteractiveTreeText(items, { urls: true });
  assert.ok(text.includes('@e1 [heading] "Log in" [level=1, ref=@e1]'));
  assert.ok(text.includes('  @e2 [textbox] [type="email", placeholder="Email address", required, ref=@e2]'));
  assert.ok(text.includes('  @e3 [button] "Continue" [disabled, url="https://example.com/submit", ref=@e3]'));
});

test('formatInteractiveTreeText: handles empty items and depth limit', () => {
  assert.equal(formatInteractiveTreeText([]), '(no interactive elements)\n');
  assert.equal(formatInteractiveTreeText(null), '(no interactive elements)\n');

  const items = [
    { ref: '@e1', role: 'banner', depth: 0 },
    { ref: '@e2', role: 'button', depth: 2 },
  ];
  const depthZero = formatInteractiveTreeText(items, { depth: 0 });
  assert.ok(depthZero.includes('@e1'));
  assert.ok(!depthZero.includes('@e2'));
});

test('compactInteractiveTree: prunes empty structural wrappers while preserving ancestors', () => {
  const rawTree = [
    '[generic]',
    '  [generic]',
    '    @e1 [button] "Submit" [ref=@e1]',
    '  [generic]',
    '    [generic]',
    '',
  ].join('\n');

  const compacted = compactInteractiveTree(rawTree);
  assert.ok(compacted.includes('[generic]'));
  assert.ok(compacted.includes('@e1 [button] "Submit" [ref=@e1]'));
  // The second empty [generic] branch must be pruned
  const lines = compacted.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '[generic]');
  assert.equal(lines[1], '  [generic]');
  assert.equal(lines[2], '    @e1 [button] "Submit" [ref=@e1]');
});

test('compactInteractiveTree: returns (no interactive elements) if all pruned', () => {
  const rawTree = [
    '[generic]',
    '  [generic]',
    '',
  ].join('\n');

  assert.equal(compactInteractiveTree(rawTree), '(no interactive elements)\n');
});
