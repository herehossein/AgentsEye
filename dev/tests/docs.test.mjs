import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import {
  TOOL_NAME,
  TOOL_VERSION,
  SCHEMA_VERSION,
  diffReports,
  interactionSafety,
  minimalSummary,
  validateResolvedTargetUrl,
} from '../../dist/agentsEye.mjs';

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

test('every relative link in README.fa.md resolves to an existing file', () => {
  const broken = checkLinks(path.join(REPO_ROOT, 'README.fa.md'));
  assert.deepEqual(broken, [], `Broken links in README.fa.md: ${JSON.stringify(broken)}`);
});

test('SKILL.md is <= 16 KB (16384 bytes)', () => {
  const stat = fs.statSync(path.join(REPO_ROOT, 'SKILL.md'));
  assert.ok(stat.size <= 16384, `SKILL.md size ${stat.size} exceeds 16384 bytes`);
});

test('no npx invocations remain in SKILL.md, README.md, README.fa.md, dist/agentsEye.mjs, package.json', () => {
  const filesToCheck = ['SKILL.md', 'README.md', 'README.fa.md', 'dist/agentsEye.mjs', 'package.json'];
  for (const file of filesToCheck) {
    const filePath = path.join(REPO_ROOT, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const matches = content.match(/\bnpx\s+[^\r\n`"'\s]+/gi) || [];
    assert.deepEqual(matches, [], `Found npx usage in ${file}: ${matches.join(', ')}`);
  }
});

test('no numeric token claims or absolute security claims remain in docs', () => {
  const filesToCheck = ['SKILL.md', 'README.md', 'README.fa.md', 'references/cli-reference.md', 'references/schema-reference.md', 'references/security-model.md'];
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

test('build artifact and npm metadata use the ignored dist bundle, not a root bundle', () => {
  const bundle = 'dist/agentsEye.mjs';
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));

  assert.equal(pkg.bin.agentseye, bundle);
  assert.deepEqual(lock.packages[''].bin, pkg.bin, 'Lockfile bin must match package.json');
  assert.equal(pkg.scripts.prepack, 'npm run build', 'npm packaging must build the ignored bundle');
  for (const file of [bundle, 'SKILL.md', 'references/']) {
    assert.ok(pkg.files.includes(file), `npm package must include ${file}`);
  }
  assert.ok(!pkg.files.includes('agentsEye.mjs'), 'npm package must not expect a root bundle');
  assert.ok(fs.statSync(path.join(REPO_ROOT, bundle)).isFile(), 'Build must produce dist/agentsEye.mjs');
  assert.ok(!fs.existsSync(path.join(REPO_ROOT, 'agentsEye.mjs')), 'Build must not recreate a root bundle');
  assert.match(fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8'), /^\/?dist\/?\r?$/m);
});

test('English and Persian READMEs install the complete skill from a Release ZIP', () => {
  const releaseUrl = 'https://github.com/herehossein/agentsEye/releases/latest';
  for (const readme of ['README.md', 'README.fa.md']) {
    const content = fs.readFileSync(path.join(REPO_ROOT, readme), 'utf8');
    assert.ok(content.includes(releaseUrl), `${readme} must link the Release page`);
    assert.match(content, /\.zip/, `${readme} must document the ZIP package`);
    assert.match(content, /Assets/, `${readme} must identify the uploaded Release asset`);
    assert.match(content, /\bextract\b|استخراج/i, `${readme} must document extracting the ZIP`);
    assert.match(content, /\bmove\b|منتقل/i, `${readme} must document moving the extracted skill folder`);
    assert.doesNotMatch(content, /releases\/latest\/download\/agentsEye\.mjs/, `${readme} must not require a separate script download`);
    assert.doesNotMatch(
      content,
      /raw\.githubusercontent\.com\/herehossein\/agentsEye\/[^/\s]+\/(?:dist\/)?agentsEye\.mjs/,
      `${readme} must not install a bundle from the source tree`,
    );
  }
});

test('bilingual READMEs keep three core workflows, a current lifecycle and five scenarios', () => {
  for (const readme of ['README.md', 'README.fa.md']) {
    const content = fs.readFileSync(path.join(REPO_ROOT, readme), 'utf8');
    const intro = content.split(/^## [1۱]\./m)[1]?.split(/^## /m)[0];
    assert.ok(intro, `${readme} must have the introductory section`);
    assert.equal((intro.match(/^- /gm) || []).length, 3, `${readme} must highlight three core workflows`);
    assert.doesNotMatch(intro, /overflow|سرریز|اسکرول افقی/i);

    const lifecycle = content.split(/^## [2۲]\./m)[1]?.split(/^## /m)[0];
    assert.ok(lifecycle, `${readme} must have the lifecycle section`);
    for (const term of [
      '--temp', '--focus interactive --compact', '--interactive-scope', '--delta', '--no-css-vars',
      'interactive.items[15]', 'summary.newErrors === 0', 'summary.newIssues === 0',
      '--matrix', 'matrix.snapshots',
    ]) {
      assert.ok(lifecycle.includes(term), `${readme} lifecycle must document ${term}`);
    }

    const scenarios = content.split(/^### (?:Example Interactions|نمونه سناریوهای تعامل).*$/m)[1]?.split(/^## /m)[0];
    assert.ok(scenarios, `${readme} must have the interaction scenarios`);
    assert.deepEqual(
      [...scenarios.matchAll(/^(\d+)\. \*\*/gm)].map(([, number]) => Number(number)),
      [1, 2, 3, 4, 5],
      `${readme} must have exactly five numbered scenarios`,
    );
  }
});

test('bilingual READMEs state runtime boundaries and keep command tables intact', () => {
  const networkOnlyDiff = diffReports(
    { network: { failures: [] } },
    { network: { failures: [{ status: 500 }] } },
  );
  assert.equal(networkOnlyDiff.summary.newErrors, 0, 'The diff error counter is not a network-failure gate');
  assert.equal(networkOnlyDiff.summary.newIssues, 0);

  const cli = fs.readFileSync(path.join(REPO_ROOT, 'references/cli-reference.md'), 'utf8');
  const locale = cli.split(/\r?\n/).find((line) => line.startsWith('| `--locale`'));
  assert.ok(locale, 'CLI reference must document the locale override');
  assert.match(locale, /Emulation\.setLocaleOverride.*Does not change.*Accept-Language.*RTL/);

  for (const readme of ['README.md', 'README.fa.md']) {
    const content = fs.readFileSync(path.join(REPO_ROOT, readme), 'utf8');
    assert.ok(content.includes('report.ok === true'), `${readme} must explain inspection success`);
    assert.ok(content.includes('network.failures'), `${readme} must require separate network review`);
    assert.match(content, /Private and loopback targets[^\r\n]*allowed|اهداف خصوصی و لوپ‌بک[^\r\n]*مجاز/);
    assert.match(content, /not a pixel-diff|نه مقایسهٔ پیکسلی/);
    assert.match(content, /not a no-write mode|حالت بدون نوشتن روی دیسک نیست/);
    for (const term of ['--allow-remote-cdp', '--allow-destructive', 'Canvas/WebGL', 'WCAG']) {
      assert.ok(content.includes(term), `${readme} must document the boundary for ${term}`);
    }
    for (const line of content.split(/\r?\n/).filter((line) => line.startsWith('|'))) {
      assert.equal(
        (line.match(/(?<!\\)\|/g) || []).length,
        4,
        `${readme} must keep three-column tables; unexpected cell separator in: ${line}`,
      );
    }
  }
});

test('skill works when SKILL.md, agentsEye.mjs and references/ are copied alone to a temp folder', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-standalone-skill-'));
  try {
    fs.copyFileSync(path.join(REPO_ROOT, 'SKILL.md'), path.join(tmpDir, 'SKILL.md'));
    fs.copyFileSync(path.join(REPO_ROOT, 'dist/agentsEye.mjs'), path.join(tmpDir, 'agentsEye.mjs'));
    fs.cpSync(path.join(REPO_ROOT, 'references'), path.join(tmpDir, 'references'), { recursive: true });

    assert.deepEqual(
      checkLinks(path.join(tmpDir, 'references/schema-reference.md')),
      [],
      'Standalone schema references must not depend on development-only files',
    );

    const res = spawnSync(process.execPath, [path.join(tmpDir, 'agentsEye.mjs'), '--help'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    assert.equal(res.status, 0, `Isolated agentsEye.mjs --help should exit with 0, got ${res.status}`);
    assert.match(res.stdout, new RegExp(`${TOOL_NAME} v${TOOL_VERSION.replace(/\./g, '\\.')}`));
    assert.doesNotMatch(res.stdout, /npx/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SSOT: version in package.json, CLI flags, badges, and docs matches TOOL_VERSION', () => {
  // 1. package.json consistency
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.equal(
    pkg.version,
    TOOL_VERSION,
    `package.json version (${pkg.version}) must match TOOL_VERSION (${TOOL_VERSION})`
  );
  assert.equal(
    pkg.name,
    TOOL_NAME.toLowerCase(),
    `package.json name (${pkg.name}) must match TOOL_NAME.toLowerCase() (${TOOL_NAME.toLowerCase()})`
  );

  // 2. CLI --version and -V stdout consistency
  const binPath = path.join(REPO_ROOT, 'dist/agentsEye.mjs');
  const resLong = spawnSync(process.execPath, [binPath, '--version'], { encoding: 'utf8' });
  assert.equal(resLong.status, 0, '--version should exit 0');
  assert.equal(
    resLong.stdout.trim(),
    `${TOOL_NAME} ${TOOL_VERSION}`,
    `--version stdout should output "${TOOL_NAME} ${TOOL_VERSION}"`
  );

  const resShort = spawnSync(process.execPath, [binPath, '-V'], { encoding: 'utf8' });
  assert.equal(resShort.status, 0, '-V should exit 0');
  assert.equal(
    resShort.stdout.trim(),
    `${TOOL_NAME} ${TOOL_VERSION}`,
    `-V stdout should output "${TOOL_NAME} ${TOOL_VERSION}"`
  );

  // 3. CLI --help header line consistency
  const resHelp = spawnSync(process.execPath, [binPath, '--help'], { encoding: 'utf8' });
  assert.equal(resHelp.status, 0, '--help should exit 0');
  assert.match(
    resHelp.stdout,
    new RegExp(`^${TOOL_NAME} v${TOOL_VERSION.replace(/\./g, '\\.')}\\b`, 'm'),
    `--help header must match "${TOOL_NAME} v${TOOL_VERSION}"`
  );

  // 4. README badges consistency (English and Persian)
  for (const readme of ['README.md', 'README.fa.md']) {
    const content = fs.readFileSync(path.join(REPO_ROOT, readme), 'utf8');
    const match = content.match(/badge\/version-([^-\s)]+)-blue\.svg/);
    assert.ok(match, `${readme} must contain a version shield badge`);
    assert.equal(
      match[1],
      TOOL_VERSION,
      `${readme} badge version (${match[1]}) must match TOOL_VERSION (${TOOL_VERSION})`
    );
  }

  // 5. AGENTS.md project header consistency
  const agentsMd = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
  const projectMatch = agentsMd.match(/> \*\*Project\*\*:\s*`agentsEye`\s*v([^\s]+)/);
  assert.ok(projectMatch, 'AGENTS.md must contain project header with version');
  assert.equal(
    projectMatch[1],
    TOOL_VERSION,
    `AGENTS.md project header (${projectMatch[1]}) must match TOOL_VERSION (${TOOL_VERSION})`
  );
});

test('interactive refs guide documents the exact common safety skip reasons', () => {
  const guide = fs.readFileSync(path.join(REPO_ROOT, 'references/interactive-refs-guide.md'), 'utf8');
  for (const target of [{ navigation: true }, { submission: true }, { name: 'Delete account' }]) {
    const reason = interactionSafety({ connected: true, visible: true, ...target });
    assert.ok(guide.includes(`- \`${reason}\``), `Guide is missing the exact skip reason: ${reason}`);
  }
});

test('interactive refs guide summary example matches public minimalSummary output', () => {
  const guide = fs.readFileSync(path.join(REPO_ROOT, 'references/interactive-refs-guide.md'), 'utf8');
  const example = JSON.parse(guide.match(/```json\s+([\s\S]*?)```/)[1]);
  const report = {
    ok: true,
    target: { requestedUrl: 'https://example.com/' },
    interactive: {
      items: [
        {
          ref: '@e1', tag: 'button', role: 'button', accessibleName: 'Open Navigation',
          name: 'Fallback label', smallTouchTarget: true,
          rect: {
            viewport: { top: 12, right: 56, bottom: 52, left: 16, width: 40, height: 40 },
            document: { top: 12, right: 56, bottom: 52, left: 16, width: 40, height: 40 },
          },
        },
        { ref: '@e2', tag: 'input', type: 'text', name: 'Search query' },
        { ref: '@e3', tag: 'a', role: 'link', name: 'Pricing', href: 'https://example.com/pricing' },
      ],
    },
  };
  const summary = JSON.parse(JSON.stringify(minimalSummary(report)));
  assert.deepEqual(example.interactive, summary.interactive);
});

test('CLI reference and agent manual document interactive focus and requested flag effects', () => {
  const cli = fs.readFileSync(path.join(REPO_ROOT, 'references/cli-reference.md'), 'utf8');
  const agents = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
  const slices = cli.split('## 4. Output Slices')[1].split('## 5.')[0];
  assert.ok(slices.includes('`interactive`'), 'Output slices table must include interactive');
  assert.match(agents, /Slices available:[^\r\n]*`interactive`/);
  for (const [flag, effect] of [
    ['--depth', /Integer.*0.*100.*compact interactive tree display.*not DOM traversal/i],
    ['--no-max-output', /Disables stdout serialization.*Does not remove summary sampling or collection limits/i],
    ['--browser-arg', /Repeatable.*newly launched Chromium.*No effect with `--cdp`/i],
  ]) {
    const row = cli.split(/\r?\n/).find((line) => line.startsWith(`| \`${flag}\``));
    assert.ok(row, `CLI flag table is missing ${flag}`);
    assert.match(row, effect, `${flag} must explain its effect and limitations`);
    assert.ok(agents.includes(`\`${flag}`), `Agent manual is missing ${flag}`);
  }
});

test('schema reference documents current telemetry fields and rectangle shapes', () => {
  const schema = fs.readFileSync(path.join(REPO_ROOT, 'references/schema-reference.md'), 'utf8');
  const fields = (block) => [...block.matchAll(/\b(\w+)\s*:/g)].map(([, name]) => name).sort();
  const coordinates = ['bottom', 'height', 'left', 'right', 'top', 'width'];
  for (const [section, expected, obsolete] of [
    [
      'metrics',
      [
        'innerWidth', 'innerHeight', 'documentClientWidth', 'documentClientHeight',
        'documentScrollWidth', 'documentScrollHeight',
      ],
      ['scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight'],
    ],
    [
      'scrollLock',
      ['htmlOverflowX', 'htmlOverflowY', 'bodyOverflowX', 'bodyOverflowY', 'locked', 'trapRisk'],
      ['overflowY', 'position', 'contentHeight', 'viewportHeight'],
    ],
    [
      'stats',
      ['nodes', 'elementNodes', 'textNodes', 'visibleElements', 'hiddenElements', 'maxDepthReached'],
      ['totalNodes', 'maxDepth', 'textBytes'],
    ],
  ]) {
    const block = schema.match(new RegExp(`\\b${section}:\\s*\\{([^{}]*)`))[1];
    const actual = fields(block);
    for (const name of expected) assert.ok(actual.includes(name), `${section} is missing ${name}`);
    for (const name of obsolete) assert.ok(!actual.includes(name), `${section} still documents obsolete ${name}`);
  }
  for (const name of ['documentClientWidth', 'documentClientHeight', 'documentScrollWidth', 'documentScrollHeight']) {
    assert.ok(new RegExp(`${name}:\\s*number\\s*\\|\\s*null`).test(schema), `${name} must allow null`);
  }
  const overflowRect = schema.match(/overflowElements:\s*Array<\{[^{}]*rect:\s*\{([^{}]*)\}/)?.[1];
  assert.ok(overflowRect, 'Overflow findings must document a flat viewport rectangle');
  assert.deepEqual(fields(overflowRect), coordinates);
  const interactive = schema.match(/export interface InteractiveItem\s*\{([\s\S]*?)^\}/m)?.[1];
  const headings = schema.match(/\bheadings:\s*\{[\s\S]*?items:\s*Array<\{([\s\S]*?)\}>;/)?.[1];
  for (const [name, block] of [['InteractiveItem', interactive], ['headings.items', headings]]) {
    assert.ok(block, `${name} definition is missing`);
    const rect = block.match(/\brect\??:\s*\{\s*viewport:\s*\{([^{}]*)\};\s*document:\s*\{([^{}]*)\};\s*\}(?:\s*\|\s*null)?/);
    assert.ok(rect, `${name}.rect must document both coordinate spaces`);
    assert.deepEqual(fields(rect[1]), coordinates);
    assert.deepEqual(fields(rect[2]), coordinates);
    if (name === 'headings.items') assert.match(rect[0], /\}\s*\|\s*null$/);
  }
  const diffSchema = schema.split('export interface DiffReport')[1];
  for (const name of ['before', 'after']) {
    const box = diffSchema.match(new RegExp(`\\b${name}:\\s*\\{([^{}]*)\\}`))[1];
    assert.deepEqual(fields(box), coordinates);
  }
});

test('CLI and security references distinguish SSRF policy rejection from DNS failure', async () => {
  await assert.rejects(
    () => validateResolvedTargetUrl('http://169.254.169.254/'),
    { name: 'UsageError', exitCode: 2 },
  );
  await assert.rejects(
    () => validateResolvedTargetUrl('https://example.test/', {
      lookup: async () => { throw new Error('DNS unavailable'); },
    }),
    { name: 'InspectorError', code: 'DNS_LOOKUP_FAILED', exitCode: 1 },
  );
  const cli = fs.readFileSync(path.join(REPO_ROOT, 'references/cli-reference.md'), 'utf8');
  const runtime = cli.split(/\r?\n/).find((line) => line.startsWith('| **`1`**'));
  const usage = cli.split(/\r?\n/).find((line) => line.startsWith('| **`2`**'));
  assert.ok(
    runtime?.includes('`InspectorError`') && runtime.includes('DNS'),
    'Exit 1 must describe DNS operational InspectorError failures',
  );
  assert.ok(
    usage?.includes('`UsageError`') && /preflight.*SSRF/i.test(usage),
    'Exit 2 must include preflight SSRF UsageError',
  );
  const runtimeBranch = cli.split(/\r?\n/).find((line) => /--\s*"1"\s*-->/.test(line));
  const usageBranch = cli.split(/\r?\n/).find((line) => /--\s*"2"\s*-->/.test(line));
  assert.ok(
    runtimeBranch?.includes('InspectorError') && runtimeBranch.includes('DNS'),
    'CLI diagram must classify DNS failures as InspectorError / exit 1',
  );
  assert.ok(
    usageBranch?.includes('UsageError') && usageBranch.includes('SSRF'),
    'CLI diagram must classify preflight SSRF rejection as UsageError / exit 2',
  );
  const security = fs.readFileSync(path.join(REPO_ROOT, 'references/security-model.md'), 'utf8');
  const blockedBranch = security.split(/\r?\n/).find((line) => line.includes('|Blocked IP / Metadata|'));
  assert.ok(
    blockedBranch?.includes('UsageError') && /\b2\b/.test(blockedBranch),
    'Security diagram must report UsageError / exit 2',
  );
  const dns = security.split('### A. Preflight DNS')[1].split('### B.')[0];
  const prohibited = security.split('### B. Prohibited IP')[1].split('| Category')[0];
  assert.ok(
    dns.includes('`InspectorError`') && dns.includes('exit code `1`'),
    'DNS failures must remain runtime errors even during preflight',
  );
  assert.ok(
    prohibited.includes('`UsageError`') && prohibited.includes('exit code `2`'),
    'Blocked metadata addresses must be documented as usage errors',
  );
});

test('interactive refs guide blacklist examples are blocked by public interactionSafety', () => {
  const guide = fs.readFileSync(path.join(REPO_ROOT, 'references/interactive-refs-guide.md'), 'utf8');
  const rows = guide.split(/\r?\n/).filter((line) => /^- \*\*(?:English|Persian)\*\*:/.test(line));
  assert.equal(rows.length, 2, 'Guide must list English and Persian blacklist examples');
  for (const row of rows) {
    const examples = [...row.matchAll(/`([^`]+)`/g)];
    assert.ok(examples.length, 'Each blacklist row must include examples');
    for (const [, name] of examples) {
      assert.equal(
        interactionSafety({ connected: true, visible: true, name }),
        'Potentially destructive action blocked by text safety policy',
        `Guide claims "${name}" is blocked by the keyword policy`,
      );
    }
  }
});

test('security docs distinguish blocked metadata from allowed private and IPv6 targets', async () => {
  for (const url of ['http://10.0.0.1/', 'http://[fe80::1]/', 'http://[::ffff:192.168.1.1]/']) {
    await assert.doesNotReject(
      () => validateResolvedTargetUrl(url),
      `${url} is allowed by target preflight`,
    );
  }
  const security = fs.readFileSync(path.join(REPO_ROOT, 'references/security-model.md'), 'utf8');
  const prohibited = security.split('### B. Prohibited IP')[1].split('### C.')[0];
  assert.doesNotMatch(prohibited, /fe80::\/10/, 'IPv6 link-local is not a prohibited target range');
  for (const file of ['references/security-model.md', 'AGENTS.md']) {
    const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    assert.match(
      content,
      /private and loopback targets[^\r\n]*allowed/i,
      `${file} must describe allowed development targets`,
    );
    assert.match(
      content,
      /not blanket-block[^\r\n]*IPv6 link-local[^\r\n]*non-metadata IPv4-mapped IPv6/i,
      `${file} must distinguish allowed IPv6 targets from blocked metadata`,
    );
  }
});

test('CLI header reference distinguishes same-origin assets from cross-origin requests', () => {
  const cli = fs.readFileSync(path.join(REPO_ROOT, 'references/cli-reference.md'), 'utf8');
  const header = cli.split(/\r?\n/).find((line) => line.startsWith('| `--header`'));
  assert.ok(header, 'CLI reference must document custom headers');
  assert.match(header, /same-origin assets/i);
  assert.match(header, /matching header names are stripped on cross-origin requests/i);
});
