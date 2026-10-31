import test from 'node:test';
import assert from 'node:assert/strict';
import { diffReports, redactString, redactUrl } from '../../agentsEye.mjs';

test('diffReports: identical reports produce zero new issues and zero new errors', () => {
  const baseReport = {
    ok: true,
    schemaVersion: '1.0',
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
