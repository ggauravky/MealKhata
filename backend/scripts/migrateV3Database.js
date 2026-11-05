import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { restoreDatabase } from '../src/backup/backupEngine.js';
import { assertDistinctDatabaseUris } from '../src/migrations/sourceInventory.service.js';
import { applyV3Migration, planV3Migration, replayFinalMealDelta, verifyV3Migration } from '../src/migrations/v3Migration.service.js';

function argument(flag) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1];
}

function databaseFromUri(uri) {
  try { return decodeURIComponent(new URL(uri).pathname.replace(/^\//, '')); }
  catch { throw new Error('Invalid target database URI'); }
}

async function run() {
  if (process.argv.includes('--help')) {
    console.info(`Verified blue-green v3 migration. No production migration runs automatically.

Usage: npm run migrate:v3 -- --dry-run|--verify|--apply|--replay-delta --archive PATH --manifest PATH [--target-db NAME]

Protected environment inputs:
  BACKUP_ENCRYPTION_KEY       Archive decryption secret
  V3_TARGET_MONGODB_URI      Explicit isolated target URI (verify/apply)
  V3_RESTORE_MONGODB_URI     Empty disposable restore URI (apply)
  V3_SUPERADMIN_EMAIL        Fresh login email (apply)
  V3_SUPERADMIN_PASSWORD     Fresh strong secret (apply)
  V3_RECOVERY_SUPERADMIN_EMAIL     Independent recovery login email (apply)
  V3_RECOVERY_SUPERADMIN_PASSWORD  Independent recovery secret (apply)

--apply restores and verifies the complete source archive into an empty disposable
database before writing the empty v3 target. No source database is modified.
Use --report PATH to write the machine-readable migration/rollback report.`);
    return;
  }
  const modes = ['--dry-run', '--verify', '--apply', '--replay-delta'].filter(flag => process.argv.includes(flag));
  if (modes.length !== 1) throw new Error('Select exactly one migration mode');
  const archivePath = argument('--archive');
  const manifestPath = argument('--manifest');
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (!archivePath || !manifestPath || !encryptionKey) throw new Error('Explicit archive, manifest and encryption key are required');
  const archive = await fs.readFile(archivePath, 'utf8');
  const sourceManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const plan = planV3Migration({ archive, encryptionKey, sourceManifest });
  if (modes[0] === '--dry-run') {
    console.info(JSON.stringify({ mode: 'dry-run', ...plan }, null, 2));
    return;
  }
  const targetUri = process.env.V3_TARGET_MONGODB_URI;
  const targetDbName = argument('--target-db');
  if (!targetUri || !targetDbName || databaseFromUri(targetUri) !== targetDbName
    || targetDbName === plan.sourceDatabase) {
    throw new Error('An explicit isolated target URI and matching --target-db are required');
  }
  if (process.env.MONGODB_URI) assertDistinctDatabaseUris({ sourceUri: process.env.MONGODB_URI, targetUri });
  let target;
  let disposable;
  try {
    if (modes[0] === '--apply') {
      const restoreUri = process.env.V3_RESTORE_MONGODB_URI;
      if (!restoreUri || databaseFromUri(restoreUri) === targetDbName
        || databaseFromUri(restoreUri) === plan.sourceDatabase
        || !/(?:^|[-_])(?:restore|drill|isolated|fixture|test)(?:[-_]|$)/i.test(databaseFromUri(restoreUri))) {
        throw new Error('A distinct disposable restore URI is required before apply');
      }
      assertDistinctDatabaseUris({ sourceUri: restoreUri, targetUri });
      if (process.env.MONGODB_URI) assertDistinctDatabaseUris({ sourceUri: process.env.MONGODB_URI, targetUri: restoreUri });
      disposable = await mongoose.createConnection(restoreUri, { serverSelectionTimeoutMS: 10_000 }).asPromise();
      const restored = await restoreDatabase({ backupPackageString: archive, encryptionKey,
        targetDbConnection: disposable });
      if (!restored.verification.passed || restored.manifest.sha256Checksum !== plan.sourceChecksum) {
        throw new Error('Disposable archive restore verification failed');
      }
    }
    target = await mongoose.createConnection(targetUri, { serverSelectionTimeoutMS: 10_000 }).asPromise();
    let result;
    if (modes[0] === '--verify') {
      result = await verifyV3Migration({ archive, encryptionKey, sourceManifest, targetConnection: target });
    } else if (modes[0] === '--replay-delta') {
      if (!argument('--delta-file') || !argument('--delta-checksum') || !process.argv.includes('--write-free-confirmed')) {
        throw new Error('Final delta replay requires --delta-file, --delta-checksum and --write-free-confirmed');
      }
      const deltaDocuments = JSON.parse(await fs.readFile(argument('--delta-file'), 'utf8'));
      result = await replayFinalMealDelta({ targetConnection: target, deltaDocuments,
        expectedSourceChecksum: plan.sourceChecksum,
        expectedDeltaChecksum: argument('--delta-checksum'), sourceWritesStopped: true });
    } else {
      result = await applyV3Migration({ archive, encryptionKey, sourceManifest,
        targetConnection: target, targetDbName,
        superAdmin: { email: process.env.V3_SUPERADMIN_EMAIL,
          password: process.env.V3_SUPERADMIN_PASSWORD },
        recoverySuperAdmin: { email: process.env.V3_RECOVERY_SUPERADMIN_EMAIL,
          password: process.env.V3_RECOVERY_SUPERADMIN_PASSWORD } });
    }
    const report = { mode: modes[0], sourceDatabase: plan.sourceDatabase,
      sourceChecksum: plan.sourceChecksum, targetDatabase: targetDbName, ...result };
    if (argument('--report')) await fs.writeFile(argument('--report'), JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
    console.info(JSON.stringify(report, null, 2));
    if (result.passed === false) process.exitCode = 1;
  } finally {
    await Promise.allSettled([target?.close(), disposable?.close()]);
  }
}

run().catch(() => {
  console.error('V3 migration failed; inspect the isolated target and migration checkpoint. Database credentials are not printed.');
  process.exitCode = 1;
});
