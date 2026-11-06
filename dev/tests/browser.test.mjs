import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { findBrowser } from '../../agentsEye.mjs';

const SCRIPT_PATH = path.resolve('agentsEye.mjs');

test('browser inspection against local test page', async (t) => {
  let browserPath = null;
  try {
    browserPath = findBrowser(null);
  } catch {
    browserPath = null;
  }

  if (!browserPath) {
    t.skip('SKIPPED: No installed Chromium browser found on system');
    return;
  }

  const testCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-browser-test-'));

  // Start a local HTTP server
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head><title>agentsEye Test Page</title></head>
<body>
  <h1>Hello World</h1>
  <p id="intro">Inspection test</p>
</body>
</html>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;

  try {
    const { status, stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        SCRIPT_PATH,
        testUrl,
        '--ephemeral',
        '--timeout',
        '5000',
        '--no-network-idle',
      ], {
        cwd: testCwd,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (status) => { resolve({ status, stdout, stderr }); });
    });

    assert.equal(status, 0, `Expected inspection to exit with 0, got ${status}. Stderr: ${stderr}`);
    const output = JSON.parse(stdout);
    assert.equal(output.ok, true);
    assert.equal(output.target.title, 'agentsEye Test Page');
    assert.equal(output.target.httpStatus, 200);
  } finally {
    server.close();
    fs.rmSync(testCwd, { recursive: true, force: true });
  }
});

test('action execution output: clean JSON stdout by default and text summary in text format', async (t) => {
  let browserPath = null;
  try {
    browserPath = findBrowser(null);
  } catch {
    browserPath = null;
  }

  if (!browserPath) {
    t.skip('SKIPPED: No installed Chromium browser found on system');
    return;
  }

  const testCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-action-test-'));

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head><title>Action Test</title></head>
<body>
  <button id="test-btn" type="button">Click Me</button>
</body>
</html>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;

  try {
    // 1. JSON mode (default)
    const jsonRes = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        SCRIPT_PATH,
        testUrl,
        '--click',
        '#test-btn',
        '--ephemeral',
        '--timeout',
        '5000',
        '--no-network-idle',
      ], { cwd: testCwd });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (status) => { resolve({ status, stdout, stderr }); });
    });

    assert.equal(jsonRes.status, 0, `JSON mode exit 0. Stderr: ${jsonRes.stderr}`);
    assert.doesNotMatch(jsonRes.stdout, /^✓ Executed/m, 'JSON stdout must not have plain text action lines');
    const parsed = JSON.parse(jsonRes.stdout);
    assert.equal(parsed.ok, true);

    // 2. Text mode
    const textRes = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        SCRIPT_PATH,
        testUrl,
        '--click',
        '#test-btn',
        '--format',
        'text',
        '--ephemeral',
        '--timeout',
        '5000',
        '--no-network-idle',
      ], { cwd: testCwd });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (status) => { resolve({ status, stdout, stderr }); });
    });

    assert.equal(textRes.status, 0, `Text mode exit 0. Stderr: ${textRes.stderr}`);
    assert.match(textRes.stdout, /✓ Executed/);
    assert.match(textRes.stdout, /agentsEye v\d+\.\d+\.\d+/, 'Text mode should print the report summary');
  } finally {
    server.close();
    fs.rmSync(testCwd, { recursive: true, force: true });
  }
});
