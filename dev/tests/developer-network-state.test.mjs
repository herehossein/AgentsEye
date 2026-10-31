import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { findBrowser, diffReports } from '../../agentsEye.mjs';

const SCRIPT_PATH = path.resolve('agentsEye.mjs');

function hasBrowser() {
  try {
    return Boolean(findBrowser(null));
  } catch {
    return false;
  }
}

function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
      cwd,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

// ============================================================================
// 1. Failed Network Requests (404 & 500) Detection
// ============================================================================
test('1. Failed Network Requests (404 & 500) Detection', async (t) => {
  if (!hasBrowser()) {
    t.skip('SKIPPED: No installed Chromium browser found on system');
    return;
  }

  const testCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-net-test-'));

  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === '/api/missing-endpoint') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
      return;
    }
    if (req.url === '/api/server-error') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head><title>Network Test</title></head>
<body>
  <h1>Network Request Test</h1>
  <script>
    fetch('/api/missing-endpoint');
    fetch('/api/server-error');
  </script>
</body>
</html>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;

  try {
    const { status, stdout, stderr } = await runCli([
      testUrl,
      '--focus', 'network',
      '--quiet',
      '--ephemeral',
      '--timeout', '10000',
    ], testCwd);

    assert.equal(status, 0, `Expected exit 0, got ${status}. Stderr: ${stderr}`);
    const output = JSON.parse(stdout);
    assert.equal(output.ok, true);

    const net = output.network;
    assert.ok(net, 'Expected output.network to be present');

    const total = net.total ?? net.summary?.total ?? 0;
    assert.ok(total >= 2, `Expected network.total >= 2, got ${total}`);

    const failed = net.failed ?? net.summary?.failed ?? 0;
    const statusClasses = net.statusClasses ?? net.summary?.statusClasses ?? {};
    const has4xxOr5xx = Boolean(statusClasses['4xx'] >= 1 || statusClasses['5xx'] >= 1);
    assert.ok(failed >= 1 || has4xxOr5xx, 'Expected network.failed >= 1 or statusClasses indicating 4xx/5xx');

    const requests = net.requests ?? [];
    const missing = requests.find((r) => r.url?.includes('/api/missing-endpoint'));
    const serverErr = requests.find((r) => r.url?.includes('/api/server-error'));

    assert.ok(missing, 'Expected request entry for /api/missing-endpoint');
    assert.equal(missing.status, 404, `Expected status 404 for missing-endpoint, got ${missing.status}`);

    assert.ok(serverErr, 'Expected request entry for /api/server-error');
    assert.equal(serverErr.status, 500, `Expected status 500 for server-error, got ${serverErr.status}`);
  } finally {
    server.close();
    fs.rmSync(testCwd, { recursive: true, force: true });
  }
});

// ============================================================================
// 2. Local and Session Storage Inspection
// ============================================================================
test('2. Local and Session Storage Inspection', async (t) => {
  if (!hasBrowser()) {
    t.skip('SKIPPED: No installed Chromium browser found on system');
    return;
  }

  const testCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-storage-test-'));

  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head><title>Storage Test</title></head>
<body>
  <h1>Storage Test Page</h1>
  <script>
    localStorage.setItem('user_theme', 'dark');
    sessionStorage.setItem('wizard_step', '2');
  </script>
</body>
</html>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;

  try {
    const { status, stdout, stderr } = await runCli([
      testUrl,
      '--focus', 'storage',
      '--quiet',
      '--ephemeral',
      '--timeout', '10000',
    ], testCwd);

    assert.equal(status, 0, `Expected exit 0, got ${status}. Stderr: ${stderr}`);
    const output = JSON.parse(stdout);
    assert.equal(output.ok, true);

    const storage = output.storage;
    assert.ok(storage, 'Expected storage object in output');
    assert.ok(storage.localStorage, 'Expected storage.localStorage');
    assert.ok(storage.sessionStorage, 'Expected storage.sessionStorage');

    const localVal = storage.localStorage.user_theme ??
      storage.localStorage.entries?.find((e) => e.key === 'user_theme')?.value;
    assert.equal(localVal, 'dark', `Expected localStorage to contain { user_theme: 'dark' }, got ${localVal}`);

    const sessionVal = storage.sessionStorage.wizard_step ??
      storage.sessionStorage.entries?.find((e) => e.key === 'wizard_step')?.value;
    assert.equal(sessionVal, '2', `Expected sessionStorage to contain { wizard_step: '2' }, got ${sessionVal}`);
  } finally {
    server.close();
    fs.rmSync(testCwd, { recursive: true, force: true });
  }
});

// ============================================================================
// 3. Targeted Element Inspection (--selector)
// ============================================================================
test('3. Targeted Element Inspection (--selector)', async (t) => {
  if (!hasBrowser()) {
    t.skip('SKIPPED: No installed Chromium browser found on system');
    return;
  }

  const testCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-selector-test-'));

  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head><title>Selector Test</title></head>
<body>
  <div id="checkout-modal" style="display: none; width: 300px; height: 200px;">
    <button id="pay-btn">Pay</button>
  </div>
</body>
</html>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;

  try {
    const { status, stdout, stderr } = await runCli([
      testUrl,
      '--selector', '#checkout-modal',
      '--quiet',
      '--ephemeral',
      '--timeout', '10000',
    ], testCwd);

    assert.equal(status, 0, `Expected exit 0, got ${status}. Stderr: ${stderr}`);
    const output = JSON.parse(stdout);
    assert.equal(output.ok, true);

    const dom = output.dom;
    assert.ok(dom, 'Expected output.dom to be present');
    assert.equal(dom.selectorMatched, true, 'Expected dom.selectorMatched to be true');

    const root = dom.tree || (Array.isArray(dom.trees) ? dom.trees[0] : dom.trees);
    assert.ok(root, 'Expected root element in dom');
    assert.ok(
      root.id === 'checkout-modal' || root.selector?.includes('checkout-modal'),
      `Expected root inspected element to match #checkout-modal, got id=${root.id} selector=${root.selector}`
    );

    assert.equal(root.rendered, false, 'Expected root rendered to be false');
    assert.match(
      String(root.hiddenReason),
      /display:none|ancestor/i,
      `Expected hiddenReason to indicate display:none or ancestor hidden, got ${root.hiddenReason}`
    );

    const buttonChild = (root.children || []).find((c) => c.tag === 'button' && c.id === 'pay-btn');
    assert.ok(buttonChild, 'Expected child button #pay-btn to be captured');
  } finally {
    server.close();
    fs.rmSync(testCwd, { recursive: true, force: true });
  }
});

// ============================================================================
// 4. Regression Diffing for Developer Changes
// ============================================================================
test('4. Regression Diffing for Developer Changes', () => {
  const brokenReport = {
    ok: true,
    run: { id: 'run-broken' },
    target: { requestedUrl: 'http://test.local', finalUrl: 'http://test.local' },
    issues: [{ code: 'horizontal-document-overflow', message: 'Width exceeds viewport' }],
    errors: {
      uncaught: [{ message: 'Uncaught TypeError: Cannot read properties of undefined' }],
      logErrors: [],
    },
    dom: { tree: { tag: 'html' } },
  };

  const fixedReport = {
    ok: true,
    run: { id: 'run-fixed' },
    target: { requestedUrl: 'http://test.local', finalUrl: 'http://test.local' },
    issues: [],
    errors: {
      uncaught: [],
      logErrors: [],
    },
    dom: { tree: { tag: 'html' } },
  };

  // Verifying diff(brokenReport, fixedReport): fixes resolved, no new errors or issues
  const diffFix = diffReports(brokenReport, fixedReport);
  assert.equal(diffFix.summary.newErrors, 0, 'Expected diff.summary.newErrors === 0 when bugs are fixed');
  assert.equal(diffFix.summary.newIssues, 0, 'Expected diff.summary.newIssues === 0 when bugs are fixed');

  // Verifying diff(fixedReport, brokenReport): introduces regressions
  const diffRegression = diffReports(fixedReport, brokenReport);
  assert.ok(
    diffRegression.summary.newErrors >= 1,
    `Expected diffRegression.summary.newErrors >= 1, got ${diffRegression.summary.newErrors}`
  );
  assert.ok(
    diffRegression.summary.newIssues >= 1,
    `Expected diffRegression.summary.newIssues >= 1, got ${diffRegression.summary.newIssues}`
  );
});

// ============================================================================
// 5. CSS Variables & Custom Properties Extraction
// ============================================================================
test('5. CSS Variables & Custom Properties Extraction', async (t) => {
  if (!hasBrowser()) {
    t.skip('SKIPPED: No installed Chromium browser found on system');
    return;
  }

  const testCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-cssvars-test-'));

  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <style>
    :root {
      --brand-color: #ff5500;
      --container-max: 1200px;
    }
  </style>
</head>
<body>
  <div>App</div>
</body>
</html>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;

  try {
    const { status, stdout, stderr } = await runCli([
      testUrl,
      '--summary-only',
      '--quiet',
      '--ephemeral',
      '--timeout', '10000',
    ], testCwd);

    assert.equal(status, 0, `Expected exit 0, got ${status}. Stderr: ${stderr}`);
    const output = JSON.parse(stdout);
    assert.equal(output.ok, true);

    const cssVars = output.cssVars?.vars ?? output.cssVars;
    assert.ok(cssVars, 'Expected cssVars to be extracted and reported');

    const brandColor = cssVars['--brand-color'];
    const containerMax = cssVars['--container-max'];

    assert.equal(brandColor, '#ff5500', `Expected --brand-color to be #ff5500, got ${brandColor}`);
    assert.equal(containerMax, '1200px', `Expected --container-max to be 1200px, got ${containerMax}`);
  } finally {
    server.close();
    fs.rmSync(testCwd, { recursive: true, force: true });
  }
});
