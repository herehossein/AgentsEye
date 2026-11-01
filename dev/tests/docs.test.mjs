import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const REPO_ROOT = path.resolve('.');

function checkLinks(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const dir = path.dirname(filePath);
  // Match markdown links [text](target) excluding anchors (#...) and urls (http...)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const brokenLinks = [];

  for (const match of content.matchAll(linkRegex)) {
    const rawTarget = match[2].trim();
    if (rawTarget.startsWith('#') || rawTarget.startsWith('http://') || rawTarget.startsWith('https://')) {
      continue;
    }
    // Strip query or fragment from relative target
    const cleanTarget = rawTarget.split('#')[0].split('?')[0];
    if (!cleanTarget) continue;
    const resolvedPath = path.resolve(dir, cleanTarget);
    if (!fs.existsSync(resolvedPath)) {
      brokenLinks.push({ linkText: match[1], target: rawTarget, resolvedPath });
    }
  }
  return brokenLinks;
}

test('every relative link in SKILL.md resolves to an existing file', () => {
  const broken = checkLinks(path.join(REPO_ROOT, 'SKILL.md'));
  assert.deepEqual(broken, [], `Broken links in SKILL.md: ${JSON.stringify(broken)}`);
});

test('every relative link in README.md resolves to an existing file', () => {
  const broken = checkLinks(path.join(REPO_ROOT, 'README.md'));
  assert.deepEqual(broken, [], `Broken links in README.md: ${JSON.stringify(broken)}`);
});

test('SKILL.md is <= 16 KB (16384 bytes)', () => {
  const stat = fs.statSync(path.join(REPO_ROOT, 'SKILL.md'));
  assert.ok(stat.size <= 16384, `SKILL.md size ${stat.size} exceeds 16384 bytes`);
});

test('no npx invocations remain in SKILL.md, README.md, agentsEye.mjs, package.json', () => {
  const filesToCheck = ['SKILL.md', 'README.md', 'agentsEye.mjs', 'package.json'];
  for (const file of filesToCheck) {
    const filePath = path.join(REPO_ROOT, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const matches = content.match(/\bnpx\s+[^\r\n`"'\s]+/gi) || [];
    assert.deepEqual(matches, [], `Found npx usage in ${file}: ${matches.join(', ')}`);
  }
});

test('no numeric token claims or absolute security claims remain in docs', () => {
  const filesToCheck = ['SKILL.md', 'README.md', 'references/cli-reference.md', 'references/schema-reference.md', 'references/security-model.md'];
  const forbiddenPatterns = [
    /\b1\.5[kK]\b/,
    /\b[~≈]?1[,.]?500\s+tokens?\b/i,
    /30[,.]?000[–\-]80[,.]?000/i,
    /50[,.]?000[–\-]80[,.]?000/i,
    /۵۰\s*تا\s*۸۰\s*هزار\s*توکن/,
    /۱[.,]۵\s*هزار\s*توکن/,
    /\bzero[- ]disk trace\b/i,
    /safety envelope/i,
    /never leaked/i,
  ];

  for (const file of filesToCheck) {
    if (!fs.existsSync(path.join(REPO_ROOT, file))) continue;
    const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    for (const pat of forbiddenPatterns) {
      const match = content.match(pat);
      assert.ok(!match, `File ${file} contains forbidden claim matching ${pat}: "${match ? match[0] : ''}"`);
    }
  }
});

test('skill works when SKILL.md, agentsEye.mjs and references/ are copied alone to a temp folder', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-standalone-skill-'));
  try {
    fs.copyFileSync(path.join(REPO_ROOT, 'SKILL.md'), path.join(tmpDir, 'SKILL.md'));
    fs.copyFileSync(path.join(REPO_ROOT, 'agentsEye.mjs'), path.join(tmpDir, 'agentsEye.mjs'));
    fs.cpSync(path.join(REPO_ROOT, 'references'), path.join(tmpDir, 'references'), { recursive: true });

    const res = spawnSync(process.execPath, [path.join(tmpDir, 'agentsEye.mjs'), '--help'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    assert.equal(res.status, 0, `Isolated agentsEye.mjs --help should exit with 0, got ${res.status}`);
    assert.match(res.stdout, /agentsEye v1\.0\.0/);
    assert.doesNotMatch(res.stdout, /npx/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
