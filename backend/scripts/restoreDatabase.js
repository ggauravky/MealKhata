import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { restoreDatabase, verifyAndDecryptBackup } from '../src/backup/backupEngine.js';
import { assertDistinctDatabaseUris } from '../src/migrations/sourceInventory.service.js';
import { verifyDataIntegrity } from './verifyData.js';

export function redactMongoUri(value) {
  return String(value).replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[redacted MongoDB URI]');
}

export function assertDisposableRestoreUri(uri, sourceDatabase) {
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error('Invalid restore target URI'); }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !database
    || !/(?:^|[-_])(?:restore|drill|isolated|fixture|test)(?:[-_]|$)/i.test(database)
    || database === sourceDatabase) {
    throw new Error('Restore target must be an explicit disposable database distinct from source');
  }
  return database;
}

async function run() {
  if (process.argv.includes('--help')) {
    console.info(`Restore into an explicit disposable database and verify it.

Usage: npm run db:restore -- <path-to-backup-file> [--drop]

Required environment:
  BACKUP_ENCRYPTION_KEY   Secret used to create the archive
  RESTORE_MONGODB_URI     Explicit isolated restore target

The command refuses a target matching MONGODB_URI. --drop permits clearing only
the explicitly supplied restore target; production override flags are unsupported.`);
    return;
  }

  const filePath = process.argv[2];
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  const restoreUri = process.env.RESTORE_MONGODB_URI?.trim();
  const dropExisting = process.argv.includes('--drop');

  if (!filePath) {
    console.error('Usage: npm run db:restore -- <path-to-backup-file> [--drop]');
    process.exit(1);
  }

  if (!encryptionKey) {
    console.error('ERROR: BACKUP_ENCRYPTION_KEY environment variable is required to restore.');
    process.exit(1);
  }

  if (!restoreUri) {
    console.error('ERROR: RESTORE_MONGODB_URI environment variable is required.');
    console.error('To protect production, restoration must target an explicitly defined restoration database.');
    console.error('Example: RESTORE_MONGODB_URI="mongodb://localhost:27017/mealkhata-restore-drill" npm run db:restore -- backups/file.mealkhata-backup');
    process.exit(1);
  }

  try {
    assertDistinctDatabaseUris({ sourceUri: env.mongoUri, targetUri: restoreUri });
    assertDisposableRestoreUri(restoreUri, env.mongoUri ? decodeURIComponent(new URL(env.mongoUri).pathname.replace(/^\//, '')) : null);
  } catch (error) {
    console.error(`DANGER: ${redactMongoUri(error.message)}.`);
    console.error('Choose a separate disposable RESTORE_MONGODB_URI. Production override flags are not supported.');
    process.exit(1);
  }

  console.info('Reading encrypted backup file...');
  const backupPackageString = await fs.readFile(filePath, 'utf8');
  const { manifest: archiveManifest } = verifyAndDecryptBackup({ backupPackageString, encryptionKey });
  assertDisposableRestoreUri(restoreUri, archiveManifest.sourceDatabase);

  console.info('Connecting to verified disposable restore target...');
  const targetConnection = await mongoose.createConnection(restoreUri, {
    serverSelectionTimeoutMS: 10_000,
  }).asPromise();

  try {
    console.info(`Restoring database (dropExisting: ${dropExisting})...`);
    const { manifest, restoredCounts, verification } = await restoreDatabase({
      backupPackageString,
      encryptionKey,
      targetDbConnection: targetConnection,
      dropExisting,
    });

    console.info('\n✓ Restore completed successfully!');
    console.info(`  Backup Created: ${manifest.createdAt}`);
    console.info('\n  Restored Collections:');
    for (const [col, count] of Object.entries(restoredCounts)) {
      console.info(`    - ${col}: ${count} records`);
    }
    console.info(`\n✓ Archive manifest verification PASSED (${verification.targetInventory.collectionOrder.length} collections).`);

    console.info('\nRunning post-restore data integrity audit on target database...');
    const { passed, checks, issues } = await verifyDataIntegrity(targetConnection);

    for (const c of checks) {
      const mark = c.status === 'PASS' ? '✓' : '✗';
      console.info(`  ${mark} [${c.status}] ${c.name}: ${c.recordsChecked ?? 0} records (${c.issues} issues)`);
    }

    if (!passed) {
      console.error('\nWARNING: Post-restore data integrity check identified issues:');
      for (const iss of issues) {
        console.warn(`    - ${iss}`);
      }
      process.exit(1);
    }

    console.info('\n✓ Post-restore integrity verification PASSED!\n');
  } finally {
    await targetConnection.close();
  }
}

run().catch((error) => {
  console.error(`\n✗ Restoration failed: ${redactMongoUri(error.message)}`);
  process.exit(1);
});
