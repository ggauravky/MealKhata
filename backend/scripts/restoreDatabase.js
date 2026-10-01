import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { restoreDatabase } from '../src/backup/backupEngine.js';
import { verifyDataIntegrity } from './verifyData.js';

async function run() {
  const filePath = process.argv[2];
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  const restoreUri = process.env.RESTORE_MONGODB_URI?.trim();
  const dropExisting = process.argv.includes('--drop');
  const confirmOverwrite = process.argv.includes('--confirm-overwrite-production');

  if (!filePath) {
    console.error('Usage: npm run db:restore -- <path-to-backup-file> [--drop] [--confirm-overwrite-production]');
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

  // Accidental production overwrite protection
  if (env.mongoUri && restoreUri === env.mongoUri && !confirmOverwrite) {
    console.error('DANGER: RESTORE_MONGODB_URI matches production MONGODB_URI.');
    console.error('To prevent accidental production database overwrite, you must explicitly supply the flag:');
    console.error('  --confirm-overwrite-production');
    process.exit(1);
  }

  console.info(`Reading backup file: ${filePath}`);
  const backupPackageString = await fs.readFile(filePath, 'utf8');

  console.info(`Connecting to target restore database at: ${restoreUri}`);
  const targetConnection = await mongoose.createConnection(restoreUri, {
    serverSelectionTimeoutMS: 10_000,
  }).asPromise();

  try {
    console.info(`Restoring database (dropExisting: ${dropExisting})...`);
    const { manifest, restoredCounts } = await restoreDatabase({
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
  console.error(`\n✗ Restoration failed: ${error.message}`);
  process.exit(1);
});
