import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { findBrowser } from '../../agentsEye.mjs';

const SCRIPT_PATH = path.resolve('agentsEye.mjs');

function getBrowserOrSkip(t) {
  let browserPath = null;
  try {
    browserPath = findBrowser(null);
  } catch {
    browserPath = null;
  }
  if (!browserPath) {
    t.skip('SKIPPED: No installed Chromium browser found on system');
    return null;
  }
  return browserPath;
}

async function runInspectWithServer(html, cliArgs) {
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;
  const testCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-ui-diag-'));

  try {
    const { status, stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        SCRIPT_PATH,
        testUrl,
        '--ephemeral',
        '--timeout',
        '5000',
        ...cliArgs,
      ], {
        cwd: testCwd,
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (status) => { resolve({ status, stdout, stderr }); });
    });

    let report = null;
    if (status === 0 && stdout.trim()) {
      try {
        report = JSON.parse(stdout);
      } catch (err) {
        throw new Error(`Failed to parse JSON output: ${err.message}. Stdout: ${stdout}`);
      }
    }

    return { status, stdout, stderr, report };
  } finally {
    server.close();
    fs.rmSync(testCwd, { recursive: true, force: true });
  }
}

test('1. Horizontal Document Overflow on Mobile', async (t) => {
  if (!getBrowserOrSkip(t)) return;

  const html = `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width"></head>
<body>
  <div style="width: 800px; height: 100px; background: red;">Overflow Box</div>
</body>
</html>`;

  const { status, stderr, report } = await runInspectWithServer(html, [
    '--viewport', '375x667',
    '--mobile',
    '--focus', 'issues',
    '--quiet',
  ]);

  assert.equal(status, 0, `Expected exit code 0, got ${status}. Stderr: ${stderr}`);
  assert.ok(report, 'Expected JSON report output');
  assert.ok(Array.isArray(report.issues), 'Expected report.issues to be an array');

  const overflowIssue = report.issues.find((issue) => issue.code === 'horizontal-document-overflow');
  assert.ok(overflowIssue, 'Expected issues to contain "horizontal-document-overflow"');

  // Verify overflow element selector / CSS path is captured
  assert.ok(Array.isArray(overflowIssue.elements) && overflowIssue.elements.length >= 1, 'Expected overflow elements array');
  const hasDivSelector = overflowIssue.elements.some((el) => typeof el.cssPath === 'string' && el.cssPath.includes('div'));
  assert.ok(hasDivSelector, 'Expected overflow element CSS path / selector to capture the div element');
});

test('2. Runtime Uncaught JS Exception', async (t) => {
  if (!getBrowserOrSkip(t)) return;

  const html = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      throw new TypeError('Cannot read properties of undefined (reading calculateTotal)');
    });
  </script>
</body>
</html>`;

  const { status, stderr, report } = await runInspectWithServer(html, [
    '--focus', 'issues',
    '--quiet',
  ]);

  assert.equal(status, 0, `Expected exit code 0, got ${status}. Stderr: ${stderr}`);
  assert.ok(report, 'Expected JSON report output');
  assert.ok(report.errors, 'Expected report.errors object');

  const uncaughtCount = report.errors.uncaughtCount ?? report.errors.uncaught?.length ?? 0;
  assert.ok(uncaughtCount >= 1, `Expected uncaughtCount >= 1, got ${uncaughtCount}`);

  const uncaughtList = report.errors.uncaught || [];
  const foundMessage = uncaughtList.some((err) => {
    const text = err.text || err.message || JSON.stringify(err);
    return text.includes('Cannot read properties of undefined');
  });
  assert.ok(foundMessage, 'Expected errors.uncaught to capture error message "Cannot read properties of undefined"');
});

test('3. Console Errors and Warnings', async (t) => {
  if (!getBrowserOrSkip(t)) return;

  const html = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <script>
    console.error('Failed to load user profile: 401 Unauthorized');
    console.warn('Deprecated API used');
  </script>
</body>
</html>`;

  const { status, stderr, report } = await runInspectWithServer(html, [
    '--focus', 'console',
    '--quiet',
  ]);

  assert.equal(status, 0, `Expected exit code 0, got ${status}. Stderr: ${stderr}`);
  assert.ok(report, 'Expected JSON report output');
  assert.ok(report.console, 'Expected console object in focus report');

  // Verify console counts
  assert.ok(report.console.counts, 'Expected console.counts object');
  assert.ok(report.console.counts.error >= 1, `Expected console.counts.error >= 1, got ${report.console.counts.error}`);
  assert.ok(report.console.counts.warn >= 1, `Expected console.counts.warn >= 1, got ${report.console.counts.warn}`);

  // Verify console.errors contains the message and entry
  assert.ok(Array.isArray(report.console.errors), 'Expected console.errors array');
  assert.ok(report.console.errors.length >= 1, 'Expected at least 1 entry in console.errors');

  const foundErrorEntry = report.console.errors.some((entry) => {
    const text = entry.text || entry.message || (Array.isArray(entry.args) ? entry.args.join(' ') : '');
    return text.includes('Failed to load user profile: 401 Unauthorized');
  });
  assert.ok(foundErrorEntry, 'Expected console.errors to contain "Failed to load user profile: 401 Unauthorized"');
});

test('4. Headings Outline and Landmarks Extraction', async (t) => {
  if (!getBrowserOrSkip(t)) return;

  const html = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <header><nav>Nav</nav></header>
  <main>
    <h1>Dashboard</h1>
    <section>
      <h2>Metrics</h2>
    </section>
  </main>
  <footer>Footer</footer>
</body>
</html>`;

  const { status, stderr, report } = await runInspectWithServer(html, [
    '--summary-only',
    '--quiet',
  ]);

  assert.equal(status, 0, `Expected exit code 0, got ${status}. Stderr: ${stderr}`);
  assert.ok(report, 'Expected JSON report output');

  // Verify landmarks contains header, navigation, main
  assert.ok(report.landmarks, 'Expected landmarks in report');
  assert.ok(report.landmarks.header && report.landmarks.header.count >= 1, 'Expected header landmark');
  assert.ok(report.landmarks.navigation && report.landmarks.navigation.count >= 1, 'Expected navigation landmark');
  assert.ok(report.landmarks.main && report.landmarks.main.count >= 1, 'Expected main landmark');

  // Verify headings outline extracts h1: Dashboard, h2: Metrics
  const outline = report.headings?.outline ||
    report.headingsOutline ||
    (report.headings?.items ?? []).map((h) => `${h.tag || `h${h.level}`}: ${h.text}`);

  assert.ok(Array.isArray(outline) && outline.length >= 2, `Expected outline with at least 2 headings, got ${JSON.stringify(outline)}`);
  assert.ok(outline.some((item) => item.includes('h1: Dashboard')), 'Expected headings outline to include "h1: Dashboard"');
  assert.ok(outline.some((item) => item.includes('h2: Metrics')), 'Expected headings outline to include "h2: Metrics"');
});

test('5. Form Inputs and Small Touch Targets on Mobile', async (t) => {
  if (!getBrowserOrSkip(t)) return;

  const html = `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width"></head>
<body>
  <form>
    <input id="email" style="font-size: 13px;" />
    <button id="btn" style="width: 20px; height: 20px;">X</button>
  </form>
</body>
</html>`;

  const { status, stderr, report } = await runInspectWithServer(html, [
    '--viewport', '375x667',
    '--mobile',
    '--focus', 'issues',
    '--quiet',
  ]);

  assert.equal(status, 0, `Expected exit code 0, got ${status}. Stderr: ${stderr}`);
  assert.ok(report, 'Expected JSON report output');
  assert.ok(Array.isArray(report.issues), 'Expected report.issues array');

  // Verify input-font-below-16px (risk for iOS auto-zoom)
  const fontIssue = report.issues.find((issue) => issue.code === 'input-font-below-16px');
  assert.ok(fontIssue, 'Expected issues to contain "input-font-below-16px"');
  assert.ok(fontIssue.message?.includes('13px') || fontIssue.cssPath?.includes('email'), 'Expected input font issue to reference 13px or email input');

  // Verify small-touch-target
  const touchIssue = report.issues.find((issue) => issue.code === 'small-touch-target');
  assert.ok(touchIssue, 'Expected issues to contain "small-touch-target"');
  assert.ok(touchIssue.message?.includes('20x20') || touchIssue.cssPath?.includes('btn'), 'Expected touch target issue to reference 20x20 or btn');
});
