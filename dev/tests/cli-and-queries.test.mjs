import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  parseViewport,
  queryReport,
  focusReport,
  minimalSummary,
  formatText,
  TAILWIND_VIEWPORTS,
  MATRIX_VIEWPORTS,
  DEFAULTS,
  SCHEMA_VERSION,
  REF_PREFIX,
  REF_REGEX,
  REF_ATTR,
  REF_REGISTRY_SLOT,
  DEFAULT_SUMMARY_INTERACTIVE_LIMIT,
  FOCUS_SLICES,
} from '../../agentsEye.mjs';

test('parseArgs: valid flags and viewport parsing', () => {
  const options = parseArgs(['http://example.com', '--viewport', '375x812', '--focus', 'issues', '--quiet']);
  assert.equal(options.url, 'http://example.com');
  assert.equal(options.viewport.width, 375);
  assert.equal(options.viewport.height, 812);
  assert.equal(options.focus, 'issues');
  assert.equal(options.quiet, true);
});

test('parseArgs: accepts --compact, -c, --delta, and --content-boundaries', () => {
  const o1 = parseArgs(['http://example.com', '--compact', '--delta', '--content-boundaries']);
  assert.equal(o1.compact, true);
  assert.equal(o1.delta, true);
  assert.equal(o1.contentBoundaries, true);

  const o2 = parseArgs(['http://example.com', '-c']);
  assert.equal(o2.compact, true);
});

test('parseArgs: validates --max-output', () => {
  const opts = parseArgs(['http://example.com', '--max-output', '5000']);
  assert.equal(opts.maxOutput, 5000);

  assert.throws(
    () => parseArgs(['http://example.com', '--max-output', 'invalid']),
    /--max-output requires a positive integer/
  );
  assert.throws(
    () => parseArgs(['http://example.com', '--max-output', '0']),
    /--max-output must be greater than 0/
  );
  assert.throws(
    () => parseArgs(['http://example.com', '--max-output', '-10']),
    /--max-output requires a positive integer/
  );
});

test('parseArgs: rejects invalid viewport format', () => {
  assert.throws(
    () => parseArgs(['http://example.com', '--viewport', 'invalid']),
    /--viewport expects WIDTHxHEIGHT/
  );
});

test('parseArgs: rejects invalid focus slice', () => {
  assert.throws(
    () => parseArgs(['http://example.com', '--focus', 'unknown-slice']),
    /--focus expects one of/
  );
});

test('constants: ref configuration and interactive focus slice contracts', () => {
  assert.equal(REF_PREFIX, '@e');
  assert.equal(REF_ATTR, 'data-agentseye-ref');
  assert.equal(REF_REGISTRY_SLOT, '__agentsEyeRefsV1');
  assert.equal(DEFAULT_SUMMARY_INTERACTIVE_LIMIT, 12);
  assert.match('@e1', REF_REGEX);
  assert.match('@e42', REF_REGEX);
  assert.ok(!REF_REGEX.test('@invalid'));
  assert.ok(FOCUS_SLICES.includes('interactive'));
  assert.equal(DEFAULTS.maxOutput, 12000);
  assert.equal(DEFAULTS.compact, false);
  assert.equal(DEFAULTS.delta, false);
  assert.equal(DEFAULTS.contentBoundaries, false);
  const options = parseArgs(['http://example.com', '--focus', 'interactive']);
  assert.equal(options.focus, 'interactive');
});

test('parseArgs: rejects malformed header formats', () => {
  assert.throws(
    () => parseArgs(['http://example.com', '--header', 'NoColonHeader']),
    /--header expects "Name: Value"/
  );
});

test('parseArgs: rejects unknown options', () => {
  assert.throws(
    () => parseArgs(['http://example.com', '--unknown-flag']),
    /Unknown option: --unknown-flag/
  );
});

test('queryReport: queries safe nested properties', () => {
  const dummyReport = {
    ok: true,
    run: { id: 'test-run' },
    page: {
      metrics: {
        overflowElements: [{ selector: '.banner', scrollWidth: 500 }],
        horizontalOverflow: true,
      },
    },
    network: {
      failures: [{ url: 'http://api.com/failed', status: 500 }],
    },
    errors: { uncaught: [] },
    dialogs: { count: 0 },
  };

  const res1 = queryReport(dummyReport, 'page.metrics.overflowElements');
  assert.equal(res1.ok, true);
  assert.deepEqual(res1.data, [{ selector: '.banner', scrollWidth: 500 }]);

  const res2 = queryReport(dummyReport, 'network.failures');
  assert.equal(res2.data.length, 1);
  assert.equal(res2.data[0].status, 500);
});

test('queryReport: supports bracket array indexing like interactive.items[15]', () => {
  const dummyReport = {
    ok: true,
    run: { id: 'test-run' },
    interactive: {
      items: [
        { ref: '@e1', tag: 'button', name: 'First' },
        { ref: '@e2', tag: 'a', name: 'Second' },
      ],
    },
    errors: { uncaught: [] },
    dialogs: { count: 0 },
  };

  const resBracket = queryReport(dummyReport, 'interactive.items[1]');
  assert.equal(resBracket.ok, true);
  assert.equal(resBracket.data.name, 'Second');

  const resNested = queryReport(dummyReport, 'interactive.items[0].name');
  assert.equal(resNested.data, 'First');

  const resDot = queryReport(dummyReport, 'interactive.items.1');
  assert.equal(resDot.data.name, 'Second');
});

test('queryReport: blocks prototype pollution and property traversal attacks', () => {
  const dummyReport = { ok: true, run: { id: 'test-run' }, target: { title: 'Test' } };

  assert.throws(
    () => queryReport(dummyReport, '__proto__.polluted'),
    /Queries are safe dot-separated property paths/
  );
  assert.throws(
    () => queryReport(dummyReport, 'constructor.prototype'),
    /Queries are safe dot-separated property paths/
  );
  assert.throws(
    () => queryReport(dummyReport, 'non.existent.path'),
    /No saved property/
  );
});

test('focusReport: slices report correctly across known slices', () => {
  const dummyReport = {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    target: { title: 'Test' },
    layout: { horizontalOverflow: false },
    issues: [{ code: 'contrast-low' }],
    forms: { forms: [] },
    network: { requests: [] },
    performance: { page: {} },
    dom: { stats: {} },
    console: { entries: [] },
    errors: { uncaught: [] },
    dialogs: { count: 0 },
  };

  const issuesSlice = focusReport(dummyReport, 'issues');
  assert.ok(Array.isArray(issuesSlice.issues));
  assert.equal(issuesSlice.issues.length, 1);

  const formsSlice = focusReport(dummyReport, 'forms');
  assert.ok(formsSlice.forms);

  const netSlice = focusReport(dummyReport, 'network');
  assert.ok(netSlice.network);

  const perfSlice = focusReport(dummyReport, 'perf');
  assert.ok(perfSlice.performance);
});

test('viewport: default is mobile-first (375x667, mobile: true)', () => {
  const options = parseArgs(['http://example.com']);
  assert.equal(options.viewport.width, 375);
  assert.equal(options.viewport.height, 667);
  assert.equal(options.viewport.mobile, true);
  assert.equal(options.viewport.dpr, 1);
});

test('viewport: parses all standard Tailwind presets', () => {
  const presets = [
    { name: 'mobile', width: 375, height: 667, mobile: true },
    { name: 'sm', width: 640, height: 800, mobile: false },
    { name: 'md', width: 768, height: 1024, mobile: false },
    { name: 'lg', width: 1024, height: 768, mobile: false },
    { name: 'xl', width: 1280, height: 800, mobile: false },
    { name: '2xl', width: 1536, height: 960, mobile: false },
  ];

  for (const preset of presets) {
    const parsed = parseViewport(preset.name);
    assert.equal(parsed.width, preset.width, `Preset ${preset.name} width`);
    assert.equal(parsed.height, preset.height, `Preset ${preset.name} height`);
    assert.equal(parsed.mobile, preset.mobile, `Preset ${preset.name} mobile flag`);

    const options = parseArgs(['http://example.com', '--viewport', preset.name]);
    assert.equal(options.viewport.width, preset.width);
    assert.equal(options.viewport.height, preset.height);
    assert.equal(options.viewport.mobile, preset.mobile);
  }
});

test('viewport: supports custom dimensions and flags', () => {
  // Custom mobile-sized viewport
  const mobileCustom = parseArgs(['http://example.com', '--viewport', '412x915']);
  assert.equal(mobileCustom.viewport.width, 412);
  assert.equal(mobileCustom.viewport.height, 915);
  assert.equal(mobileCustom.viewport.mobile, true);

  // Custom desktop-sized viewport
  const desktopCustom = parseArgs(['http://example.com', '--viewport', '1920x1080']);
  assert.equal(desktopCustom.viewport.width, 1920);
  assert.equal(desktopCustom.viewport.height, 1080);
  assert.equal(desktopCustom.viewport.mobile, false);

  // Explicit --desktop / --no-mobile overrides mobile default
  const desktopOverride = parseArgs(['http://example.com', '--viewport', '375x667', '--desktop']);
  assert.equal(desktopOverride.viewport.mobile, false);

  const noMobileOverride = parseArgs(['http://example.com', '--no-mobile']);
  assert.equal(noMobileOverride.viewport.mobile, false);

  // Explicit --mobile forces mobile emulation even for desktop dimensions
  const mobileForced = parseArgs(['http://example.com', '--viewport', '1920x1080', '--mobile']);
  assert.equal(mobileForced.viewport.mobile, true);
});

test('viewport: --viewports enables matrix mode with custom list', () => {
  const options = parseArgs(['http://example.com', '--viewports', '375x667,sm,1024x768']);
  assert.equal(options.matrix, true);
  assert.ok(Array.isArray(options.customViewports));
  assert.equal(options.customViewports.length, 3);
  assert.equal(options.customViewports[0].width, 375);
  assert.equal(options.customViewports[1].width, 640);
  assert.equal(options.customViewports[2].width, 1024);
});

test('viewport: MATRIX_VIEWPORTS contains mobile and standard Tailwind breakpoints', () => {
  assert.equal(MATRIX_VIEWPORTS.length, 6);
  assert.deepEqual(
    MATRIX_VIEWPORTS.map((v) => v.width),
    [375, 640, 768, 1024, 1280, 1536]
  );
  assert.equal(MATRIX_VIEWPORTS[0].mobile, true);
  assert.equal(MATRIX_VIEWPORTS[1].mobile, false);
});

test('viewport: DEFAULTS.breakpoints includes Tailwind 2xl (1536px)', () => {
  assert.ok(DEFAULTS.breakpoints.includes(640));
  assert.ok(DEFAULTS.breakpoints.includes(768));
  assert.ok(DEFAULTS.breakpoints.includes(1024));
  assert.ok(DEFAULTS.breakpoints.includes(1280));
  assert.ok(DEFAULTS.breakpoints.includes(1536));
});

test('parseArgs: accepts @eN locators for --click, --hover, and --scroll', () => {
  const options = parseArgs(['http://example.com', '--click', '@e1', '--hover', '@e2', '--scroll', '@e3']);
  assert.equal(options.actions.length, 3);
  assert.deepEqual(options.actions[0], { type: 'click', value: '@e1', selector: '@e1' });
  assert.deepEqual(options.actions[1], { type: 'hover', value: '@e2', selector: '@e2' });
  assert.deepEqual(options.actions[2], { type: 'scroll', value: '@e3' });
});

test('parseArgs: accepts --interactive-scope flag', () => {
  const options = parseArgs(['http://example.com', '--interactive-scope', '#settings-modal']);
  assert.equal(options.interactiveScope, '#settings-modal');
});

test('parseArgs: rejects malformed ref syntax (e.g. @e, @e-2, @invalid)', () => {
  assert.throws(() => parseArgs(['http://example.com', '--click', '@e']), /Invalid element ref/);
  assert.throws(() => parseArgs(['http://example.com', '--hover', '@e-2']), /Invalid element ref/);
  assert.throws(() => parseArgs(['http://example.com', '--scroll', '@invalid']), /Invalid element ref/);
});

test('parseArgs: accepts bare element refs like e1, e2 and normalizes to @eN', () => {
  const options = parseArgs(['http://example.com', '--click', 'e1', '--hover', 'e2', '--scroll', 'e3']);
  assert.equal(options.actions[0].value, '@e1');
  assert.equal(options.actions[1].value, '@e2');
  assert.equal(options.actions[2].value, '@e3');
});

test('parseArgs: rejects flag names passed as action locator values', () => {
  assert.throws(
    () => parseArgs(['http://example.com', '--click', '--temp']),
    /expects a selector or @eN locator, received flag: --temp/,
  );
});

test('parseArgs: accepts --depth flag and --no-max-output', () => {
  const o1 = parseArgs(['http://example.com', '--depth', '3']);
  assert.equal(o1.depth, 3);

  const o2 = parseArgs(['http://example.com', '--no-max-output']);
  assert.equal(o2.maxOutput, 0);

  assert.throws(() => parseArgs(['http://example.com', '--depth', '-1']), /--depth expects an integer/);
});

test('minimalSummary: contains interactive object with total, showing, and ref items', () => {
  const dummyReport = {
    ok: true,
    schemaVersion: '1.0',
    target: { requestedUrl: 'http://example.com', finalUrl: 'http://example.com' },
    run: { id: 'run-1' },
    interactive: {
      items: [
        { ref: '@e1', tag: 'button', role: 'button', accessibleName: 'Submit Form', rendered: true },
        { ref: '@e2', tag: 'a', href: 'https://example.com/docs', name: 'Docs', rendered: true },
      ],
    },
  };
  const summary = minimalSummary(dummyReport);
  assert.ok(summary.interactive);
  assert.equal(summary.interactive.total, 2);
  assert.equal(summary.interactive.showing, 2);
  assert.equal(summary.interactive.items[0].ref, '@e1');
  assert.equal(summary.interactive.items[0].tag, 'button');
  assert.equal(summary.interactive.items[1].ref, '@e2');
  assert.equal(summary.interactive.items[1].tag, 'a');
});

test('minimalSummary: respects the 6 KB hard token budget ceiling', () => {
  const items = [];
  for (let i = 1; i <= 60; i++) {
    items.push({
      ref: `@e${i}`,
      tag: 'button',
      role: 'button',
      accessibleName: `Very long descriptive button text that consumes context budget item number ${i}`,
      rendered: true,
    });
  }
  const dummyReport = {
    ok: true,
    schemaVersion: '1.0',
    target: { requestedUrl: 'http://example.com', finalUrl: 'http://example.com' },
    run: { id: 'run-budget-test' },
    interactive: { items },
  };
  const summary = minimalSummary(dummyReport);
  const jsonStr = JSON.stringify(summary);
  assert.ok(jsonStr.length < 6000, `Summary length ${jsonStr.length} exceeded 6000 bytes`);
  assert.equal(summary.interactive.total, 60);
});

test('focusReport: supports interactive slice', () => {
  const dummyReport = {
    ok: true,
    schemaVersion: '1.0',
    target: { requestedUrl: 'http://example.com' },
    interactive: {
      count: 2,
      items: [{ ref: '@e1', tag: 'button' }, { ref: '@e2', tag: 'a' }],
      truncated: false,
    },
  };
  const slice = focusReport(dummyReport, 'interactive');
  assert.ok(slice.interactive);
  assert.equal(slice.interactive.items.length, 2);
});

test('formatText: renders interactive elements table in plain text summary', () => {
  const dummySummary = {
    ok: true,
    layout: { issueCounts: {} },
    run: { id: 'run-tbl' },
    interactive: {
      total: 30,
      showing: 2,
      items: [
        { ref: '@e1', tag: 'button', role: 'button', name: 'Submit' },
        { ref: '@e2', tag: 'a', name: 'Home' },
      ],
    },
  };
  const text = formatText(dummySummary);
  assert.match(text, /Interactive Elements \(@eN\):/);
  assert.match(text, /@e1\s+button\/button\s+Submit/);
  assert.match(text, /@e2\s+a\s+Home/);
  assert.match(text, /Use '--focus interactive' or 'show run-tbl interactive\.items' to view all 30 elements\./);
});
