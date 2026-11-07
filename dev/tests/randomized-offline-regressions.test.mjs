import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { findBrowser } from '../../dist/agentsEye.mjs';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
const bundle = path.join(cwd, 'dist', 'agentsEye.mjs');

async function runCli(t, args) {
  const argv = [bundle, ...args];
  const start = new Date().toISOString();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
  t.diagnostic(JSON.stringify({ argv: [process.execPath, ...argv], cwd, start, end: new Date().toISOString(), ...result }));
  return result;
}

test('saved DOM text identifies nodes from the compact focus view', async t => {
  try {
    findBrowser(process.env.AGENTSEYE_BROWSER || null);
  } catch {
    t.skip('No installed Chromium browser found');
    return;
  }

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Offline DOM text fixture</title>
<link rel="icon" href="data:,"></head><body><main><h1>Catalog</h1>
<section id="catalog"><button type="button">Widget</button></section>
<p id="removed-note">Original note</p></main></body></html>`);
  });
  let runId;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const inspected = await runCli(t, [
      `http://127.0.0.1:${server.address().port}/`,
      '--focus', 'dom', '--no-max-output', '--temp', '--no-proxy',
      '--no-network-idle', '--wait-ms', '0', '--timeout', '10000', '--quiet',
    ]);
    assert.equal(inspected.status, 0, inspected.stderr);
    const focused = JSON.parse(inspected.stdout);
    runId = focused.run.id;
    assert.equal(focused.ok, true);
    assert.equal(focused.dom.trees[0].node, 'html');

    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    const shown = await runCli(t, ['show', runId, 'dom', '--format', 'text', '--no-max-output']);
    assert.equal(shown.status, 0, shown.stderr);
    const outline = shown.stdout.split('DOM Outline:\n')[1]?.trimEnd().split('\n').map(line => line.trim());
    assert.deepEqual(outline, ['html', 'body', 'main', 'h1', 'section#catalog', 'p#removed-note']);
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
    if (runId) {
      const cleaned = await runCli(t, ['clean', runId]);
      assert.equal(cleaned.status, 0, cleaned.stderr);
    }
  }
});
