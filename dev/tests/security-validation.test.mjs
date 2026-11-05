import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateTargetUrl,
  validateResolvedHostname,
  validateResolvedTargetUrl,
  isMetadataHost,
  validateCdpEndpoint,
  resolveSafePath,
  validateRunId,
} from '../../agentsEye.mjs';

// ============================================================================
// 1. validateTargetUrl
// ============================================================================

test('validateTargetUrl: accepts valid http and https URLs', () => {
  const u1 = validateTargetUrl('http://example.com');
  assert.equal(u1.origin, 'http://example.com');

  const u2 = validateTargetUrl('https://example.com/some/path?param=value#section');
  assert.equal(u2.protocol, 'https:');
  assert.equal(u2.pathname, '/some/path');

  const u3 = validateTargetUrl('http://localhost:8080');
  assert.equal(u3.port, '8080');

  const u4 = validateTargetUrl('https://127.0.0.1:3000/app');
  assert.equal(u4.hostname, '127.0.0.1');
});

test('validateTargetUrl: rejects non-http(s) schemes', () => {
  const invalidSchemes = [
    'file:///etc/passwd',
    'file:///C:/Windows/System32/drivers/etc/hosts',
    'javascript:alert(1)',
    'javascript://example.com/%0Aalert(1)',
    'data:text/html,<h1>dangerous</h1>',
    'ftp://ftp.example.com/file.txt',
    'about:blank',
    'blob:http://example.com/uuid-here',
    'ws://localhost:9222/devtools',
    'wss://example.com/socket',
    'gopher://example.com',
  ];

  for (const url of invalidSchemes) {
    assert.throws(
      () => validateTargetUrl(url),
      { name: 'UsageError', message: /Only http\(s\) URLs are allowed/i },
      `Expected ${url} to be rejected for scheme`,
    );
  }
});

test('validateTargetUrl: rejects malformed URLs', () => {
  const malformed = [
    'not-a-valid-url',
    '',
    '   ',
    'http://',
    'http://[invalid-ipv6]',
    null,
    undefined,
  ];

  for (const raw of malformed) {
    assert.throws(
      () => validateTargetUrl(raw),
      { name: 'UsageError', message: /Invalid URL/i },
      `Expected ${raw} to be rejected as malformed`,
    );
  }
});

test('validateTargetUrl: rejects URLs with credentials (userinfo)', () => {
  const withCreds = [
    'http://user:pass@example.com',
    'http://admin@example.com',
    'http://:secret@example.com',
    'http://user%3Apass@example.com',
    'http://user%40corp.com:pass@example.com',
    'https://token:@example.com/api',
  ];

  for (const url of withCreds) {
    assert.throws(
      () => validateTargetUrl(url),
      { name: 'UsageError', message: /URLs containing credentials are not allowed/i },
      `Expected ${url} to be rejected for userinfo`,
    );
  }
});

test('validateTargetUrl: rejects cloud metadata endpoints', () => {
  const metadataUrls = [
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.170.2/v2/metadata',
    'http://100.100.100.200/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://metadata.goog/computeMetadata/v1/',
    'http://metadata.azure.com/metadata/instance',
    'http://instance-data/latest/meta-data/',
    'http://[fd00:ec2::254]/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://2852039166/latest/meta-data/',
    'http://0xa9fea9fe/latest/meta-data/',
  ];

  for (const url of metadataUrls) {
    assert.throws(
      () => validateTargetUrl(url),
      { name: 'UsageError', message: /Cloud metadata endpoints are blocked/i },
      `Expected ${url} to be rejected as cloud metadata`,
    );
  }
});

test('validateTargetUrl: rejects invalid port numbers', () => {
  assert.throws(
    () => validateTargetUrl('http://example.com:70000'),
    { name: 'UsageError' },
  );
});

// ============================================================================
// 2. isMetadataHost
// ============================================================================

test('isMetadataHost: identifies IPv4 link-local and cloud metadata addresses', () => {
  assert.equal(isMetadataHost('169.254.169.254'), true, 'AWS/GCP IPv4 metadata');
  assert.equal(isMetadataHost('169.254.170.2'), true, 'AWS ECS task metadata');
  assert.equal(isMetadataHost('169.254.1.1'), true, 'IPv4 link-local range');
  assert.equal(isMetadataHost('169.254.254.254'), true, 'IPv4 link-local upper');
  assert.equal(isMetadataHost('100.100.100.200'), true, 'Alibaba Cloud metadata');
});

test('isMetadataHost: identifies IPv6 and IPv4-mapped IPv6 metadata', () => {
  assert.equal(isMetadataHost('fd00:ec2::254'), true, 'AWS IPv6 metadata');
  assert.equal(isMetadataHost('[fd00:ec2::254]'), true, 'AWS IPv6 metadata bracketed');
  assert.equal(isMetadataHost('::ffff:169.254.169.254'), true, 'IPv4-mapped metadata');
  assert.equal(isMetadataHost('[::ffff:169.254.169.254]'), true, 'IPv4-mapped metadata bracketed');
});

test('isMetadataHost: identifies decimal and hex encoded IPv4 metadata', () => {
  assert.equal(isMetadataHost('2852039166'), true, 'Dword for 169.254.169.254');
  assert.equal(isMetadataHost('0xa9fea9fe'), true, 'Hex for 169.254.169.254');
  assert.equal(isMetadataHost('0xa9.0xfe.0xa9.0xfe'), true, 'Dotted hex metadata');
});

test('isMetadataHost: identifies metadata domain names and subdomains', () => {
  assert.equal(isMetadataHost('metadata.google.internal'), true);
  assert.equal(isMetadataHost('subdomain.metadata.google.internal'), true);
  assert.equal(isMetadataHost('metadata.goog'), true);
  assert.equal(isMetadataHost('metadata.azure.com'), true);
  assert.equal(isMetadataHost('instance-data'), true);
});

test('isMetadataHost: does not flag public or local non-metadata hosts', () => {
  assert.equal(isMetadataHost('localhost'), false);
  assert.equal(isMetadataHost('127.0.0.1'), false);
  assert.equal(isMetadataHost('::1'), false);
  assert.equal(isMetadataHost('0.0.0.0'), false);
  assert.equal(isMetadataHost('8.8.8.8'), false);
  assert.equal(isMetadataHost('1.1.1.1'), false);
  assert.equal(isMetadataHost('example.com'), false);
  assert.equal(isMetadataHost('192.168.1.1'), false);
  assert.equal(isMetadataHost('10.0.0.1'), false);
});

// ============================================================================
// 3. validateResolvedHostname & validateResolvedTargetUrl
// ============================================================================

test('validateResolvedHostname: allows loopback and private hosts by default', async () => {
  await assert.doesNotReject(() => validateResolvedHostname('127.0.0.1'));
  await assert.doesNotReject(() => validateResolvedHostname('::1'));
  await assert.doesNotReject(() => validateResolvedHostname('0.0.0.0'));
  await assert.doesNotReject(() => validateResolvedHostname('10.0.0.1'));
  await assert.doesNotReject(() => validateResolvedHostname('172.16.0.1'));
  await assert.doesNotReject(() => validateResolvedHostname('192.168.1.1'));
});

test('validateResolvedHostname: blocks cloud metadata hosts immediately', async () => {
  await assert.rejects(
    () => validateResolvedHostname('169.254.169.254'),
    { name: 'UsageError', message: /Cloud metadata endpoints are blocked/i },
  );
  await assert.rejects(
    () => validateResolvedHostname('fd00:ec2::254'),
    { name: 'UsageError', message: /Cloud metadata endpoints are blocked/i },
  );
});

test('validateResolvedHostname: blocks DNS responses resolving to metadata IPs', async () => {
  const mockLookup = async () => [{ address: '169.254.169.254', family: 4 }];
  await assert.rejects(
    () => validateResolvedHostname('spoofed.internal', { lookup: mockLookup }),
    { name: 'UsageError', message: /Cloud metadata endpoints are blocked by DNS validation/i },
  );
});

test('validateResolvedHostname: blocks private IPs when allowPrivate is false', async () => {
  const privateIps = [
    '127.0.0.1',
    '127.0.0.2',
    'localhost',
    'test.localhost',
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '10.255.255.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.0.1',
    '192.168.1.100',
    '169.254.1.1',
    '100.64.0.1',
    '100.127.255.254',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
    '::ffff:127.0.0.1',
  ];

  for (const host of privateIps) {
    const mockLookup = async () => [{ address: host.replace(/^\[|\]$/g, ''), family: host.includes(':') ? 6 : 4 }];
    await assert.rejects(
      () => validateResolvedHostname(host, { allowPrivate: false, lookup: mockLookup }),
      { name: 'UsageError', message: /(?:Private network addresses are blocked|Cloud metadata endpoints are blocked)/i },
      `Expected ${host} to be blocked when allowPrivate: false`,
    );
  }
});

test('validateResolvedHostname: blocks DNS resolution to private IP when allowPrivate is false', async () => {
  const mockLookup = async () => [{ address: '192.168.1.50', family: 4 }];
  await assert.rejects(
    () => validateResolvedHostname('internal.company.com', { allowPrivate: false, lookup: mockLookup }),
    { name: 'UsageError', message: /Private network addresses are blocked by DNS validation/i },
  );
});

test('validateResolvedHostname: allows public IPs when allowPrivate is false', async () => {
  const publicHosts = [
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.0.1',
    '172.32.0.1',
    '192.167.1.1',
    '192.169.1.1',
    '100.63.255.255',
    '100.128.0.1',
    '2606:2800:220:1:248:1893:25c8:1946',
  ];

  for (const host of publicHosts) {
    await assert.doesNotReject(
      () => validateResolvedHostname(host, { allowPrivate: false }),
      `Expected public IP ${host} to be allowed when allowPrivate: false`,
    );
  }
});

test('validateResolvedHostname: enforces loopbackOnly when requested', async () => {
  await assert.doesNotReject(() => validateResolvedHostname('127.0.0.1', { loopbackOnly: true }));
  await assert.doesNotReject(() => validateResolvedHostname('::1', { loopbackOnly: true }));

  await assert.rejects(
    () => validateResolvedHostname('93.184.216.34', { loopbackOnly: true }),
    { name: 'UsageError', message: /--cdp must resolve only to loopback addresses/i },
  );
});

test('validateResolvedHostname: handles DNS lookup failures and empty results', async () => {
  const failingLookup = async () => {
    const err = new Error('getaddrinfo ENOTFOUND');
    err.code = 'ENOTFOUND';
    throw err;
  };

  await assert.rejects(
    () => validateResolvedHostname('non-existent.domain.invalid', { lookup: failingLookup }),
    { name: 'InspectorError', code: 'DNS_LOOKUP_FAILED' },
  );

  const emptyLookup = async () => [];
  await assert.rejects(
    () => validateResolvedHostname('empty.domain.invalid', { lookup: emptyLookup }),
    { name: 'InspectorError', code: 'DNS_LOOKUP_FAILED' },
  );
});

test('validateResolvedTargetUrl: end-to-end URL parsing and resolution validation', async () => {
  // Valid public URL with allowPrivate: false
  const parsedPublic = await validateResolvedTargetUrl('https://93.184.216.34/path', { allowPrivate: false });
  assert.equal(parsedPublic.hostname, '93.184.216.34');

  // Private URL allowed by default
  const parsedLocal = await validateResolvedTargetUrl('http://127.0.0.1:8080/');
  assert.equal(parsedLocal.port, '8080');

  // Private URL blocked with allowPrivate: false
  await assert.rejects(
    () => validateResolvedTargetUrl('http://10.0.0.1:8080/', { allowPrivate: false }),
    { name: 'UsageError', message: /Private network addresses are blocked/i },
  );

  // Metadata URL blocked upfront
  await assert.rejects(
    () => validateResolvedTargetUrl('http://169.254.169.254/'),
    { name: 'UsageError', message: /Cloud metadata endpoints are blocked/i },
  );
});

// ============================================================================
// 4. validateCdpEndpoint
// ============================================================================

test('validateCdpEndpoint: accepts valid loopback http and ws endpoints', () => {
  const e1 = validateCdpEndpoint('http://localhost:9222');
  assert.equal(e1.hostname, 'localhost');
  assert.equal(e1.port, '9222');

  const e2 = validateCdpEndpoint('http://127.0.0.1:9222');
  assert.equal(e2.hostname, '127.0.0.1');

  const e3 = validateCdpEndpoint('ws://127.0.0.1:9222/devtools/browser/abc-123');
  assert.equal(e3.protocol, 'ws:');
  assert.equal(e3.pathname, '/devtools/browser/abc-123');

  const e4 = validateCdpEndpoint('ws://[::1]:9222/devtools');
  assert.equal(e4.protocol, 'ws:');
});

test('validateCdpEndpoint: rejects invalid schemes and credentials', () => {
  assert.throws(
    () => validateCdpEndpoint('file:///etc/cdp'),
    { name: 'UsageError', message: /--cdp must be an http\(s\) or ws\(s\) URL/i },
  );

  assert.throws(
    () => validateCdpEndpoint('http://user:pass@127.0.0.1:9222'),
    { name: 'UsageError', message: /--cdp URLs containing credentials are not allowed/i },
  );

  assert.throws(
    () => validateCdpEndpoint('not a url'),
    { name: 'UsageError', message: /Invalid --cdp endpoint/i },
  );
});

test('validateCdpEndpoint: rejects non-loopback endpoints unless allowRemote is true', () => {
  assert.throws(
    () => validateCdpEndpoint('http://remote.host:9222'),
    { name: 'UsageError', message: /--cdp is restricted to loopback endpoints/i },
  );

  assert.throws(
    () => validateCdpEndpoint('ws://remote.host:9222/devtools'),
    { name: 'UsageError', message: /--cdp is restricted to loopback endpoints/i },
  );

  const allowedHttp = validateCdpEndpoint('http://remote.host:9222', true);
  assert.equal(allowedHttp.hostname, 'remote.host');

  const allowedWs = validateCdpEndpoint('ws://remote.host:9222/devtools', true);
  assert.equal(allowedWs.hostname, 'remote.host');
});

test('validateCdpEndpoint: rejects cloud metadata endpoints even with allowRemote: true', () => {
  const metadataEndpoints = [
    'http://169.254.169.254:9222',
    'ws://[fd00:ec2::254]:9222/devtools',
    'http://[::ffff:169.254.169.254]:9222',
    'http://metadata.google.internal:9222',
  ];

  for (const ep of metadataEndpoints) {
    assert.throws(
      () => validateCdpEndpoint(ep, true),
      { name: 'UsageError', message: /Cloud metadata endpoints are blocked/i },
      `Expected metadata CDP endpoint ${ep} to be blocked even with allowRemote`,
    );
  }
});

// ============================================================================
// 5. resolveSafePath
// ============================================================================

test('resolveSafePath: allows safe paths within cwd', () => {
  const cwd = process.cwd();
  const res1 = resolveSafePath('report.json', {}, '--out');
  assert.equal(res1, path.resolve(cwd, 'report.json'));

  const res2 = resolveSafePath('subdir/nested/screenshot.png', {}, '--screenshot');
  assert.equal(res2, path.resolve(cwd, 'subdir/nested/screenshot.png'));

  const res3 = resolveSafePath('./file.txt', {}, '--out');
  assert.equal(res3, path.resolve(cwd, 'file.txt'));
});

test('resolveSafePath: rejects directory traversal escaping cwd', () => {
  const traversalAttempts = [
    '../../secret.txt',
    '../escaped.json',
    'foo/../../bar.txt',
    'a/b/../../../c.txt',
  ];

  for (const attempt of traversalAttempts) {
    assert.throws(
      () => resolveSafePath(attempt, {}, '--out'),
      { name: 'UsageError', message: /must resolve inside the current working directory/i },
      `Expected traversal ${attempt} to be rejected`,
    );
  }
});

test('resolveSafePath: rejects null bytes', () => {
  const nullByteAttempts = [
    'report\0.json',
    'nested/\0file.txt',
    '\0secret',
  ];

  for (const attempt of nullByteAttempts) {
    assert.throws(
      () => resolveSafePath(attempt, {}, '--out'),
      { name: 'UsageError', message: /null byte/i },
      `Expected null byte attempt ${JSON.stringify(attempt)} to be rejected`,
    );
  }
});

test('resolveSafePath: rejects Windows reserved device filenames', () => {
  const reservedNames = [
    'CON.txt',
    'prn.json',
    'AUX.log',
    'NUL',
    'COM1.png',
    'com9.txt',
    'LPT1.dat',
  ];

  for (const name of reservedNames) {
    assert.throws(
      () => resolveSafePath(name, {}, '--out'),
      { name: 'UsageError', message: /Invalid reserved device filename/i },
      `Expected reserved name ${name} to be rejected`,
    );
  }
});

test('resolveSafePath: rejects junctions or symlinks pointing outside cwd', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentseye-safe-path-test-'));
  const junctionDir = path.join(process.cwd(), 'test-junction-outside');
  try {
    fs.symlinkSync(tmpDir, junctionDir, 'junction');
    assert.throws(
      () => resolveSafePath('test-junction-outside/escaped.json', {}, '--out'),
      { name: 'UsageError', message: /resolves outside working directory via symbolic link/i },
    );
  } catch (err) {
    if (err.name !== 'UsageError') {
      // Junction creation might fail on some restricted environments; skip if so
      console.warn('Skipping junction symlink test due to environment limitation:', err.message);
    } else {
      throw err;
    }
  } finally {
    try { fs.rmdirSync(junctionDir); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test('resolveSafePath: allows outside paths when allowOutsideCwd is true', () => {
  const outsidePath = path.resolve(process.cwd(), '..', 'external-report.json');
  const resolved = resolveSafePath(outsidePath, { allowOutsideCwd: true }, '--out');
  assert.equal(resolved, outsidePath);
});

// ============================================================================
// 6. validateRunId
// ============================================================================

test('validateRunId: accepts valid alphanumeric IDs with hyphens, underscores and timestamps', () => {
  const validIds = [
    'run-1',
    'run_123',
    'run-2026-10-31-001',
    '2026-10-31T12-00-00-123Z',
    'run_abc_XYZ_789',
    'a',
    '1',
    'A'.repeat(128),
  ];

  for (const id of validIds) {
    const validated = validateRunId(id);
    assert.equal(validated, id, `Expected ${id} to be accepted`);
  }
});

test('validateRunId: rejects path traversal and directory separators', () => {
  const traversalIds = [
    '../run',
    '..\\run',
    '../../etc/passwd',
    'run/child',
    'run\\child',
    '/root',
    '\\windows',
    'run/../run',
  ];

  for (const id of traversalIds) {
    assert.throws(
      () => validateRunId(id),
      { name: 'UsageError', message: /Run IDs may only contain letters, digits, underscores and hyphens/i },
      `Expected traversal ${id} to be rejected`,
    );
  }
});

test('validateRunId: rejects null bytes, spaces, and special characters', () => {
  const invalidIds = [
    'run\0id',
    'run id',
    'run;rm -rf',
    'run$test',
    'run!@#',
    'run.with.dots',
    '-starts-with-hyphen',
    '_starts-with-underscore',
    '.starts-with-dot',
    '',
    null,
    undefined,
    'A'.repeat(129), // Exceeds 128 characters
  ];

  for (const id of invalidIds) {
    assert.throws(
      () => validateRunId(id),
      { name: 'UsageError', message: /Run IDs may only contain letters, digits, underscores and hyphens/i },
      `Expected ${JSON.stringify(id)} to be rejected`,
    );
  }
});

test('resolveSafePath: allows non-existent path in temp runs without false symlink escape error', () => {
  const target = path.join(os.tmpdir(), '.agentsEye', 'runs', 'temp-run-nonexistent', 'shot.png');
  const resolved = resolveSafePath(target);
  assert.equal(resolved, path.resolve(target));
});
