import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addLogicalMonths,
  formatLogicalMonth,
  getMondayFirstOffset,
  isValidLogicalMonth,
} from '../src/lib/logicalMonth.js';
import { formatPaise, paiseToRupeeInput, rupeesToPaise } from '../src/lib/money.js';

describe('frontend logical month utilities', () => {
  test('validates, navigates, and formats canonical months', () => {
    assert.equal(isValidLogicalMonth('2026-09'), true);
    assert.equal(isValidLogicalMonth('2026-9'), false);
    assert.equal(isValidLogicalMonth('2026-13'), false);
    assert.equal(addLogicalMonths('2026-12', 1), '2027-01');
    assert.equal(addLogicalMonths('2026-01', -1), '2025-12');
    assert.equal(formatLogicalMonth('2026-09'), 'September 2026');
    assert.equal(getMondayFirstOffset('2026-09-01'), 1);
  });
});

describe('rupee and paise utilities', () => {
  test('converts valid rupee strings to exact integer paise', () => {
    assert.equal(rupeesToPaise('50'), 5000);
    assert.equal(rupeesToPaise('50.00'), 5000);
    assert.equal(rupeesToPaise('62.5'), 6250);
    assert.equal(rupeesToPaise('62.50'), 6250);
    assert.equal(rupeesToPaise('0'), 0);
  });

  test('rejects negative, excessive precision, non-numeric, and oversized values', () => {
    for (const value of ['-1', '12.345', 'abc', 'Infinity', 'NaN', '100000.01']) {
      assert.equal(rupeesToPaise(value), null, value);
    }
  });

  test('formats paise consistently and round-trips rate input values', () => {
    assert.equal(formatPaise(208000), '₹2,080');
    assert.equal(formatPaise(6250), '₹62.50');
    assert.equal(formatPaise(null), 'Rates not set');
    assert.equal(paiseToRupeeInput(6250), '62.50');
    assert.equal(paiseToRupeeInput(5000), '50');
  });
});

