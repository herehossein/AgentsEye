import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, queryReport, focusReport } from '../../agentsEye.mjs';

test('parseArgs: valid flags and viewport parsing', () => {
  const options = parseArgs(['http://example.com', '--viewport', '375x812', '--focus', 'issues', '--quiet']);
  assert.equal(options.url, 'http://example.com');
  assert.equal(options.viewport.width, 375);
  assert.equal(options.viewport.height, 812);
  assert.equal(options.focus, 'issues');
  assert.equal(options.quiet, true);
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
    schemaVersion: '1.0',
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
