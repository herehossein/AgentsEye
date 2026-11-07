import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const SCRIPT_PATH = path.resolve('dist/agentsEye.mjs');

function createTempWorkspace() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-clean-test-'));
  const runsDir = path.join(tmpDir, '.agentsEye', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  // Cleanup searches OS-temp roots too; changing cwd alone does not isolate the fixture.
  const cliEnv = { ...process.env, TEMP: tmpDir, TMP: tmpDir, TMPDIR: tmpDir };
  return { tmpDir, runsDir, cliEnv };
}

test('bare clean exits with code 2 and deletes nothing', () => {
  const { tmpDir, runsDir, cliEnv } = createTempWorkspace();
  try {
    const dummyRun = path.join(runsDir, 'dummy-run');
    fs.mkdirSync(dummyRun);
    
    const res = spawnSync(process.execPath, [SCRIPT_PATH, 'clean'], {
      cwd: tmpDir,
      env: cliEnv,
      encoding: 'utf8',
    });
    
    assert.equal(res.status, 2, `Bare clean should exit with code 2, got ${res.status}`);
    assert.match(res.stderr + res.stdout, /Usage:\s*clean/i);
    assert.ok(fs.existsSync(dummyRun), 'Bare clean must delete nothing');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('clean <run-id> deletes only the specified run', () => {
  const { tmpDir, runsDir, cliEnv } = createTempWorkspace();
  try {
    const run1 = path.join(runsDir, 'run-1');
    const run2 = path.join(runsDir, 'run-2');
    fs.mkdirSync(run1);
    fs.mkdirSync(run2);
    
    const res = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', 'run-1'], {
      cwd: tmpDir,
      env: cliEnv,
      encoding: 'utf8',
    });
    
    assert.equal(res.status, 0);
    assert.ok(!fs.existsSync(run1), 'run-1 should have been removed');
    assert.ok(fs.existsSync(run2), 'run-2 should still exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('clean <run-id-1> <run-id-2> deletes multiple specified runs', () => {
  const { tmpDir, runsDir, cliEnv } = createTempWorkspace();
  try {
    const run1 = path.join(runsDir, 'run-1');
    const run2 = path.join(runsDir, 'run-2');
    const run3 = path.join(runsDir, 'run-3');
    fs.mkdirSync(run1);
    fs.mkdirSync(run2);
    fs.mkdirSync(run3);
    
    const res = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', 'run-1', 'run-2'], {
      cwd: tmpDir,
      env: cliEnv,
      encoding: 'utf8',
    });
    
    assert.equal(res.status, 0);
    assert.ok(!fs.existsSync(run1), 'run-1 should have been removed');
    assert.ok(!fs.existsSync(run2), 'run-2 should have been removed');
    assert.ok(fs.existsSync(run3), 'run-3 should still exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('clean --older-than removes only runs older than threshold', () => {
  const { tmpDir, runsDir, cliEnv } = createTempWorkspace();
  try {
    const oldRun = path.join(runsDir, 'old-run');
    const newRun = path.join(runsDir, 'new-run');
    fs.mkdirSync(oldRun);
    fs.mkdirSync(newRun);
    
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
    fs.utimesSync(oldRun, threeHoursAgo, threeHoursAgo);
    
    const res = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', '--older-than', '1h'], {
      cwd: tmpDir,
      env: cliEnv,
      encoding: 'utf8',
    });
    
    assert.equal(res.status, 0);
    assert.ok(!fs.existsSync(oldRun), 'old-run should have been removed');
    assert.ok(fs.existsSync(newRun), 'new-run should still exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('clean --all removes all runs in workspace', () => {
  const { tmpDir, runsDir, cliEnv } = createTempWorkspace();
  try {
    const run1 = path.join(runsDir, 'run-1');
    const run2 = path.join(runsDir, 'run-2');
    fs.mkdirSync(run1);
    fs.mkdirSync(run2);
    
    const res = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', '--all'], {
      cwd: tmpDir,
      env: cliEnv,
      encoding: 'utf8',
    });
    
    assert.equal(res.status, 0);
    assert.ok(!fs.existsSync(run1), 'run-1 should have been removed');
    assert.ok(!fs.existsSync(run2), 'run-2 should have been removed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('cleanup CLI fixtures preserve saved runs in the parent temp namespace', () => {
  const { tmpDir, runsDir, cliEnv } = createTempWorkspace();
  const parentId = `cleanup-parent-${randomUUID()}`;
  const parentRun = path.join(os.tmpdir(), '.agentsEye', 'runs', parentId);
  const localId = `${parentId}-local`;
  try {
    fs.mkdirSync(parentRun, { recursive: true });
    fs.writeFileSync(
      path.join(parentRun, 'report.json'),
      JSON.stringify({
        ok: true,
        schemaVersion: '1.0',
        target: { title: 'Unrelated saved report' },
        run: { id: parentId },
      })
    );
    const before = spawnSync(process.execPath, [SCRIPT_PATH, 'show', parentId, 'target.title'], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
    });
    assert.equal(before.status, 0, before.stderr);
    assert.equal(JSON.parse(before.stdout).data, 'Unrelated saved report');

    const localRun = path.join(runsDir, localId);
    fs.mkdirSync(localRun);
    fs.writeFileSync(
      path.join(localRun, 'report.json'),
      JSON.stringify({ ok: true, schemaVersion: '1.0', run: { id: localId } })
    );

    const cleanup = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', '--all'], {
      cwd: tmpDir,
      env: cliEnv,
      encoding: 'utf8',
    });
    assert.equal(cleanup.status, 0, cleanup.stderr);

    const local = spawnSync(process.execPath, [SCRIPT_PATH, 'show', localId, 'run.id'], {
      cwd: tmpDir,
      env: cliEnv,
      encoding: 'utf8',
    });
    assert.notEqual(local.status, 0, 'The disposable fixture run must be removed');

    const show = spawnSync(process.execPath, [SCRIPT_PATH, 'show', parentId, 'target.title'], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
    });
    assert.equal(show.status, 0, show.stderr);
    assert.equal(JSON.parse(show.stdout).data, 'Unrelated saved report');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(parentRun, { recursive: true, force: true });
  }
});

test('clean rejects conflicting modes or invalid IDs with exit code 2', () => {
  const { tmpDir, cliEnv } = createTempWorkspace();
  try {
    const resConflict1 = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', 'run-1', '--all'], {
      cwd: tmpDir,
      env: cliEnv,
      encoding: 'utf8',
    });
    assert.equal(resConflict1.status, 2);

    const resConflict2 = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', '--all', '--older-than', '1h'], {
      cwd: tmpDir,
      env: cliEnv,
      encoding: 'utf8',
    });
    assert.equal(resConflict2.status, 2);

    const resInvalidId = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', '../escape'], {
      cwd: tmpDir,
      env: cliEnv,
      encoding: 'utf8',
    });
    assert.equal(resInvalidId.status, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
