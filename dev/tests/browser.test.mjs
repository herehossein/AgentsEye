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
