import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { restoreDatabase } from '../src/backup/backupEngine.js';
import { assertDistinctDatabaseUris } from '../src/migrations/sourceInventory.service.js';
import { applyV3Migration, assertIsolatedMigrationTarget,
  assertIsolatedMigrationTargetUri, planV3Migration, replayFinalMealDelta,
  verifyV3Migration } from '../src/migrations/v3Migration.service.js';

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
  V3_TARGET_CLASSIFICATION   Must be isolated-test for this development tool
  V3_SUPERADMIN_EMAIL        Fresh login email (apply)
  V3_SUPERADMIN_PASSWORD     Fresh strong secret (apply)
  V3_RECOVERY_SUPERADMIN_EMAIL     Independent recovery login email (apply)
  V3_RECOVERY_SUPERADMIN_PASSWORD  Independent recovery secret (apply)

Use --snapshot-sidecar PATH when the source archive lacks legacy-v2 snapshots.
Use --stage pre-cutover|post-cutover with --verify. Final replay requires a
second encrypted frozen source archive, its manifest, and --write-free-confirmed.

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
  const snapshotSidecar = argument('--snapshot-sidecar')
    ? JSON.parse(await fs.readFile(argument('--snapshot-sidecar'), 'utf8')) : undefined;
  const common = { archive, encryptionKey, sourceManifest, snapshotSidecar };
  const plan = planV3Migration(common);
  if (modes[0] === '--dry-run') {
    console.info(JSON.stringify({ mode: 'dry-run', ...plan }, null, 2));
    return;
  }
  const targetUri = process.env.V3_TARGET_MONGODB_URI;
  const targetDbName = argument('--target-db');
  const targetClassification = process.env.V3_TARGET_CLASSIFICATION;
  if (!targetUri || !targetDbName || databaseFromUri(targetUri) !== targetDbName) {
    throw new Error('An explicit isolated target URI and matching --target-db are required');
  }
  assertIsolatedMigrationTargetUri(targetUri, targetClassification, plan.sourceDatabase);
  if (process.env.MONGODB_URI) assertDistinctDatabaseUris({ sourceUri: process.env.MONGODB_URI, targetUri });
  let target;
  let disposable;
  try {
    if (modes[0] === '--apply') {
      const restoreUri = process.env.V3_RESTORE_MONGODB_URI;
      if (!restoreUri || databaseFromUri(restoreUri) === targetDbName) {
        throw new Error('A distinct disposable restore URI is required before apply');
      }
      assertIsolatedMigrationTargetUri(restoreUri, targetClassification, plan.sourceDatabase);
      assertDistinctDatabaseUris({ sourceUri: restoreUri, targetUri });
      if (process.env.MONGODB_URI) assertDistinctDatabaseUris({ sourceUri: process.env.MONGODB_URI, targetUri: restoreUri });
      disposable = await mongoose.createConnection(restoreUri, { serverSelectionTimeoutMS: 10_000 }).asPromise();
      await assertIsolatedMigrationTarget({ targetConnection: disposable,
        targetDbName: disposable.db.databaseName, sourceDatabase: plan.sourceDatabase,
        targetClassification });
      const restored = await restoreDatabase({ backupPackageString: archive, encryptionKey,
        targetDbConnection: disposable });
      if (!restored.verification.passed || restored.manifest.sha256Checksum !== plan.sourceChecksum) {
        throw new Error('Disposable archive restore verification failed');
      }
    }
    target = await mongoose.createConnection(targetUri, { serverSelectionTimeoutMS: 10_000 }).asPromise();
    await assertIsolatedMigrationTarget({ targetConnection: target,
      targetDbName, sourceDatabase: plan.sourceDatabase, targetClassification });
    let result;
    if (modes[0] === '--verify') {
      const finalArchive = argument('--final-archive')
        ? await fs.readFile(argument('--final-archive'), 'utf8') : undefined;
      const finalSourceManifest = argument('--final-manifest')
        ? JSON.parse(await fs.readFile(argument('--final-manifest'), 'utf8')) : undefined;
      const finalSnapshotSidecar = argument('--final-snapshot-sidecar')
        ? JSON.parse(await fs.readFile(argument('--final-snapshot-sidecar'), 'utf8')) : undefined;
      result = await verifyV3Migration({ ...common, finalArchive, finalSourceManifest,
        finalSnapshotSidecar, targetConnection: target,
        targetClassification,
        verificationStage: argument('--stage') ?? 'pre-cutover' });
    } else if (modes[0] === '--replay-delta') {
      if (!argument('--final-archive') || !argument('--final-manifest') || !process.argv.includes('--write-free-confirmed')) {
        throw new Error('Final replay requires a frozen source archive, manifest and write-free confirmation');
      }
      const finalArchive = await fs.readFile(argument('--final-archive'), 'utf8');
      const finalSourceManifest = JSON.parse(await fs.readFile(argument('--final-manifest'), 'utf8'));
      const finalSnapshotSidecar = argument('--final-snapshot-sidecar')
        ? JSON.parse(await fs.readFile(argument('--final-snapshot-sidecar'), 'utf8')) : undefined;
      result = await replayFinalMealDelta({ ...common, targetConnection: target,
        targetClassification, finalArchive, finalSourceManifest, finalSnapshotSidecar,
        sourceWritesStopped: true });
    } else {
      result = await applyV3Migration({ ...common, targetConnection: target,
        targetDbName, targetClassification,
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
