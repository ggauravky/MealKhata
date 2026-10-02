import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';

export const ALLOWED_CLEAR_COLLECTIONS = Object.freeze([
  'meal_days',
  'payments',
  'monthly_settlements',
  'monthly_meal_rates',
  'payment_settings',
  'reminder_settings',
  'push_subscriptions',
  'push_deliveries',
]);

export const PRESERVED_AUTH_COLLECTIONS = Object.freeze([
  'user_accounts',
  'member_accounts',
]);

export async function clearSampleData({
  db,
  confirm = '',
  dryRun = true,
  allowProductionReset = false,
  nodeEnv = process.env.NODE_ENV || 'development',
} = {}) {
  if (!db) {
    throw new Error('Database handle (db) is required.');
  }

  // Double confirmation guard for production environments
  if (nodeEnv === 'production' && !dryRun) {
    if (!allowProductionReset) {
      throw new Error(
        'Refusing to clear production data without ALLOW_PRODUCTION_DATA_RESET=true in environment.',
      );
    }
  }

  const isConfirmed = confirm === 'DELETE_SAMPLE_DATA';
  const effectiveDryRun = dryRun || !isConfirmed;

  // 1. Discover all collections in the database
  const collectionInfos = await db.listCollections().toArray();
  const existingNames = collectionInfos.map((c) => c.name);

  // Check for any unknown collections
  const knownCollections = new Set([...ALLOWED_CLEAR_COLLECTIONS, ...PRESERVED_AUTH_COLLECTIONS]);
  const unknownCollections = existingNames.filter(
    (name) => !knownCollections.has(name) && !name.startsWith('system.'),
  );

  if (unknownCollections.length > 0) {
    throw new Error(
      `Unknown collection(s) detected: ${unknownCollections.join(', ')}. ` +
        'Operation aborted to protect unknown data.',
    );
  }

  const audit = [];

  // 2. Process PRESERVED collections first (read counts only)
  for (const name of PRESERVED_AUTH_COLLECTIONS) {
    if (existingNames.includes(name)) {
      const count = await db.collection(name).countDocuments();
      audit.push({
        collection: name,
        action: 'PRESERVE',
        beforeCount: count,
        afterCount: count,
      });
    }
  }

  // 3. Process CLEAR collections
  for (const name of ALLOWED_CLEAR_COLLECTIONS) {
    if (existingNames.includes(name)) {
      const beforeCount = await db.collection(name).countDocuments();
      let afterCount = beforeCount;

      if (!effectiveDryRun) {
        await db.collection(name).deleteMany({});
        afterCount = await db.collection(name).countDocuments();
        if (afterCount !== 0) {
          throw new Error(`Failed to completely clear ${name}: ${afterCount} documents remaining.`);
        }
      }

      audit.push({
        collection: name,
        action: effectiveDryRun ? 'DRY-RUN (WOULD CLEAR)' : 'CLEARED',
        beforeCount,
        afterCount,
      });
    }
  }

  // 4. Post-cleanup verification of user_accounts
  if (existingNames.includes('user_accounts')) {
    const postUserCount = await db.collection('user_accounts').countDocuments();
    if (postUserCount === 0) {
      throw new Error('FATAL: user_accounts was cleared or is empty! Verification failed.');
    }
  }

  return {
    dryRun: effectiveDryRun,
    confirmed: isConfirmed,
    audit,
  };
}

// CLI Runner
if (process.argv[1]?.endsWith('clearSampleData.js')) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || !args.includes('DELETE_SAMPLE_DATA');
  const confirmArgIdx = args.indexOf('--confirm');
  const confirmValue = confirmArgIdx !== -1 ? args[confirmArgIdx + 1] : '';
  const allowProd = process.env.ALLOW_PRODUCTION_DATA_RESET === 'true';

  console.info('========================================================');
  console.info('       MealKhata Operational Sample Data Cleanup        ');
  console.info('========================================================\n');

  if (isDryRun) {
    console.info('MODE: DRY-RUN (No documents will be deleted)\n');
  } else {
    console.warn('MODE: LIVE DESTRUCTION (Approved operational collections will be cleared!)\n');
  }

  try {
    console.info('Connecting to MongoDB...');
    await connectDatabase();
    const db = mongoose.connection.db;

    // Print safe target metadata
    console.info(`  Database Name: ${db.databaseName}`);
    console.info(`  Environment: ${env.nodeEnv}\n`);

    const result = await clearSampleData({
      db,
      confirm: confirmValue,
      dryRun: isDryRun,
      allowProductionReset: allowProd,
      nodeEnv: env.nodeEnv,
    });

    console.info('--- Collection Cleanup Audit ---');
    for (const item of result.audit) {
      if (item.action === 'PRESERVE') {
        console.info(`  ✓ ${item.collection.padEnd(24)}: ${item.beforeCount} -> ${item.afterCount} (PRESERVED)`);
      } else if (result.dryRun) {
        console.info(`  [DRY-RUN] ${item.collection.padEnd(16)}: ${item.beforeCount} documents would be cleared`);
      } else {
        console.info(`  ✓ ${item.collection.padEnd(24)}: ${item.beforeCount} -> ${item.afterCount} (CLEARED)`);
      }
    }
    console.info('--------------------------------\n');

    if (result.dryRun) {
      console.info('Dry-run completed safely. To execute live cleanup, run:');
      console.info('  npm run db:clear-sample -- --confirm DELETE_SAMPLE_DATA\n');
    } else {
      console.info('Live operational data cleanup completed successfully.\n');
    }

    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    console.error(`\nCleanup failed: ${error.message}\n`);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  }
}
