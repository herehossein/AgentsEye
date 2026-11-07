import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { findBrowser } from '../../dist/agentsEye.mjs';

const bundle = fileURLToPath(new URL('../../dist/agentsEye.mjs', import.meta.url));

test('CLI rejects missing, blank and flag-like post-action selectors', () => {
  for (const args of [
    ['--wait-after'], ['--wait-after', ''], ['--wait-after', '   '],
    ['--wait-after', '--temp'], ['--wait-after='],
    ['--wait-after', '-h'], ['--wait-after', '-V'], ['--wait-after', '-c'],
  ]) {
    const result = spawnSync(process.execPath, [bundle, '--help', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, `Invalid ${JSON.stringify(args)}: ${result.stderr}`);
    assert.match(result.stderr, /--wait-after expects/);
  }
});

async function pageFixture(t, html, handleRequest = () => false) {
  try {
    findBrowser(process.env.AGENTSEYE_BROWSER || null);
  } catch {
    t.skip('No installed Chromium browser found');
    return null;
  }
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-wait-after-'));
  const env = { ...process.env, TEMP: cwd, TMP: cwd, TMPDIR: cwd };
  const runIds = new Set();
  const cli = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundle, ...args], { cwd, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
  const server = http.createServer((req, res) => {
    if (handleRequest(req, res)) return;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  t.after(async () => {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
    try {
      for (const id of runIds) {
        const result = await cli(['clean', id]);
        assert.equal(result.status, 0, result.stderr);
      }
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const inspect = async (args = [], pathname = '/') => {
    const result = await cli([
      `http://127.0.0.1:${server.address().port}${pathname}`,
      '--temp', '--no-proxy', '--no-network-idle', '--wait-ms', '0',
      '--timeout', '10000', '--quiet', ...args,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    runIds.add(report.run.id);
    return report;
  };
  const show = async (id, query) => {
    const result = await cli(['show', id, query, '--no-max-output']);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return { inspect, show, cli };
}

test('post-action wait captures async readiness in saved DOM and interaction snapshots', async t => {
  const timers = new Set();
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  const fixture = await pageFixture(t, `<!doctype html><html><head>
<title>Async status</title><link rel="icon" href="data:,"><style>button{min-height:44px;min-width:100px}</style></head><body>
<button id="load" type="button">Load status</button><script>
document.querySelector('#load').onclick = async () => {
  await fetch(location.pathname + '/result');
  const result = document.createElement('button');
  result.id = 'result'; result.type = 'button'; result.textContent = 'Status ready';
  document.body.append(result);
  console.log('async-ready');
};
</script></body></html>`, (req, res) => {
    // The baseline response stays pending until its browser exits: no timing assumption.
    if (req.url === '/baseline/result') return true;
    if (req.url !== '/waited/result') return false;
    const timer = setTimeout(() => { timers.delete(timer); res.writeHead(204); res.end(); }, 1000);
    timers.add(timer);
    return true;
  });
  if (!fixture) return;

  const baseline = await fixture.inspect(['--click', '#load'], '/baseline');
  const initialDom = await fixture.show(baseline.run.id, 'dom');
  assert.doesNotMatch(JSON.stringify(initialDom.dom), /Status ready/);

  const waited = await fixture.inspect(['--click', '#load', '--wait-after', '#result'], '/waited');
  assert.equal(waited.ok, true);
  assert.equal(waited.schemaVersion, '1.0');
  const dom = await fixture.show(waited.run.id, 'dom');
  assert.match(JSON.stringify(dom.dom), /Status ready/);
  const { data: interactions } = await fixture.show(waited.run.id, 'interactions');
  assert.equal(interactions.actions[0].status, 'performed');
  assert.ok(!interactions.beforeSnapshot.nodes.some(node => node.name === 'Status ready'));
  assert.ok(interactions.afterSnapshot.nodes.some(node => node.name === 'Status ready'));
  assert.ok(interactions.actions[0].after.nodes.some(node => node.name === 'Status ready'));
  assert.ok(interactions.actions[0].diff.added.some(node => node.name === 'Status ready'));
  assert.ok(interactions.diff.added.some(node => node.name === 'Status ready'));
  assert.ok(!interactions.warnings.some(warning => warning.includes('--wait-after')));
  const { console: consoleInfo } = await fixture.show(waited.run.id, 'console');
  assert.ok(consoleInfo.entries.some(entry => entry.text === 'async-ready'));
  const diffResult = await fixture.cli(['diff', baseline.run.id, waited.run.id, '--no-max-output']);
  assert.equal(diffResult.status, 0, diffResult.stderr);
  const diff = JSON.parse(diffResult.stdout);
  assert.ok(diff.added.some(node => node.selector === 'button#result'));
  assert.equal(diff.summary.newErrors, 0);
  assert.equal(diff.summary.newIssues, 0);
  for (const args of [
    ['show', waited.run.id, '--delta'], ['diff', baseline.run.id, waited.run.id, '--delta'],
  ]) {
    const deltaResult = await fixture.cli(args);
    assert.equal(deltaResult.status, 0, deltaResult.stderr);
    const delta = JSON.parse(deltaResult.stdout);
    assert.equal(delta.kind, 'delta');
    assert.equal(delta.additions, 1);
    assert.ok(delta.changes.some(change => change.op === 'add' && change.name === 'Status ready'));
  }
});

test('post-action wait stops on URL changes and same-URL document replacement', async t => {
  const fixture = await pageFixture(t, `<!doctype html><html><head>
<title>Navigation guard</title><link rel="icon" href="data:,"></head><body>
<button id="load" type="button">Load status</button><script>
const ready = () => {
  const result = document.createElement('button');
  result.id = 'ready'; result.type = 'button'; result.textContent = 'New page ready';
  document.body.append(result);
};
if (sessionStorage.getItem('replaced')) ready();
document.querySelector('#load').onclick = () => setTimeout(() => {
  if (location.pathname === '/replacement') {
    sessionStorage.setItem('replaced', 'yes'); location.reload();
  } else {
    location.hash = 'changed'; ready();
  }
}, 700);
</script></body></html>`);
  if (!fixture) return;
  for (const [pathname, selector] of [
    ['/changed', '#ready'], ['/replacement', '#ready'], ['/never-ready', '#never'],
  ]) {
    const report = await fixture.inspect([
      '--click', '#load', '--wait-after', selector, '--timeout', '6000',
    ], pathname);
    const { data: interactions } = await fixture.show(report.run.id, 'interactions');
    assert.equal(interactions.actions.length, 1);
    assert.equal(interactions.actions[0].status, 'performed');
    const waitWarnings = interactions.warnings.filter(warning => warning.includes('--wait-after'));
    assert.deepEqual(waitWarnings, ['--wait-after stopped: Document or URL changed'], pathname);
    assert.equal(interactions.diff.navigationChanged, true);
    assert.equal(interactions.actions[0].diff.navigationChanged, true);
    assert.ok(interactions.exploration.stoppedReason);
    if (pathname === '/never-ready') assert.ok(report.durationMs < 4500, `Wait was not stopped early: ${report.durationMs}ms`);
  }
});

test('post-action wait runs once after the action chain and keeps pre-action waits separate', async t => {
  const fixture = await pageFixture(t, `<!doctype html><html><head>
<link rel="icon" href="data:,"></head><body>
<button id="first" type="button">First step</button>
<button id="second" type="button">Second step</button><script>
document.querySelector('#second').onclick = () => {
  document.querySelector('#first').remove();
  const result = document.createElement('button');
  result.id = 'result'; result.type = 'button'; result.textContent = 'Chain ready';
  document.body.append(result);
};
</script></body></html>`);
  if (!fixture) return;
  const report = await fixture.inspect([
    '--wait-after= #result ', '--wait-for', '#first',
    '--click', '#first', '--click', '#second', '--timeout', '2000',
  ]);
  const { data: interactions } = await fixture.show(report.run.id, 'interactions');
  assert.deepEqual(interactions.actions.map(action => action.status), ['performed', 'performed']);
  assert.ok(!interactions.actions[0].after.nodes.some(node => node.name === 'Chain ready'));
  assert.ok(interactions.actions[1].after.nodes.some(node => node.name === 'Chain ready'));
  const { data: warnings } = await fixture.show(report.run.id, 'warnings');
  assert.ok(!warnings.some(warning => /selector|timeout/i.test(warning)));
});

test('unmet and invalid post-action selectors warn without failing performed actions', async t => {
  const fixture = await pageFixture(t, `<!doctype html><html><head><link rel="icon" href="data:,"></head><body>
<button id="load" type="button">Load status</button><script>
document.querySelector('#load').onclick = () => setTimeout(() => {
  const pending = document.createElement('button');
  pending.type = 'button'; pending.textContent = 'Still pending'; document.body.append(pending);
}, 750);
</script></body></html>`);
  if (!fixture) return;
  for (const [selector, expected] of [
    ['#never', /--wait-after selector did not appear before timeout/],
    ['[', /--wait-after stopped:.*(?:SyntaxError|not a valid selector)/s],
  ]) {
    const report = await fixture.inspect(['--click', '#load', '--wait-after', selector, '--timeout', '1500']);
    assert.equal(report.ok, true);
    const { data: actions } = await fixture.show(report.run.id, 'interactions.actions');
    assert.equal(actions[0].status, 'performed');
    const { data: warnings } = await fixture.show(report.run.id, 'warnings');
    const waitWarnings = warnings.filter(warning => warning.includes('--wait-after'));
    assert.equal(waitWarnings.length, 1);
    assert.match(waitWarnings[0], expected);
    if (selector === '#never') {
      assert.ok(report.durationMs >= 1500, 'The selector wait must not be silently skipped');
      assert.ok(report.durationMs < 6000, `Unbounded selector wait: ${report.durationMs}ms`);
      const { data: interactions } = await fixture.show(report.run.id, 'interactions');
      assert.ok(interactions.actions[0].after.nodes.some(node => node.name === 'Still pending'));
      assert.ok(interactions.afterSnapshot.nodes.some(node => node.name === 'Still pending'));
      assert.ok(interactions.actions[0].diff.added.some(node => node.name === 'Still pending'));
      assert.ok(interactions.diff.added.some(node => node.name === 'Still pending'));
    }
  }
});

test('post-action wait does not run for read-only, skipped, exploration-only or stopped sequences', async t => {
  const fixture = await pageFixture(t, `<!doctype html><html><head>
<link rel="icon" href="data:,"></head><body>
<button id="plain" type="button">Load status</button>
<button id="hovered" type="button">Hover target</button>
<a id="link" href="/other">Next page</a>
<form><button id="submit" type="submit">Apply</button></form>
<button id="toggle" type="button" aria-expanded="false">Open menu</button>
<button id="navigate" type="button">Switch view</button>
<div id="overlay" style="display:none;position:fixed;inset:0;background:white">Overlay</div>
<script>
document.querySelector('#hovered').onmouseenter = () => document.querySelector('#overlay').style.display = 'block';
document.querySelector('#toggle').onclick = event => event.target.setAttribute('aria-expanded', 'true');
document.querySelector('#navigate').onclick = () => location.hash = 'changed';
</script></body></html>`);
  if (!fixture) return;
  for (const [args, statuses] of [
    [[], null],
    [['--click', '#link'], ['skipped']],
    [['--click', '#submit', '--allow-destructive'], ['skipped']],
    [['--click', '#hovered'], ['skipped']],
    [['--click', '#plain', '--click', '#link'], ['performed', 'skipped']],
    [['--explore', '--max-explore', '1'], ['performed']],
    [['--click', '#navigate', '--click', '#plain'], ['performed']],
  ]) {
    const report = await fixture.inspect([...args, '--wait-after', '#never', '--timeout', '2000']);
    const { data: interactions } = await fixture.show(report.run.id, 'interactions');
    assert.deepEqual(interactions?.actions.map(action => action.status) ?? null, statuses, JSON.stringify(args));
    const { data: warnings } = await fixture.show(report.run.id, 'warnings');
    assert.ok(!warnings.some(warning => warning.includes('--wait-after')), JSON.stringify(args));
    if (args.includes('--explore')) assert.equal(interactions.actions[0].automatic, true);
    if (args.includes('#navigate')) assert.ok(interactions.exploration.stoppedReason);
    if (args.includes('#hovered')) assert.match(interactions.actions[0].reason, /covered/);
  }
});

test('post-action wait composes with bounded exploration and scoped interactive output', async t => {
  const fixture = await pageFixture(t, `<!doctype html><html><head>
<link rel="icon" href="data:,"></head><body><div id="controls">
<button id="begin" type="button">Start request</button>
<button id="toggle" type="button" aria-expanded="false">Open menu</button></div><script>
document.querySelector('#toggle').onclick = event => {
  event.target.setAttribute('aria-expanded', 'true');
  setTimeout(() => {
    const result = document.createElement('button');
    result.id = 'result'; result.type = 'button'; result.textContent = 'Scoped result ready';
    document.body.append(result);
  }, 750);
};
</script></body></html>`);
  if (!fixture) return;
  const report = await fixture.inspect([
    '--click', '#begin', '--explore', '--max-explore', '1', '--wait-after', '#result',
    '--interactive-scope', '#controls', '--focus', 'interactive', '--compact',
  ]);
  assert.ok(!report.interactive.items.some(item => item.name === 'Scoped result ready'));
  assert.ok(report.tree.includes('Open menu'));
  const { dom } = await fixture.show(report.run.id, 'dom');
  assert.match(JSON.stringify(dom), /Scoped result ready/);
  const { data: interactions } = await fixture.show(report.run.id, 'interactions');
  assert.deepEqual(interactions.actions.map(action => [action.automatic, action.status]), [[false, 'performed'], [true, 'performed']]);
  assert.ok(interactions.actions[1].diff.added.some(node => node.name === 'Scoped result ready'));
  assert.ok(!interactions.warnings.some(warning => warning.includes('--wait-after')));
});
