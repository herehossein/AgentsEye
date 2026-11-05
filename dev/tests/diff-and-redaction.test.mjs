import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffReports,
  redactString,
  redactUrl,
  SCHEMA_VERSION,
  computeUnifiedTextDiff,
  diffInteractiveSnapshots,
} from '../../agentsEye.mjs';

test('diffReports: identical reports produce zero new issues and zero new errors', () => {
  const baseReport = {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    run: { id: 'run-1' },
    target: { requestedUrl: 'http://test.local', finalUrl: 'http://test.local' },
    layout: { horizontalOverflow: false },
    issues: [{ code: 'contrast-low', message: 'Low contrast on button' }],
    errors: {
      uncaught: [{ message: 'TypeError: undefined is not a function' }],
      logErrors: [],
    },
    dom: { tree: { tag: 'html', children: [{ tag: 'body' }] } },
    network: { failures: [] },
  };

  const diff = diffReports(baseReport, baseReport);
  assert.equal(diff.summary.newErrors, 0);
  assert.equal(diff.summary.newIssues, 0);
  assert.equal(diff.summary.added, 0);
  assert.equal(diff.summary.removed, 0);
});

test('diffReports: detects newly introduced errors and issues', () => {
  const before = {
    ok: true,
    run: { id: 'run-before' },
    target: { requestedUrl: 'http://test.local', finalUrl: 'http://test.local' },
    issues: [],
    errors: { uncaught: [], logErrors: [] },
    dom: { tree: { tag: 'html' } },
  };

  const after = {
    ok: true,
    run: { id: 'run-after' },
    target: { requestedUrl: 'http://test.local', finalUrl: 'http://test.local' },
    issues: [{ code: 'horizontal-document-overflow', message: 'Width exceeds viewport' }],
    errors: {
      uncaught: [{ message: 'Uncaught Error: Crash after edit' }],
      logErrors: [],
    },
    dom: { tree: { tag: 'html' } },
  };

  const diff = diffReports(before, after);
  assert.equal(diff.summary.newErrors, 1);
  assert.equal(diff.summary.newIssues, 1);
});

test('redactString: masks sensitive bearer tokens and secrets', () => {
  const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSecret';
  const redacted = redactString(input, 'sensitive');
  assert.doesNotMatch(redacted, /doNotLeakThisSecret/);
  assert.ok(redacted.includes('[REDACTED]'));
  assert.ok(redacted.includes('[REDACTED:JWT]'));

  const apiKeyInput = 'Using API Key: sk_live_51AbCDeFgHiJkLmNoPqRsTuVwXyZ123456';
  const redactedKey = redactString(apiKeyInput, 'sensitive');
  assert.doesNotMatch(redactedKey, /sk_live_51AbCDeFgHiJkLmNoPqRsTuVwXyZ123456/);
  assert.ok(redactedKey.includes('[REDACTED:KEY]'));

  const jsonInput = '{"auth_token": "supersecret123", "password": "mySecretPassword", "unrelated": "safeValue"}';
  const redactedJson = redactString(jsonInput, 'sensitive');
  assert.doesNotMatch(redactedJson, /supersecret123/);
  assert.doesNotMatch(redactedJson, /mySecretPassword/);
  assert.ok(redactedJson.includes('"auth_token": "[REDACTED]"'));
  assert.ok(redactedJson.includes('"password": "[REDACTED]"'));
  assert.ok(redactedJson.includes('safeValue'));
});

test('redactString: masks emails in redact all mode', () => {
  const input = 'Contact user at secret.admin@example.corp for access';
  const sensitiveMode = redactString(input, 'sensitive');
  assert.ok(sensitiveMode.includes('secret.admin@example.corp'), 'sensitive mode preserves email');

  const allMode = redactString(input, 'all');
  assert.doesNotMatch(allMode, /secret\.admin@example\.corp/);
  assert.ok(allMode.includes('[REDACTED:EMAIL]'));
});

test('redactUrl: masks query credentials in URLs', () => {
  const urlWithKey = 'https://api.internal/endpoint?api_key=myPrivateApiKey&filter=active';
  const redactedUrl = redactUrl(urlWithKey, 'sensitive');
  assert.doesNotMatch(redactedUrl, /myPrivateApiKey/);
  assert.ok(redactedUrl.includes('api_key=[REDACTED]'));
  assert.ok(redactedUrl.includes('filter=active'));
});

test('computeUnifiedTextDiff: identical inputs return empty diff and changed=false', () => {
  const text = 'line 1\nline 2\nline 3';
  const result = computeUnifiedTextDiff(text, text);
  assert.equal(result.changed, false);
  assert.equal(result.diff, '');
  assert.equal(result.additions, 0);
  assert.equal(result.removals, 0);
  assert.equal(result.unchanged, 3);
});

test('computeUnifiedTextDiff: detects line additions and removals', () => {
  const before = 'line 1\nline 2';
  const after = 'line 1\nline 3';
  const result = computeUnifiedTextDiff(before, after);
  assert.equal(result.changed, true);
  assert.ok(result.diff.includes('- line 2'));
  assert.ok(result.diff.includes('+ line 3'));
  assert.equal(result.additions, 1);
  assert.equal(result.removals, 1);
});

test('diffInteractiveSnapshots: identical snapshots return kind unchanged and changed=false', () => {
  const items = [
    { ref: '@e1', role: 'button', name: 'Submit' },
    { ref: '@e2', role: 'link', name: 'Home' },
  ];
  const treeText = '@e1 [button] "Submit"\n@e2 [link] "Home"\n';
  const delta = diffInteractiveSnapshots(items, items, treeText, treeText);

  assert.equal(delta.kind, 'unchanged');
  assert.equal(delta.changed, false);
  assert.equal(delta.additions, 0);
  assert.equal(delta.removals, 0);
});

test('diffInteractiveSnapshots: detects additions, removals, and replacements', () => {
  const beforeItems = [
    { ref: '@e1', role: 'button', name: 'Submit', disabled: false },
    { ref: '@e2', role: 'link', name: 'Help' },
  ];
  const afterItems = [
    { ref: '@e1', role: 'button', name: 'Submit', disabled: true },
    { ref: '@e3', role: 'textbox', name: 'Search', tag: 'input' },
  ];
  const beforeTree = '@e1 [button] "Submit"\n@e2 [link] "Help"';
  const afterTree = '@e1 [button] "Submit" [disabled]\n@e3 [textbox] "Search"';

  const delta = diffInteractiveSnapshots(beforeItems, afterItems, beforeTree, afterTree);

  assert.equal(delta.kind, 'delta');
  assert.equal(delta.changed, true);
  assert.ok(delta.changes);
  assert.ok(delta.changes.some((c) => c.op === 'remove' && c.ref === '@e2'));
  assert.ok(delta.changes.some((c) => c.op === 'add' && c.ref === '@e3'));
  assert.ok(delta.changes.some((c) => c.op === 'replace' && c.ref === '@e1'));
  assert.equal(delta.replacements, 1);
  assert.equal(delta.additions, 1);
  assert.equal(delta.removals, 1);
  // unchanged should be 0 because after has 2 items: 1 addition (@e3) + 1 replacement (@e1)
  assert.equal(delta.unchanged, 0);
});

test('computeUnifiedTextDiff: detects duplicate line additions and line reordering', () => {
  const beforeDup = 'btn\nbtn';
  const afterDup = 'btn\nbtn\nbtn';
  const resDup = computeUnifiedTextDiff(beforeDup, afterDup);
  assert.equal(resDup.changed, true);
  assert.equal(resDup.additions, 1);
  assert.equal(resDup.removals, 0);

  const beforeSwap = 'line A\nline B';
  const afterSwap = 'line B\nline A';
  const resSwap = computeUnifiedTextDiff(beforeSwap, afterSwap);
  assert.equal(resSwap.changed, true);
  assert.ok(resSwap.additions > 0 || resSwap.removals > 0);
});
