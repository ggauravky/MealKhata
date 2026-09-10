import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addLogicalDays, formatLogicalDate, isValidLogicalDate } from '../src/lib/logicalDate.js';

describe('logical-date-safe frontend formatting', () => {
  test('formats a YYYY-MM-DD without local timezone date drift', () => {
    assert.equal(
      formatLogicalDate('2026-09-09', { day: 'numeric', month: 'short', year: 'numeric' }),
      '9 Sept 2026',
    );
  });

  test('moves across month and leap-year boundaries using logical dates', () => {
    assert.equal(addLogicalDays('2026-09-30', 1), '2026-10-01');
    assert.equal(addLogicalDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addLogicalDays('2026-01-01', -1), '2025-12-31');
  });

  test('rejects impossible and malformed logical dates', () => {
    assert.equal(isValidLogicalDate('2026-09-10'), true);
    assert.equal(isValidLogicalDate('2026-02-30'), false);
    assert.equal(isValidLogicalDate('2026-9-10'), false);
  });
});
