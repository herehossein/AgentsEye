import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT_PATH = path.resolve('dist/agentsEye.mjs');

function createTempWorkspace() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-clean-test-'));
  const runsDir = path.join(tmpDir, '.agentsEye', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  return { tmpDir, runsDir };
}

test('bare clean exits with code 2 and deletes nothing', () => {
  const { tmpDir, runsDir } = createTempWorkspace();
  try {
    const dummyRun = path.join(runsDir, 'dummy-run');
    fs.mkdirSync(dummyRun);
    
    const res = spawnSync(process.execPath, [SCRIPT_PATH, 'clean'], {
      cwd: tmpDir,
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
  const { tmpDir, runsDir } = createTempWorkspace();
  try {
    const run1 = path.join(runsDir, 'run-1');
    const run2 = path.join(runsDir, 'run-2');
    fs.mkdirSync(run1);
    fs.mkdirSync(run2);
    
    const res = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', 'run-1'], {
      cwd: tmpDir,
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
  const { tmpDir, runsDir } = createTempWorkspace();
  try {
    const run1 = path.join(runsDir, 'run-1');
    const run2 = path.join(runsDir, 'run-2');
    const run3 = path.join(runsDir, 'run-3');
    fs.mkdirSync(run1);
    fs.mkdirSync(run2);
    fs.mkdirSync(run3);
    
    const res = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', 'run-1', 'run-2'], {
      cwd: tmpDir,
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
  const { tmpDir, runsDir } = createTempWorkspace();
  try {
    const oldRun = path.join(runsDir, 'old-run');
    const newRun = path.join(runsDir, 'new-run');
    fs.mkdirSync(oldRun);
    fs.mkdirSync(newRun);
    
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
    fs.utimesSync(oldRun, threeHoursAgo, threeHoursAgo);
    
    const res = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', '--older-than', '1h'], {
      cwd: tmpDir,
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
  const { tmpDir, runsDir } = createTempWorkspace();
  try {
    const run1 = path.join(runsDir, 'run-1');
    const run2 = path.join(runsDir, 'run-2');
    fs.mkdirSync(run1);
    fs.mkdirSync(run2);
    
    const res = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', '--all'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    
    assert.equal(res.status, 0);
    assert.ok(!fs.existsSync(run1), 'run-1 should have been removed');
    assert.ok(!fs.existsSync(run2), 'run-2 should have been removed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('clean rejects conflicting modes or invalid IDs with exit code 2', () => {
  const { tmpDir } = createTempWorkspace();
  try {
    const resConflict1 = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', 'run-1', '--all'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.equal(resConflict1.status, 2);

    const resConflict2 = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', '--all', '--older-than', '1h'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.equal(resConflict2.status, 2);

    const resInvalidId = spawnSync(process.execPath, [SCRIPT_PATH, 'clean', '../escape'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.equal(resInvalidId.status, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
