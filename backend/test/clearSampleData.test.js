import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clearSampleData,
  ALLOWED_CLEAR_COLLECTIONS,
  PRESERVED_AUTH_COLLECTIONS,
} from '../scripts/clearSampleData.js';

function createMockDb(initialData = {}) {
  const store = structuredClone(initialData);

  return {
    databaseName: 'mealkhata-test-mock',
    store,
    listCollections: () => ({
      toArray: async () => Object.keys(store).map((name) => ({ name })),
    }),
    collection: (name) => ({
      countDocuments: async () => store[name]?.length ?? 0,
      deleteMany: async () => {
        const deleted = store[name]?.length ?? 0;
        store[name] = [];
        return { deletedCount: deleted };
      },
    }),
  };
}

describe('Operational Sample Data Cleanup Safety Unit Tests', () => {
  const sampleData = {
    user_accounts: [
      { userId: 'u1', email: 'gaurav@mealkhata.local', role: 'member' },
      { userId: 'u2', email: 'nikhil@mealkhata.local', role: 'member' },
      { userId: 'u3', email: 'devansh@mealkhata.local', role: 'member' },
      { userId: 'u4', email: 'admin@mealkhata.local', role: 'admin' },
      { userId: 'u5', email: 'superadmin@mealkhata.local', role: 'superadmin' },
    ],
    member_accounts: [
      { memberId: 'gaurav', email: 'gaurav@mealkhata.local' },
      { memberId: 'nikhil', email: 'nikhil@mealkhata.local' },
      { memberId: 'devansh', email: 'devansh@mealkhata.local' },
    ],
    meal_days: [{ date: '2026-10-01' }, { date: '2026-10-02' }],
    payments: [{ id: 'p1', amountPaise: 5000 }],
    monthly_settlements: [{ month: '2026-09' }],
    monthly_meal_rates: [{ month: '2026-10' }],
    payment_settings: [{ key: 'default' }],
    reminder_settings: [{ key: 'default' }],
    push_subscriptions: [{ endpoint: 'https://push1' }],
    push_deliveries: [{ id: 'd1' }],
  };

  test('dry-run deletes zero documents across all collections', async () => {
    const mockDb = createMockDb(sampleData);
    const result = await clearSampleData({
      db: mockDb,
      dryRun: true,
      confirm: 'DELETE_SAMPLE_DATA',
    });

    assert.equal(result.dryRun, true);
    assert.equal(mockDb.store.user_accounts.length, 5);
    assert.equal(mockDb.store.member_accounts.length, 3);
    assert.equal(mockDb.store.meal_days.length, 2);
    assert.equal(mockDb.store.payments.length, 1);
  });

  test('missing or wrong confirmation deletes zero documents and remains in dry-run', async () => {
    const mockDb = createMockDb(sampleData);
    const result = await clearSampleData({
      db: mockDb,
      dryRun: false,
      confirm: 'WRONG_CONFIRMATION_STRING',
    });

    assert.equal(result.confirmed, false);
    assert.equal(result.dryRun, true);
    assert.equal(mockDb.store.meal_days.length, 2);
    assert.equal(mockDb.store.payments.length, 1);
  });

  test('production environment refuses deletion without ALLOW_PRODUCTION_DATA_RESET=true', async () => {
    const mockDb = createMockDb(sampleData);
    await assert.rejects(
      () =>
        clearSampleData({
          db: mockDb,
          dryRun: false,
          confirm: 'DELETE_SAMPLE_DATA',
          nodeEnv: 'production',
          allowProductionReset: false,
        }),
      /Refusing to clear production data without ALLOW_PRODUCTION_DATA_RESET=true/,
    );
  });

  test('abort operation if unknown collections are detected', async () => {
    const dataWithUnknown = {
      ...sampleData,
      unauthorized_secret_collection: [{ secret: 123 }],
    };
    const mockDb = createMockDb(dataWithUnknown);

    await assert.rejects(
      () =>
        clearSampleData({
          db: mockDb,
          dryRun: true,
          confirm: 'DELETE_SAMPLE_DATA',
        }),
      /Unknown collection\(s\) detected: unauthorized_secret_collection/,
    );
  });

  test('correct confirmation clears only allowlisted collections and preserves auth accounts intact', async () => {
    const mockDb = createMockDb(sampleData);
    const result = await clearSampleData({
      db: mockDb,
      dryRun: false,
      confirm: 'DELETE_SAMPLE_DATA',
      nodeEnv: 'development',
    });

    assert.equal(result.dryRun, false);
    assert.equal(result.confirmed, true);

    assert.deepEqual(PRESERVED_AUTH_COLLECTIONS, ['user_accounts', 'member_accounts']);
    assert.equal(mockDb.store.user_accounts.length, 5, 'user_accounts must be preserved');
    assert.equal(mockDb.store.member_accounts.length, 3, 'member_accounts must be preserved');

    // Operational cleared
    for (const col of ALLOWED_CLEAR_COLLECTIONS) {
      assert.equal(mockDb.store[col].length, 0, `${col} must be completely cleared`);
    }

    // Verify audit record types
    const userAudit = result.audit.find((a) => a.collection === 'user_accounts');
    assert.equal(userAudit.action, 'PRESERVE');
    assert.equal(userAudit.beforeCount, 5);
    assert.equal(userAudit.afterCount, 5);

    const mealAudit = result.audit.find((a) => a.collection === 'meal_days');
    assert.equal(mealAudit.action, 'CLEARED');
    assert.equal(mealAudit.beforeCount, 2);
    assert.equal(mealAudit.afterCount, 0);
  });
});
