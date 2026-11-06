import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  parseViewport,
  queryReport,
  focusReport,
  minimalSummary,
  validateElementLocator,
  TAILWIND_VIEWPORTS,
} from '../../dist/agentsEye.mjs';

// --- Seam 1: Viewport Presets & Desktop Dimensions ---
test('parseViewport: supports desktop and tablet presets as intuitive aliases', () => {
  const desktop = parseViewport('desktop');
  assert.equal(desktop.width, 1280);
  assert.equal(desktop.height, 800);
  assert.equal(desktop.mobile, false);

  const tablet = parseViewport('tablet');
  assert.equal(tablet.width, 768);
  assert.equal(tablet.height, 1024);
  assert.equal(tablet.mobile, false);

  assert.equal(Object.hasOwn(TAILWIND_VIEWPORTS, 'desktop'), true);
  assert.equal(Object.hasOwn(TAILWIND_VIEWPORTS, 'tablet'), true);
});

test('parseArgs: --desktop or --no-mobile defaults viewport dimensions to 1280x800', () => {
  const opts = parseArgs(['https://example.com', '--desktop']);
  assert.equal(opts.viewport.mobile, false);
  assert.equal(opts.viewport.width, 1280);
  assert.equal(opts.viewport.height, 800);

  // If user passes explicit custom width or height, that must take precedence
  const custom = parseArgs(['https://example.com', '--desktop', '--width', '1920']);
  assert.equal(custom.viewport.width, 1920);
});

// --- Seam 2: CSS Vars Cap & Token Budget Protection ---
test('minimalSummary: caps massive cssVars into compact summary preserving token budget', () => {
  const mockVars = {};
  for (let i = 0; i < 150; i++) {
    mockVars[`--custom-theme-var-${i}`] = `#abcdef${i}`;
  }
  const report = {
    ok: true,
    target: { requestedUrl: 'https://example.com', finalUrl: 'https://example.com', title: 'Example' },
    cssVars: { count: 150, vars: mockVars },
    issues: [],
    errors: { uncaught: [], logErrors: [] },
  };

  const summary = minimalSummary(report);
  assert.equal(summary.cssVars.truncated, true);
  assert.equal(Object.keys(summary.cssVars.vars).length <= 20, true);
});

// --- Seam 3: Form Controls & Actionable Ordering in Interactive List ---
test('minimalSummary: includes type for input elements in interactive list', () => {
  const report = {
    ok: true,
    interactive: {
      total: 3,
      showing: 3,
      items: [
        { ref: '@e1', tag: 'input', type: 'radio', name: 'Small', accessibleName: 'Small' },
        { ref: '@e2', tag: 'input', type: 'checkbox', name: 'Extra Cheese', accessibleName: 'Extra Cheese' },
        { ref: '@e3', tag: 'input', type: 'text', name: 'Customer name', accessibleName: 'Customer name' },
      ],
    },
    issues: [],
    errors: { uncaught: [], logErrors: [] },
  };

  const summary = minimalSummary(report);
  assert.equal(summary.interactive.items[0].type, 'radio');
  assert.equal(summary.interactive.items[1].type, 'checkbox');
  assert.equal(summary.interactive.items[2].type, 'text');
});

test('minimalSummary: prioritizes actionable controls before passive navigation links', () => {
  const items = [];
  // 15 navigation links first
  for (let i = 1; i <= 15; i++) {
    items.push({ ref: `@e${i}`, tag: 'a', href: `/link-${i}`, name: `Link ${i}`, accessibleName: `Link ${i}`, rendered: true });
  }
  // Then a button and an input
  items.push({ ref: '@e16', tag: 'button', name: 'Submit', accessibleName: 'Submit', rendered: true });
  items.push({ ref: '@e17', tag: 'input', type: 'text', name: 'Search', accessibleName: 'Search', rendered: true });

  const report = {
    ok: true,
    interactive: { total: 17, showing: 17, items },
    issues: [],
    errors: { uncaught: [], logErrors: [] },
  };

  const summary = minimalSummary(report);
  // The first items should be actionable buttons/inputs, preventing them from being pushed out of the 12 limit
  const firstTags = summary.interactive.items.map((i) => i.tag);
  assert.equal(firstTags.includes('button'), true);
  assert.equal(firstTags.includes('input'), true);
});

// --- Seam 4: PowerShell Variable Splatting Error Guidance ---
test('validateElementLocator: offers PowerShell splatting tip when locator receives flag', () => {
  assert.throws(
    () => validateElementLocator('--temp', '--click'),
    (err) => {
      return (
        err.message.includes('--click expects a selector or @eN locator, received flag: --temp') &&
        err.message.includes('PowerShell') &&
        err.message.includes('bare "e1"')
      );
    }
  );
});

// --- Seam 5: Offline Headings Outline Resolution ---
test('queryReport: resolves headingsOutline even when stored under headings', () => {
  const report = {
    headings: {
      count: 2,
      items: [
        { level: 1, text: 'Main Title' },
        { level: 2, text: 'Section One' },
      ],
    },
  };

  const res = queryReport(report, 'headingsOutline');
  assert.deepEqual(res.data, ['h1: Main Title', 'h2: Section One']);

  const dotted = queryReport(report, 'headings.outline');
  assert.deepEqual(dotted.data, ['h1: Main Title', 'h2: Section One']);
});

// --- Seam 6: Network Focus Slice Trimming ---
test('focusReport: network slice supports compact mode to prune full requests array', () => {
  const report = {
    network: {
      summary: { total: 100, failed: 1 },
      failures: [{ url: 'https://example.com/fail', status: 500 }],
      slowest: [{ url: 'https://example.com/slow', durationMs: 2500 }],
      requests: new Array(100).fill({ url: 'https://example.com/req', status: 200 }),
    },
  };

  const sliced = focusReport(report, 'network', { compact: true });
  assert.equal(sliced.network.summary.total, 100);
  assert.equal(sliced.network.failures.length, 1);
  assert.equal(sliced.network.slowest.length, 1);
  assert.equal(sliced.network.requests, undefined);
});
