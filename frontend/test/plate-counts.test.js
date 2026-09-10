import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatPlateCount, getPlateCounts } from '../src/lib/plates.js';

const meals = (morning, night) => ({ morning, night });
const statuses = (gaurav, nikhil, devansh) => ({ gaurav, nikhil, devansh });

describe('derived plate counts', () => {
  test('all Taking produces three Morning, three Night, and six total plates', () => {
    const taking = statuses('taking', 'taking', 'taking');
    assert.deepEqual(getPlateCounts(meals(taking, taking)), { morning: 3, night: 3, total: 6 });
  });

  test('all Skip produces zero plates', () => {
    const skipping = statuses('skip', 'skip', 'skip');
    assert.deepEqual(getPlateCounts(meals(skipping, skipping)), { morning: 0, night: 0, total: 0 });
  });

  test('mixed statuses update directly from the server-confirmed meal state', () => {
    const before = meals(
      statuses('taking', 'skip', 'taking'),
      statuses('taking', 'skip', 'skip'),
    );
    const after = { ...before, night: { ...before.night, nikhil: 'taking' } };
    assert.deepEqual(getPlateCounts(before), { morning: 2, night: 1, total: 3 });
    assert.deepEqual(getPlateCounts(after), { morning: 2, night: 2, total: 4 });
  });

  test('plate wording is singular only for one', () => {
    assert.equal(formatPlateCount(1), '1 plate');
    assert.equal(formatPlateCount(2), '2 plates');
  });
});
