import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSafeNextPath } from '../src/lib/navigation.js';

test('safe next-route handling allows local paths and rejects external redirects', () => {
  assert.equal(getSafeNextPath('/admin'), '/admin');
  assert.equal(getSafeNextPath('/admin?from=login#access'), '/admin?from=login#access');

  for (const unsafeValue of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '',
    null,
  ]) {
    assert.equal(getSafeNextPath(unsafeValue), '/admin');
  }
});
