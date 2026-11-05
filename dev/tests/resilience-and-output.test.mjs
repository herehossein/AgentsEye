import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createRun,
  readRun,
  persistRun,
  formatText,
  serializeOutput,
  outputView,
  cleanRuns,
  truncateOutput,
  wrapContentBoundaries,
  TOOL_NAME,
  TOOL_VERSION,
  SCHEMA_VERSION,
} from '../../agentsEye.mjs';

function createTempDir(prefix = 'agentseye-resilience-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sampleReport(overrides = {}) {
  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    generatedAt: new Date().toISOString(),
    durationMs: 420,
    target: {
      requestedUrl: 'https://example.com/test',
      finalUrl: 'https://example.com/test',
      httpStatus: 200,
      title: 'Resilience Test Page',
    },
    environment: {
      browser: 'Chromium 120.0.0.0',
      viewport: { width: 1280, height: 800, dpr: 1, mobile: false },
    },
    page: {
      readyState: 'complete',
      metrics: {
        documentScrollWidth: 1280,
        documentScrollHeight: 2400,
        scrollX: 0,
        scrollY: 100,
        horizontalOverflow: false,
        visualViewport: { width: 1280, height: 800, offsetLeft: 0, offsetTop: 0, scale: 1 },
      },
      media: {
        prefersColorSchemeDark: false,
        prefersReducedMotion: false,
        portrait: false,
      },
    },
    dom: {
      stats: {
        elementNodes: 45,
        visibleElements: 40,
        hiddenElements: 5,
        maxDepthReached: 4,
        shadowRoots: 0,
        iframes: 0,
      },
      trees: [
        {
          tag: 'html',
          selector: 'html',
          children: [
            {
              tag: 'body',
              selector: 'body',
              children: [
                {
                  tag: 'h1',
                  selector: 'h1',
                  ownText: 'Welcome',
                  rect: { viewport: { left: 10, top: 10, width: 200, height: 40 } },
                },
              ],
            },
          ],
        },
      ],
    },
    issues: [
      {
        code: 'contrast-ratio-low',
        severity: 'warn',
        message: 'Text contrast is below 4.5:1',
        cssPath: 'body > p.muted',
      },
    ],
    console: {
      counts: { error: 0, warn: 1, info: 2 },
      entries: [
        { type: 'warn', args: ['Deprecated API used'] },
      ],
    },
    network: {
      summary: { total: 12, failed: 0, statusClasses: { '2xx': 12 } },
      failures: [],
    },
    ...overrides,
  };
}

// ============================================================================
// 1. RUN PERSISTENCE: createRun, persistRun, readRun
// ============================================================================

test('createRun, persistRun, readRun: normal run creation, persisting and reading back', async () => {
  const testRunsDir = createTempDir('agentseye-run-normal-');
  try {
    const run = await createRun({ testRunsDir });
    assert.ok(run.id, 'Run should have an ID');
    assert.ok(run.directory.startsWith(testRunsDir), 'Directory should be within testRunsDir');
    assert.ok(fs.existsSync(run.directory), 'Run directory must exist');

    const report = sampleReport({ customNote: 'persistence-check' });
    await persistRun(report, run);

    assert.ok(fs.existsSync(run.report), 'report.json should exist');
    assert.ok(fs.existsSync(run.dom), 'dom.json should exist');

    const readBack = await readRun(run.id, { testRunsDir });
    assert.equal(readBack.schemaVersion, SCHEMA_VERSION);
    assert.equal(readBack.customNote, 'persistence-check');
    assert.equal(readBack.run.id, run.id);
  } finally {
    fs.rmSync(testRunsDir, { recursive: true, force: true });
  }
});

test('readRun: reading non-existent run ID throws predictable error', async () => {
  const testRunsDir = createTempDir('agentseye-run-notfound-');
  try {
    await assert.rejects(
      async () => {
        await readRun('non-existent-run-id-99999', { testRunsDir });
      },
      /Saved run not found|No saved runs found/
    );
  } finally {
    fs.rmSync(testRunsDir, { recursive: true, force: true });
  }
});

test('readRun: invalid run ID syntax is rejected early', async () => {
  const testRunsDir = createTempDir('agentseye-run-invalid-id-');
  try {
    await assert.rejects(
      async () => {
        await readRun('../traversal-attempt', { testRunsDir });
      },
      /Run IDs may only contain letters, digits, underscores and hyphens/
    );

    await assert.rejects(
      async () => {
        await readRun('bad*chars', { testRunsDir });
      },
      /Run IDs may only contain letters, digits, underscores and hyphens/
    );
  } finally {
    fs.rmSync(testRunsDir, { recursive: true, force: true });
  }
});

test('readRun: corrupted or malformed JSON run file throws informative error', async () => {
  const testRunsDir = createTempDir('agentseye-run-corrupt-');
  try {
    const corruptDir = path.join(testRunsDir, 'corrupt-run-1');
    fs.mkdirSync(corruptDir, { recursive: true });
    // Write truncated JSON
    fs.writeFileSync(path.join(corruptDir, 'report.json'), '{"ok": true, "schemaVersion": "1.');

    await assert.rejects(
      async () => {
        await readRun('corrupt-run-1', { testRunsDir });
      },
      /Invalid saved JSON report: corrupt-run-1/
    );

    // Write unsupported non-object or missing schemaVersion
    const invalidDir = path.join(testRunsDir, 'unsupported-run-2');
    fs.mkdirSync(invalidDir, { recursive: true });
    fs.writeFileSync(path.join(invalidDir, 'report.json'), '{"something": "else"}');

    await assert.rejects(
      async () => {
        await readRun('unsupported-run-2', { testRunsDir });
      },
      /Unsupported saved report: unsupported-run-2/
    );
  } finally {
    fs.rmSync(testRunsDir, { recursive: true, force: true });
  }
});

test('createRun & persistRun: isolation ensures multiple runs do not collide', async () => {
  const testRunsDir = createTempDir('agentseye-run-multi-');
  try {
    const run1 = await createRun({ testRunsDir });
    const run2 = await createRun({ testRunsDir });

    assert.notEqual(run1.id, run2.id);
    await persistRun(sampleReport({ tag: 'first' }), run1);
    await persistRun(sampleReport({ tag: 'second' }), run2);

    const read1 = await readRun(run1.id, { testRunsDir });
    const read2 = await readRun(run2.id, { testRunsDir });

    assert.equal(read1.tag, 'first');
    assert.equal(read2.tag, 'second');
  } finally {
    fs.rmSync(testRunsDir, { recursive: true, force: true });
  }
});

// ============================================================================
// 2. OUTPUT VIEW: outputView
// ============================================================================

test('outputView: full view returns comprehensive sections', () => {
  const report = sampleReport();
  const view1 = outputView(report, { view: 'full' });
  assert.ok(view1.dom, 'Full view should contain dom');
  assert.ok(view1.issues, 'Full view should contain issues');
  assert.ok(view1.page, 'Full view should contain page');

  const view2 = outputView(report, { full: true });
  assert.ok(view2.dom);
  assert.ok(view2.issues);
});

test('outputView: summary view returns budgeted minimal summary', () => {
  const report = sampleReport();
  const summary1 = outputView(report, { view: 'summary' });
  assert.ok(summary1.layout, 'Summary must have layout');
  assert.ok(summary1.console, 'Summary must have console summary');
  assert.equal(summary1.dom, undefined, 'Summary view should not include raw dom tree');

  const summaryDefault = outputView(report, {});
  assert.ok(summaryDefault.layout);
  assert.equal(summaryDefault.dom, undefined);
});

test('outputView: focus view returns requested slices', () => {
  const report = sampleReport();
  const focusIssues = outputView(report, { view: 'focus', focus: 'issues' });
  assert.ok(focusIssues.issues);
  assert.equal(focusIssues.forms, undefined);

  const focusDom = outputView(report, { view: 'focus', focus: 'dom' });
  assert.ok(focusDom.dom);
  assert.equal(focusDom.issues, undefined);

  const focusNetwork = outputView(report, { view: 'focus', focus: 'network' });
  assert.ok(focusNetwork.network);

  // Missing focus slice defaults safely (e.g. issues) without throwing
  const focusDefault = outputView(report, { view: 'focus' });
  assert.ok(focusDefault.issues || focusDefault.ok);
});

test('outputView: query view extracts targeted paths', () => {
  const report = sampleReport();
  const queryResult = outputView(report, { view: 'query', query: 'target.requestedUrl' });
  assert.equal(queryResult.data, 'https://example.com/test');
});

test('outputView: diff view returns diff structures', () => {
  const before = sampleReport({ issues: [] });
  const after = sampleReport({
    issues: [{ code: 'new-issue', severity: 'error', message: 'Something broke' }],
  });
  const diffResult = outputView(after, { view: 'diff', before, after });
  assert.ok(diffResult.summary);
  assert.equal(diffResult.summary.newIssues, 1);
});

test('outputView: invalid view or missing data does not throw unhandled errors', () => {
  const report = sampleReport();

  // Invalid view name falls back safely
  assert.doesNotThrow(() => {
    const res = outputView(report, { view: 'unknown-view-name' });
    assert.ok(res, 'Should return a fallback view');
  });

  assert.doesNotThrow(() => {
    const res = outputView(report, 'invalid-string-view');
    assert.ok(res);
  });

  // Missing or empty data handles safely
  assert.doesNotThrow(() => {
    const res = outputView(null, { view: 'summary' });
    assert.ok(res !== undefined);
  });

  assert.doesNotThrow(() => {
    const res = outputView(undefined, {});
    assert.ok(res !== undefined);
  });

  assert.doesNotThrow(() => {
    const res = outputView({}, { view: 'full' });
    assert.ok(res !== undefined);
  });
});

// ============================================================================
// 3. SERIALIZATION: serializeOutput
// ============================================================================

test('serializeOutput: compact vs pretty JSON output', () => {
  const report = sampleReport();
  const compact = serializeOutput(report, { pretty: false });
  assert.ok(compact.endsWith('\n'));
  assert.ok(!compact.includes('\n  '), 'Compact output should not have indentation');

  const pretty = serializeOutput(report, { pretty: true });
  assert.ok(pretty.includes('\n  '), 'Pretty output should be multi-line indented');
});

test('serializeOutput: text format delegates to formatText', () => {
  const report = sampleReport();
  const textOutput = serializeOutput(report, { format: 'text' });
  assert.ok(textOutput.includes(`${TOOL_NAME} v${TOOL_VERSION}`));
  assert.ok(textOutput.includes('Target: https://example.com/test'));
});

test('serializeOutput: handles BigInt without throwing TypeError', () => {
  const report = sampleReport({
    stats: {
      bytesProcessed: 123456789012345678901234567890n,
    },
  });

  assert.doesNotThrow(() => {
    const serialized = serializeOutput(report, { pretty: false });
    assert.ok(serialized.includes('123456789012345678901234567890'));
  });
});

test('serializeOutput: handles NaN and Infinity gracefully', () => {
  const report = sampleReport({
    metrics: {
      ratio: NaN,
      limit: Infinity,
    },
  });

  assert.doesNotThrow(() => {
    const serialized = serializeOutput(report, { pretty: false });
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.metrics.ratio, null);
    assert.equal(parsed.metrics.limit, null);
  });
});

test('serializeOutput: handles circular references without throwing TypeError', () => {
  const report = sampleReport();
  report.circular = report; // Circular reference to root
  const child = { parent: report };
  report.child = child; // Circular child-parent

  assert.doesNotThrow(() => {
    const serialized = serializeOutput(report, { pretty: false });
    assert.ok(serialized.includes('[Circular]'));
  });
});

test('serializeOutput: handles deeply nested structures without crashing', () => {
  const report = sampleReport();
  let deep = report;
  for (let i = 0; i < 150; i++) {
    deep.next = { depth: i };
    deep = deep.next;
  }

  assert.doesNotThrow(() => {
    const serialized = serializeOutput(report, { pretty: false });
    assert.ok(serialized.length > 0);
  });
});

// ============================================================================
// 4. HUMAN-READABLE OUTPUT: formatText
// ============================================================================

test('formatText: formats normal comprehensive report', () => {
  const report = sampleReport();
  const text = formatText(report);

  assert.ok(text.includes(`${TOOL_NAME} v${TOOL_VERSION}`));
  assert.ok(text.includes('Target: https://example.com/test'));
  assert.ok(text.includes('HTTP status: 200'));
  assert.ok(text.includes('Title: Resilience Test Page'));
  assert.ok(text.includes('Page: readyState=complete'));
  assert.ok(text.includes('DOM: 45 elements'));
  assert.ok(text.includes('contrast-ratio-low'));
  assert.ok(text.endsWith('\n'));
});

test('formatText: formats report with critical issues and console errors', () => {
  const report = sampleReport({
    issues: [
      { code: 'critical-a11y-missing-alt', severity: 'error', message: 'Img missing alt' },
      { code: 'layout-overflow-x', severity: 'error', message: 'Element overflows viewport' },
    ],
    console: {
      counts: { error: 2, warn: 0 },
      entries: [
        { type: 'error', args: ['Uncaught TypeError: foo is not a function'] },
        { type: 'error', args: ['NetworkError: Failed to fetch /api/data'] },
      ],
    },
    errors: {
      uncaught: [{ text: 'ReferenceError: bar is not defined' }],
    },
  });

  const text = formatText(report);
  assert.ok(text.includes('[error] critical-a11y-missing-alt'));
  assert.ok(text.includes('[error] layout-overflow-x'));
  assert.ok(text.includes('Uncaught TypeError'));
  assert.ok(text.includes('ReferenceError: bar is not defined'));
});

test('formatText: formats report with failed probe / fatal error', () => {
  const failedReport = {
    ok: false,
    schemaVersion: SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    error: {
      code: 'PROBE_FAILED',
      message: 'DOM probe failed: Execution context was destroyed.',
    },
  };

  const text = formatText(failedReport);
  assert.ok(text.includes('ERROR: [PROBE_FAILED]'));
  assert.ok(text.includes('Execution context was destroyed'));
});

test('formatText: handles empty report and edge cases gracefully without throwing', () => {
  // Empty report object
  assert.doesNotThrow(() => {
    const text = formatText({});
    assert.ok(text.includes(`${TOOL_NAME} v${TOOL_VERSION}`));
    assert.ok(text.includes('Target: (unknown)'));
  });

  // Null, undefined, primitive
  assert.doesNotThrow(() => {
    assert.equal(formatText(null), 'null\n');
    assert.equal(formatText(undefined), 'undefined\n');
    assert.equal(formatText('string message'), 'string message\n');
  });

  // Missing page.metrics, missing page.dom, missing issues
  assert.doesNotThrow(() => {
    const text = formatText({
      ok: true,
      target: { requestedUrl: 'https://example.com' },
      page: {}, // missing metrics
      // missing dom
      // missing issues
    });
    assert.ok(text.includes('Target: https://example.com'));
    assert.ok(text.includes('horizontalOverflow=no'));
  });
});

test('formatText: handles BigInt and circular structures in console args without throwing', () => {
  const circularArg = { msg: 'loop' };
  circularArg.self = circularArg;

  const report = sampleReport({
    console: {
      counts: { error: 1 },
      entries: [
        { type: 'error', args: [{ id: 100n, ref: circularArg }] },
      ],
    },
  });

  assert.doesNotThrow(() => {
    const text = formatText(report);
    assert.ok(text.includes('error:'));
  });
});

// ============================================================================
// 5. CLEANUP EDGE CASES: cleanRuns
// ============================================================================

test('cleanRuns: handles non-existent or empty directories without uncaught errors', async () => {
  const testRunsDir = path.join(os.tmpdir(), `agentseye-clean-nonexistent-${Date.now()}`);

  // Root directory does not exist at all
  const res1 = await cleanRuns({ testRunsDir, cleanAll: true });
  assert.equal(res1.ok, true);
  assert.equal(res1.count, 0);

  // Directory exists but is empty
  fs.mkdirSync(testRunsDir, { recursive: true });
  try {
    const res2 = await cleanRuns({ testRunsDir, cleanAll: true });
    assert.equal(res2.ok, true);
    assert.equal(res2.count, 0);

    const res3 = await cleanRuns({ testRunsDir, cleanOlderThan: 60000 });
    assert.equal(res3.ok, true);
    assert.equal(res3.count, 0);

    const res4 = await cleanRuns({ testRunsDir, cleanRunIds: ['no-such-run'] });
    assert.equal(res4.ok, true);
    assert.equal(res4.count, 0);
  } finally {
    fs.rmSync(testRunsDir, { recursive: true, force: true });
  }
});

test('cleanRuns: removes target run in test directory by ID', async () => {
  const testRunsDir = createTempDir('agentseye-clean-ids-');
  try {
    const run1 = await createRun({ testRunsDir });
    const run2 = await createRun({ testRunsDir });

    assert.ok(fs.existsSync(run1.directory));
    assert.ok(fs.existsSync(run2.directory));

    const cleanRes = await cleanRuns({ testRunsDir, cleanRunIds: [run1.id] });
    assert.equal(cleanRes.ok, true);
    assert.equal(cleanRes.count, 1);

    assert.ok(!fs.existsSync(run1.directory), 'run1 should be cleaned');
    assert.ok(fs.existsSync(run2.directory), 'run2 should remain');
  } finally {
    fs.rmSync(testRunsDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Context Budgeting & Content Boundaries
// ============================================================================

test('truncateOutput: truncates output exceeding character budget and appends hint', () => {
  const content = 'a'.repeat(50);
  const truncated = truncateOutput(content, 20);
  assert.ok(truncated.startsWith('a'.repeat(20)));
  assert.ok(truncated.includes('[truncated: showing 20 of 50 chars. Use --max-output or --focus <slice> to narrow]'));

  // No truncation when within budget or non-positive
  assert.equal(truncateOutput(content, 100), content);
  assert.equal(truncateOutput(content, 0), content);
  assert.equal(truncateOutput(content, -5), content);
  assert.equal(truncateOutput(content, undefined), content);
});

test('wrapContentBoundaries: wraps content inside CSPRNG nonce markers', () => {
  const content = '{"sample": "data"}';
  const wrapped = wrapContentBoundaries(content, 'https://example.com', 'test-nonce-1234');
  assert.ok(wrapped.includes('--- AGENTSEYE_PAGE_CONTENT nonce=test-nonce-1234 origin=https://example.com ---'));
  assert.ok(wrapped.includes('{"sample": "data"}'));
  assert.ok(wrapped.includes('--- END_AGENTSEYE_PAGE_CONTENT nonce=test-nonce-1234 ---'));

  // Without explicit nonce, generates 32-hex CSPRNG nonce
  const autoNonce = wrapContentBoundaries(content, 'https://example.com');
  assert.match(autoNonce, /nonce=([0-9a-f]{32})/);
});

test('serializeOutput: honors contentBoundaries and maxOutput options', () => {
  const rep = { target: { finalUrl: 'https://example.com/checkout' }, ok: true };
  const outBoundaries = serializeOutput(rep, { contentBoundaries: true });
  assert.ok(outBoundaries.includes('--- AGENTSEYE_PAGE_CONTENT'));
  assert.ok(outBoundaries.includes('origin=https://example.com/checkout'));
  assert.ok(outBoundaries.includes('--- END_AGENTSEYE_PAGE_CONTENT'));

  const outTruncated = serializeOutput(rep, { maxOutput: 15 });
  assert.ok(outTruncated.includes('[truncated: showing 15 of'));
});
