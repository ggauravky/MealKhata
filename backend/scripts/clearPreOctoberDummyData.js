import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';

export const TARGET_COLLECTIONS = Object.freeze([
  'meal_days',
  'payments',
  'monthly_settlements',
  'monthly_meal_rates',
]);

export const PROTECTED_MONTH = '2026-10';
export const PROTECTED_DATE_PREFIX = '2026-10';
export const CUTOFF_DATE = '2026-10-01';

export async function clearPreOctoberDummyData({
  db,
  confirm = '',
  dryRun = true,
} = {}) {
  if (!db) {
    throw new Error('Database handle (db) is required.');
  }

  const isConfirmed = confirm === 'DELETE_PRE_OCTOBER_DUMMY_DATA';
  const effectiveDryRun = dryRun || !isConfirmed;

  // 1. Snapshot October safe keys before any operation
  const octoberMealDatesBefore = (
    await db
      .collection('meal_days')
      .find({ date: { $regex: `^${PROTECTED_DATE_PREFIX}` } }, { projection: { date: 1, _id: 0 } })
      .toArray()
  )
    .map((d) => d.date)
    .sort();

  const octoberPaymentsBefore = (
    await db
      .collection('payments')
      .find({ month: PROTECTED_MONTH }, { projection: { paymentId: 1, _id: 0 } })
      .toArray()
  )
    .map((p) => p.paymentId)
    .sort();

  const octoberSettlementsBefore = (
    await db
      .collection('monthly_settlements')
      .find({ month: PROTECTED_MONTH }, { projection: { settlementId: 1, _id: 0 } })
      .toArray()
  )
    .map((s) => s.settlementId)
    .sort();

  const audit = [];

  for (const collectionName of TARGET_COLLECTIONS) {
    const coll = db.collection(collectionName);

    // Determine query strictly matching pre-October records
    const isDateField = collectionName === 'meal_days';
    const query = isDateField
      ? { date: { $lt: CUTOFF_DATE } }
      : { month: { $lt: PROTECTED_MONTH } };

    // Explicit safety assertion: Query MUST NOT match any October document
    if (isDateField) {
      const wouldTouchOct = await coll.countDocuments({
        $and: [query, { date: { $regex: `^${PROTECTED_DATE_PREFIX}` } }],
      });
      if (wouldTouchOct > 0) {
        throw new Error(
          `CRITICAL SAFETY ABORT: Query on ${collectionName} would match ${wouldTouchOct} October records!`,
        );
      }
    } else {
      const wouldTouchOct = await coll.countDocuments({
        $and: [query, { month: PROTECTED_MONTH }],
      });
      if (wouldTouchOct > 0) {
        throw new Error(
          `CRITICAL SAFETY ABORT: Query on ${collectionName} would match ${wouldTouchOct} October records!`,
        );
      }
    }

    const beforeTotal = await coll.countDocuments();
    const preOctCount = await coll.countDocuments(query);
    let deletedCount = 0;

    if (!effectiveDryRun && preOctCount > 0) {
      const deleteResult = await coll.deleteMany(query);
      deletedCount = deleteResult.deletedCount ?? 0;
    }

    const afterTotal = await coll.countDocuments();

    audit.push({
      collection: collectionName,
      action: effectiveDryRun ? 'DRY_RUN' : 'CLEANED',
      preOctoberCount: preOctCount,
      deletedCount: effectiveDryRun ? 0 : deletedCount,
      beforeTotal,
      afterTotal,
    });
  }

  // 2. October Safety Assertion: compare exact identifying keys after
  const octoberMealDatesAfter = (
    await db
      .collection('meal_days')
      .find({ date: { $regex: `^${PROTECTED_DATE_PREFIX}` } }, { projection: { date: 1, _id: 0 } })
      .toArray()
  )
    .map((d) => d.date)
    .sort();

  const octoberPaymentsAfter = (
    await db
      .collection('payments')
      .find({ month: PROTECTED_MONTH }, { projection: { paymentId: 1, _id: 0 } })
      .toArray()
  )
    .map((p) => p.paymentId)
    .sort();

  const octoberSettlementsAfter = (
    await db
      .collection('monthly_settlements')
      .find({ month: PROTECTED_MONTH }, { projection: { settlementId: 1, _id: 0 } })
      .toArray()
  )
    .map((s) => s.settlementId)
    .sort();

  if (JSON.stringify(octoberMealDatesBefore) !== JSON.stringify(octoberMealDatesAfter)) {
    throw new Error('FATAL: October meal_days were altered during pre-October cleanup! ABORTING.');
  }

  if (JSON.stringify(octoberPaymentsBefore) !== JSON.stringify(octoberPaymentsAfter)) {
    throw new Error('FATAL: October payments were altered during pre-October cleanup! ABORTING.');
  }

  if (JSON.stringify(octoberSettlementsBefore) !== JSON.stringify(octoberSettlementsAfter)) {
    throw new Error('FATAL: October settlements were altered during pre-October cleanup! ABORTING.');
  }

  return {
    dryRun: effectiveDryRun,
    confirmed: isConfirmed,
    octoberIntegrity: {
      mealDaysCount: octoberMealDatesAfter.length,
      paymentsCount: octoberPaymentsAfter.length,
      settlementsCount: octoberSettlementsAfter.length,
    },
    audit,
  };
}

// CLI Runner
if (process.argv[1]?.endsWith('clearPreOctoberDummyData.js')) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || !args.includes('DELETE_PRE_OCTOBER_DUMMY_DATA');
  const confirmArgIdx = args.indexOf('--confirm');
  const confirmValue = confirmArgIdx !== -1 ? args[confirmArgIdx + 1] : '';

  console.info('========================================================');
  console.info('       MealKhata Pre-October Dummy Data Cleanup         ');
  console.info('========================================================\n');

  if (isDryRun) {
    console.info('MODE: DRY-RUN (No documents will be deleted)\n');
  } else {
    console.warn('MODE: LIVE CLEANUP (Pre-October sample records will be deleted)\n');
  }

  try {
    console.info('Connecting to MongoDB...');
    await connectDatabase();
    const db = mongoose.connection.db;

    console.info(`  Database Name: ${db.databaseName}`);
    console.info(`  Environment: ${env.nodeEnv}\n`);

    const result = await clearPreOctoberDummyData({
      db,
      confirm: confirmValue,
      dryRun: isDryRun,
    });

    console.info('--- Collection Cleanup Audit ---');
    for (const item of result.audit) {
      if (result.dryRun) {
        console.info(
          `  [DRY-RUN] ${item.collection.padEnd(22)}: ${item.preOctoberCount} pre-October docs found (Total: ${item.beforeTotal})`,
        );
      } else {
        console.info(
          `  ✓ ${item.collection.padEnd(22)}: deleted ${item.deletedCount} (Remaining: ${item.afterTotal})`,
        );
      }
    }
    console.info('--------------------------------\n');

    console.info('--- October Protection Verification ---');
    console.info(`  ✓ October meal_days:    ${result.octoberIntegrity.mealDaysCount} (UNCHANGED)`);
    console.info(`  ✓ October payments:     ${result.octoberIntegrity.paymentsCount} (UNCHANGED)`);
    console.info(`  ✓ October settlements:  ${result.octoberIntegrity.settlementsCount} (UNCHANGED)`);
    console.info('---------------------------------------\n');

    if (result.dryRun) {
      console.info('Dry-run completed safely. To execute live cleanup, run:');
      console.info('  npm run db:clear-pre-october -- --confirm DELETE_PRE_OCTOBER_DUMMY_DATA\n');
    } else {
      console.info('Pre-October cleanup completed successfully with full October preservation.\n');
    }

    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    console.error(`\nCleanup failed: ${error.message}\n`);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  }
}
