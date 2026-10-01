import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { MealDay } from '../src/meals/meal.model.js';
import { MonthlyMealRate } from '../src/billing/monthlyRate.model.js';
import { Payment } from '../src/payments/payment.model.js';
import { PaymentSettings } from '../src/payments/paymentSettings.model.js';
import { MonthlySettlement } from '../src/settlement/monthlySettlement.model.js';
import { MemberAccount } from '../src/auth/memberAccount.model.js';
import { ReminderSettings } from '../src/settings/reminderSettings.model.js';
import { PushSubscription } from '../src/push/pushSubscription.model.js';
import { PushDelivery } from '../src/push/pushDelivery.model.js';

export const MONITORED_MODELS = [
  MealDay,
  MonthlyMealRate,
  Payment,
  PaymentSettings,
  MonthlySettlement,
  MemberAccount,
  ReminderSettings,
  PushSubscription,
  PushDelivery,
];

function normalizeIndexKey(keyObj) {
  return Object.entries(keyObj)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}

export async function verifyIndexes(dbConnection = mongoose.connection) {
  const results = [];
  let allPassed = true;

  for (const model of MONITORED_MODELS) {
    const collectionName = model.collection.name;
    const modelName = model.modelName;

    // Get expected indexes defined on the schema
    const schemaIndexes = model.schema.indexes();
    // Also include indexes defined directly on schema fields (unique/index: true)
    const expectedKeys = new Set();

    // Default _id index is always expected
    expectedKeys.add('_id:1');

    for (const [keyPattern] of schemaIndexes) {
      expectedKeys.add(normalizeIndexKey(keyPattern));
    }

    for (const [path, schemaType] of Object.entries(model.schema.paths)) {
      if (schemaType._index || schemaType.options?.unique || schemaType.options?.index) {
        expectedKeys.add(`${path}:1`);
      }
    }

    let actualIndexes = [];
    let collectionExists = true;

    try {
      actualIndexes = await dbConnection.db.collection(collectionName).indexes();
    } catch {
      collectionExists = false;
    }

    const actualKeys = new Set(actualIndexes.map((idx) => normalizeIndexKey(idx.key)));

    const missing = [];
    for (const exp of expectedKeys) {
      if (!actualKeys.has(exp)) {
        missing.push(exp);
      }
    }

    const status = !collectionExists
      ? 'EMPTY_OR_UNINITIALIZED'
      : missing.length === 0
        ? 'PASS'
        : 'FAIL';

    if (status === 'FAIL') {
      allPassed = false;
    }

    results.push({
      model: modelName,
      collection: collectionName,
      status,
      expectedCount: expectedKeys.size,
      actualCount: actualIndexes.length,
      missing,
    });
  }

  return { passed: allPassed, results };
}

// Direct CLI execution
if (process.argv[1] && process.argv[1].endsWith('verifyIndexes.js')) {
  if (!env.mongoUri) {
    console.error('ERROR: MONGODB_URI is required to run index verification.');
    process.exit(1);
  }

  console.info('Connecting to MongoDB to verify critical indexes...');
  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000 });
    const { passed, results } = await verifyIndexes(mongoose.connection);

    console.info('\n--- Index Verification Report ---');
    for (const r of results) {
      const mark = r.status === 'PASS' ? '✓' : r.status === 'EMPTY_OR_UNINITIALIZED' ? '○' : '✗';
      console.info(`${mark} [${r.status}] ${r.model} (${r.collection}): ${r.actualCount}/${r.expectedCount} indexes`);
      if (r.missing.length > 0) {
        console.warn(`   Missing indexes: ${r.missing.join(', ')}`);
      }
    }
    console.info('---------------------------------\n');

    await mongoose.disconnect();
    if (!passed) {
      console.error('Index verification failed: missing critical indexes.');
      process.exit(1);
    }
    console.info('All database indexes verified successfully.');
    process.exit(0);
  } catch (error) {
    console.error(`Index verification error: ${error.message}`);
    process.exit(1);
  }
}
