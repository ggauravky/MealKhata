import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createEncryptedBackup, restoreDatabase } from '../src/backup/backupEngine.js';
import { createAuthService } from '../src/auth/auth.service.js';
import { createSessionToken, verifySessionToken } from '../src/auth/token.service.js';
import { verifyDataIntegrity } from '../scripts/verifyData.js';
import { verifyIndexes } from '../scripts/verifyIndexes.js';
import { buildLegacyMealSnapshot } from '../src/migrations/legacyMealSnapshot.service.js';
import { createHistoricalMealCorrectionService } from '../src/meals/mealHistoricalCorrection.service.js';
import { checksumValue, discoverSourceInventory } from '../src/migrations/sourceInventory.service.js';
import { createLegacySnapshotSidecar } from '../src/migrations/v3SnapshotSidecar.service.js';
import { auditV3OperationalFinances } from '../src/migrations/v3OperationalFinanceAudit.service.js';
import { buildV3RollbackWriteRegister } from '../src/migrations/production/v3RollbackRegister.service.js';
import { createReadOnlyMealBaselineReaders } from '../src/migrations/v3ArchiveBaselines.service.js';
import { serializeLegacyMealSnapshot, serializeMealDay } from '../src/meals/meal.serializer.js';
import { isOperationalMealDayForBoundary } from '../src/finance/financialBoundary.service.js';
import {
  applyV3Migration,
  assertIsolatedMigrationTargetUri,
  planV3Migration,
  replayFinalMealDelta,
  verifyV3Migration,
} from '../src/migrations/v3Migration.service.js';

const key = 'isolated-v3-migration-archive-secret';
const ids = ['gaurav', 'nikhil', 'devansh', 'fourth_student'];
const email = 'new-superadmin@isolated.test';
const password = 'isolated-test-password-only-51!';
const recoverySuperAdmin = { email: 'recovery@isolated.test', password: 'different-isolated-recovery-secret-42!' };
const date = '2026-10-05';
const backendDir = fileURLToPath(new URL('..', import.meta.url));

describe('v3 blue-green migration in isolated replica set', () => {
  let replSet;
  let source;
  let target;
  let archive;
  let manifest;

  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const uri = replSet.getUri();
    source = await mongoose.createConnection(uri, { dbName: 'mealkhata_v3_migration_source' }).asPromise();
    target = await mongoose.createConnection(uri, { dbName: 'mealkhata_v3_migration_target' }).asPromise();
    await source.db.collection('students').insertMany(ids.map((studentId, rosterOrder) => ({
      studentId, displayName: studentId, status: 'ACTIVE', rosterOrder,
      mealEligibilityFrom: null, mealEligibilityUntil: null,
    })));
    const legacyDay = { date: '2026-09-30', meals: { morning: { gaurav: 'taking' }, night: {} }, revision: 2,
      changes: [], allocationChanges: [], priceChanges: [] };
    await source.db.collection('meal_days').insertMany([
      legacyDay,
      { date, schemaVersion: 3, participantOrder: ids, revision: 1,
        meals: { morning: Object.fromEntries(ids.map(id => [id, 'taking'])), night: {} },
        allocations: { morning: { mode: 'custom', plates: ids.map(id => ({ shares: { [id]: 6 } })) } },
        priceOverrides: { morning: { pricePaise: 101, reason: 'fixture' } }, changes: [] },
    ]);
    await source.db.collection('monthly_meal_rates').insertOne({ month: '2026-10', morningPricePaise: 101, nightPricePaise: 200, revision: 1, changes: [] });
    await source.db.collection('payments').insertOne({ paymentId: randomUUID(), amountPaise: 9999, memberId: 'gaurav' });
    await source.db.collection('monthly_settlements').insertOne({ month: '2026-09', oldLiabilityPaise: 9999 });
    await source.db.collection('rooms').insertOne({ roomNumber: 'legacy-room' });
    await source.db.collection('hostel_stays').insertOne({ studentId: 'gaurav', oldDepositPaise: 50000 });
    await source.db.collection('expenses').insertOne({ oldExpensePaise: 1200 });
    await source.db.collection('user_accounts').insertOne({ email: 'old@isolated.test', passwordHash: 'legacy-secret' });
    await source.db.collection('member_accounts').insertOne({ memberId: 'gaurav',
      email: 'old-member@isolated.test', passwordHash: await bcrypt.hash('legacy-password-only-16!', 12) });
    const baseline = buildLegacyMealSnapshot(legacyDay);
    await source.db.collection('meal_history_snapshots').insertOne(baseline);
    const sourceState = { ...legacyDay, revision: 3, priceOverrides: { morning: { pricePaise: 101, reason: 'correction' } } };
    const snapshot = { ...buildLegacyMealSnapshot(sourceState), snapshotId: 'legacy-correction-v1:2026-09-30:3',
      calculationVersion: 'legacy-correction-v1' };
    await source.db.collection('meal_history_corrections').insertOne({ date: '2026-09-30', revision: 3, previousRevision: 2,
      originalSourceChecksum: baseline.sourceChecksum, snapshotChecksum: checksumValue(snapshot), sourceState,
      snapshot, operation: 'price', mealType: 'morning', actorRole: 'superadmin', reason: 'fixture correction', createdAt: new Date() });
    archive = (await createEncryptedBackup({ dbConnection: source, encryptionKey: key,
      baselineReaders: {
        readCalendarDay: async logicalDate => logicalDate === '2026-09-30'
          ? serializeLegacyMealSnapshot(snapshot)
          : serializeMealDay(await source.db.collection('meal_days').findOne({ date: logicalDate }), logicalDate),
        readMonthlyCostReport: async month => ({ month, historical: true }),
      },
    })).serializedPackage;
    manifest = JSON.parse(archive).manifest;
  });

  after(async () => {
    await Promise.allSettled([source?.close(), target?.close()]);
    await replSet?.stop();
  });

  test('plans only verified history and stable original plus fourth identities', () => {
    const plan = planV3Migration({ archive, encryptionKey: key, sourceManifest: manifest });
    assert.deepEqual(plan.studentIds, ids);
    assert.equal(plan.counts.meal_days, 2);
    assert.equal(plan.counts.payments, undefined);
    assert.equal(manifest.baselines.calendarDayCount, 2);
    assert.match(plan.sourceChecksum, /^[a-f0-9]{64}$/);
    assert.deepEqual(plan.excludedCollections.filter(name => ['payments', 'user_accounts'].includes(name)), ['payments', 'user_accounts']);
    assert.throws(() => planV3Migration({ archive, encryptionKey: key,
      sourceManifest: { ...manifest, sourceDatabase: 'different' } }), /manifest/i);
  });

  test('restores the complete encrypted archive into a disposable replica-set database', async () => {
    const disposable = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_restore_drill' }).asPromise();
    try {
      const result = await restoreDatabase({ backupPackageString: archive, encryptionKey: key,
        sourceDbConnection: source, targetDbConnection: disposable });
      assert.equal(result.verification.passed, true);
      assert.equal(result.manifest.sha256Checksum, manifest.sha256Checksum);
      assert.equal(await disposable.db.collection('payments').countDocuments(), 1);
      assert.equal(await disposable.db.collection('meal_days').countDocuments(), 2);
      await disposable.db.collection('foreign').insertOne({ keep: true });
      await assert.rejects(restoreDatabase({ backupPackageString: archive, encryptionKey: key,
        sourceDbConnection: source, targetDbConnection: disposable, dropExisting: true }), /unverified restore target/i);
      assert.equal(await disposable.db.collection('foreign').countDocuments(), 1);
    } finally { await disposable.close(); }
  });

  test('legacy source without student documents preserves original IDs without invented joining dates', async () => {
    const old = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_legacy_source' }).asPromise();
    const fresh = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_legacy_target' }).asPromise();
    try {
      const day = { date: '2026-09-01', revision: 0, meals: { morning: { gaurav: 'taking' }, night: {} },
        changes: [], allocationChanges: [], priceChanges: [] };
      await old.db.collection('meal_days').insertOne(day);
      await old.db.collection('meal_history_snapshots').insertOne(buildLegacyMealSnapshot(day));
      const oldArchive = (await createEncryptedBackup({ dbConnection: old, encryptionKey: key })).serializedPackage;
      const oldManifest = JSON.parse(oldArchive).manifest;
      const result = await applyV3Migration({ archive: oldArchive, encryptionKey: key,
        sourceManifest: oldManifest, targetConnection: fresh, targetDbName: fresh.db.databaseName, targetClassification: 'isolated-test',
        superAdmin: { email, password }, recoverySuperAdmin });
      assert.equal(result.verification.passed, true);
      const generated = await fresh.db.collection('students').find({}).sort({ rosterOrder: 1 }).toArray();
      assert.deepEqual(generated.map(student => student.studentId), ids.slice(0, 3));
      assert.ok(generated.every(student => student._id instanceof mongoose.Types.ObjectId
        && student.mealEligibilityFrom === null));
      assert.equal(await old.db.collection('students').countDocuments(), 0);
    } finally { await Promise.allSettled([old.close(), fresh.close()]); }
  });

  test('a read-only original v2 archive requires an authenticated snapshot sidecar', async () => {
    const old = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_original_v2_source' }).asPromise();
    try {
      await old.db.collection('meal_days').insertOne({ date: '2026-08-17', revision: 0,
        meals: { morning: { gaurav: 'taking' }, night: {} },
        changes: [], allocationChanges: [], priceChanges: [] });
      const monthlyBaseline = await createReadOnlyMealBaselineReaders(old.db)
        .readMonthlyCostReport('2026-08');
      assert.equal(monthlyBaseline.memberAmountsPaise.gaurav, 5000);
      assert.equal(monthlyBaseline.roomAmountPaise, 5000);
      assert.equal(monthlyBaseline.householdAmountPaise, 5000);
      const originalArchive = (await createEncryptedBackup({ dbConnection: old, encryptionKey: key,
        baselineReaders: createReadOnlyMealBaselineReaders(old.db) })).serializedPackage;
      const originalManifest = JSON.parse(originalArchive).manifest;
      assert.equal(originalManifest.baselines.calendarDayCount, 1);
      assert.equal(originalManifest.baselines.monthlyCostReportCount, 1);
      assert.throws(() => planV3Migration({ archive: originalArchive, encryptionKey: key,
        sourceManifest: originalManifest }), /snapshot/i);
      const snapshotSidecar = createLegacySnapshotSidecar({ archive: originalArchive,
        sourceManifest: originalManifest, encryptionKey: key });
      const sidecarDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mealkhata-v3-sidecar-'));
      try {
        const archivePath = path.join(sidecarDir, 'archive.json');
        const manifestPath = path.join(sidecarDir, 'manifest.json');
        const sidecarPath = path.join(sidecarDir, 'snapshots.json');
        await fs.writeFile(archivePath, originalArchive);
        await fs.writeFile(manifestPath, JSON.stringify(originalManifest));
        const captured = spawnSync(process.execPath, ['scripts/captureLegacyMealSnapshots.js',
          '--archive', archivePath, '--manifest', manifestPath, '--sidecar', sidecarPath],
        { cwd: backendDir, encoding: 'utf8', env: { ...process.env, BACKUP_ENCRYPTION_KEY: key } });
        assert.equal(captured.status, 0, captured.stderr);
        assert.deepEqual(JSON.parse(await fs.readFile(sidecarPath, 'utf8')), snapshotSidecar);
        const checked = spawnSync(process.execPath, ['scripts/captureLegacyMealSnapshots.js',
          '--archive', archivePath, '--manifest', manifestPath, '--sidecar', sidecarPath, '--verify'],
        { cwd: backendDir, encoding: 'utf8', env: { ...process.env, BACKUP_ENCRYPTION_KEY: key } });
        assert.equal(checked.status, 0, checked.stderr);
      } finally { await fs.rm(sidecarDir, { recursive: true, force: true }); }
      const plan = planV3Migration({ archive: originalArchive, sourceManifest: originalManifest,
        encryptionKey: key, snapshotSidecar });
      assert.equal(plan.counts.meal_history_snapshots, 1);
      assert.deepEqual(plan.studentIds, ids.slice(0, 3));
      assert.equal(await old.db.collection('meal_history_snapshots').countDocuments(), 0);
      assert.equal(await old.db.collection('students').countDocuments(), 0);
      assert.throws(() => planV3Migration({ archive: originalArchive, sourceManifest: originalManifest,
        encryptionKey: key, snapshotSidecar: { ...snapshotSidecar, archiveChecksum: '0'.repeat(64) } }), /sidecar|checksum/i);
    } finally { await old.close(); }
  });

  test('an authenticated archive with an invalid historical correction revision chain fails closed', async () => {
    const invalid = await mongoose.createConnection(replSet.getUri(),
      { dbName: 'mealkhata_v3_invalid_correction_source' }).asPromise();
    try {
      const day = await source.db.collection('meal_days').findOne({ date: '2026-09-30' });
      const snapshot = await source.db.collection('meal_history_snapshots').findOne({ date: day.date });
      const correction = await source.db.collection('meal_history_corrections').findOne({ date: day.date });
      await invalid.db.collection('meal_days').insertOne(day);
      await invalid.db.collection('meal_history_snapshots').insertOne(snapshot);
      await invalid.db.collection('meal_history_corrections').insertOne({ ...correction, previousRevision: 99 });
      const invalidArchive = (await createEncryptedBackup({ dbConnection: invalid,
        encryptionKey: key })).serializedPackage;
      assert.throws(() => planV3Migration({ archive: invalidArchive, encryptionKey: key,
        sourceManifest: JSON.parse(invalidArchive).manifest }), /revision chain/i);
    } finally { await invalid.close(); }
  });

  test('read-only monthly baseline matches the active fixed-price report while preserving stored rate metadata', async () => {
    const rated = await mongoose.createConnection(replSet.getUri(),
      { dbName: 'mealkhata_v3_rate_baseline_source' }).asPromise();
    try {
      await rated.db.collection('meal_days').insertOne({ date: '2026-08-03', schemaVersion: 3,
        participantOrder: ['gaurav'], revision: 0,
        meals: { morning: { gaurav: 'taking' }, night: { gaurav: 'not_set' } },
        allocations: { morning: null, night: null } });
      await rated.db.collection('monthly_meal_rates').insertOne({ month: '2026-08',
        morningPricePaise: 101, nightPricePaise: 200, revision: 0 });
      const baseline = await createReadOnlyMealBaselineReaders(rated.db).readMonthlyCostReport('2026-08');
      assert.equal(baseline.memberAmountsPaise.gaurav, 5000);
      assert.equal(baseline.roomAmountPaise, 5000);
      assert.equal(baseline.householdAmountPaise, 5000);
      assert.equal((await rated.db.collection('monthly_meal_rates').findOne({ month: '2026-08' })).morningPricePaise, 101);
    } finally { await rated.close(); }
  });

  test('post-cutover verification accepts fresh operational accounts and boundary', async () => {
    const post = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_post_cutover_target' }).asPromise();
    try {
      await applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: post, targetDbName: post.db.databaseName,
        targetClassification: 'isolated-test', superAdmin: { email, password }, recoverySuperAdmin });
      await post.db.collection('user_accounts').insertOne({ userId: randomUUID(), email: 'student@isolated.test',
        displayName: 'Student', role: 'member', memberId: 'fourth_student', active: true,
        passwordHash: await bcrypt.hash('another-isolated-password-42!', 12), sessionVersion: 0 });
      await post.db.collection('system_settings').updateOne({ settingsId: 'system' },
        { $set: { financialStartDate: '2026-11-01' } });
      assert.equal((await verifyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: post, verificationStage: 'pre-cutover' })).passed, false);
      const verified = await verifyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: post, verificationStage: 'post-cutover' });
      assert.equal(verified.passed, true, verified.issues.join('; '));
      const oldPaymentId = (await source.db.collection('payments').findOne({ memberId: 'gaurav' })).paymentId;
      const copiedIdentifier = await post.db.collection('payments').insertOne({
        paymentId: oldPaymentId, idempotencyKey: randomUUID(), memberId: 'gaurav',
        month: '2026-11', amountPaise: 100, status: 'recorded', voidedAt: null,
        voidReason: null, recordedAt: new Date('2026-11-02T12:00:00.000Z'),
      });
      const oldIdFailure = await verifyV3Migration({ archive, encryptionKey: key,
        sourceManifest: manifest, targetConnection: post, verificationStage: 'post-cutover' });
      assert.match(oldIdFailure.issues.join('; '), /old operational.*paymentId/i);
      await post.db.collection('payments').deleteOne({ _id: copiedIdentifier.insertedId });
      const preBoundaryReceipt = await post.db.collection('hostel_deposit_transactions').insertOne({
        depositTransactionId: 'pre-boundary-receipt', depositAccountId: 'missing-account',
        stayId: 'missing-stay', memberId: 'gaurav', type: 'RECEIVED', amountPaise: 100,
        status: 'recorded', recordedAt: new Date('2026-10-31T12:00:00.000Z'),
      });
      const receiptFailure = await verifyV3Migration({ archive, encryptionKey: key,
        sourceManifest: manifest, targetConnection: post, verificationStage: 'post-cutover' });
      assert.match(receiptFailure.issues.join('; '), /hostel_deposit_transactions pre-boundary-receipt.*pre-boundary/i);
      await post.db.collection('hostel_deposit_transactions').deleteOne({ _id: preBoundaryReceipt.insertedId });
      const preBoundaryExpense = await post.db.collection('expenses').insertOne({
        date: '2026-10-31', amountPaise: 100, paidByMemberId: 'gaurav',
      });
      const boundaryFailure = await verifyV3Migration({ archive, encryptionKey: key,
        sourceManifest: manifest, targetConnection: post, verificationStage: 'post-cutover' });
      assert.match(boundaryFailure.issues.join('; '), /expense.*financial start boundary/i);
      await post.db.collection('expenses').deleteOne({ _id: preBoundaryExpense.insertedId });
      await post.db.collection('system_settings').updateOne({ settingsId: 'system' },
        { $set: { financialStartDate: '2026-11-15' } });
      const partialMonthCharge = await post.db.collection('room_charges').insertOne({ month: '2026-11' });
      const partialFailure = await verifyV3Migration({ archive, encryptionKey: key,
        sourceManifest: manifest, targetConnection: post, verificationStage: 'post-cutover' });
      assert.match(partialFailure.issues.join('; '), /room_charges.*financial start boundary/i);
      await post.db.collection('room_charges').deleteOne({ _id: partialMonthCharge.insertedId });
      await post.db.collection('user_accounts').insertOne({ userId: randomUUID(), email: 'unsafe@isolated.test',
        displayName: 'Unsafe', role: 'owner', active: true,
        passwordHash: await bcrypt.hash('isolated-invalid-role-42!', 12), sessionVersion: 0 });
      const invalidRole = await verifyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: post, verificationStage: 'post-cutover' });
      assert.equal(invalidRole.passed, false);
      assert.match(invalidRole.issues.join('; '), /role|authorization|account/i);
    } finally { await post.close(); }
  });

  test('post-cutover verifier accepts an authorized appended correction while preserving frozen authority', async () => {
    const post = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_authorized_correction' }).asPromise();
    try {
      await applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: post, targetDbName: post.db.databaseName,
        targetClassification: 'isolated-test', superAdmin: { email, password }, recoverySuperAdmin });
      await post.db.collection('system_settings').updateOne({ settingsId: 'system' },
        { $set: { financialStartDate: '2026-11-01' } }); // Isolated fixture only.
      const originalDay = await post.db.collection('meal_days').findOne({ date: '2026-09-30' });
      const originalSnapshot = await post.db.collection('meal_history_snapshots').findOne({ date: '2026-09-30' });
      const corrections = post.db.collection('meal_history_corrections');
      const options = { archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: post, verificationStage: 'post-cutover' };
      const frozenVerification = await verifyV3Migration(options);
      assert.equal(frozenVerification.passed, true, frozenVerification.issues.join('; '));
      const service = createHistoricalMealCorrectionService({
        meals: { findByDate: date => post.db.collection('meal_days').findOne({ date }) },
        snapshots: { findByDateAndVersion: (date, calculationVersion) =>
          post.db.collection('meal_history_snapshots').findOne({ date, calculationVersion }) },
        corrections: {
          listByDate: date => corrections.find({ date }).sort({ revision: 1 }).toArray(),
          create: record => corrections.insertOne(record),
        },
      });
      const result = await service.correct({ date: '2026-09-30', expectedRevision: 3,
        operation: 'price', mealType: 'morning', pricePaise: 103,
        reason: 'Verified post-cutover correction', actorRole: 'superadmin' });
      assert.equal(result.revision, 4);
      assert.equal(result.dailyCostSummary.members.gaurav.morningAmountPaise, 103);
      assert.deepEqual(await post.db.collection('meal_days').findOne({ date: '2026-09-30' }), originalDay);
      assert.deepEqual(await post.db.collection('meal_history_snapshots').findOne({ date: '2026-09-30' }), originalSnapshot);
      const verified = await verifyV3Migration(options);
      assert.equal(verified.passed, true, verified.issues.join('; '));
      assert.notEqual(verified.currentHistoricalAuthorityChecksum,
        frozenVerification.currentHistoricalAuthorityChecksum);
      await corrections.updateOne({ date: '2026-09-30', revision: 4 },
        { $set: { actorRole: 'admin' } });
      const unauthorized = await verifyV3Migration(options);
      assert.equal(unauthorized.passed, false);
      assert.match(unauthorized.issues.join('; '), /authorized audit metadata/i);
      await corrections.updateOne({ date: '2026-09-30', revision: 4 },
        { $set: { actorRole: 'superadmin' } });
      await corrections.updateOne({ date: '2026-09-30', revision: 4 },
        { $inc: { 'snapshot.costs.morning.memberAmountsPaise.gaurav': 1 } });
      const tampered = await verifyV3Migration(options);
      assert.equal(tampered.passed, false);
      assert.match(tampered.issues.join('; '), /correction|paise|authority/i);
    } finally { await post.close(); }
  });

  test('isolated target classification and local cluster identity are mandatory', async () => {
    assert.equal(assertIsolatedMigrationTargetUri('mongodb://127.0.0.1:27017/mealkhata_test_target',
      'isolated-test', 'mealkhata_source'), 'mealkhata_test_target');
    assert.throws(() => assertIsolatedMigrationTargetUri('mongodb://127.0.0.1:27017/mealkhata_prod_target',
      'isolated-test', 'mealkhata_source'), /isolated-test|disposable/i);
    assert.throws(() => assertIsolatedMigrationTargetUri('mongodb+srv://cluster.example/mealkhata_v3_target',
      'isolated-test', 'mealkhata_source'), /isolated-test|disposable/i);
    assert.throws(() => assertIsolatedMigrationTargetUri('mongodb://127.0.0.1:27017/mealkhata_source',
      'isolated-test', 'mealkhata_source'), /isolated-test|disposable/i);
    const unsafe = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_unsafe_target' }).asPromise();
    try {
      const options = { archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: unsafe, targetDbName: unsafe.db.databaseName,
        superAdmin: { email, password }, recoverySuperAdmin };
      await assert.rejects(applyV3Migration(options), /isolated-test|classification/i);
      await assert.rejects(applyV3Migration({ ...options, targetClassification: 'production' }), /isolated-test|classification/i);
      assert.deepEqual(await unsafe.db.listCollections({}, { nameOnly: true }).toArray(), []);
    } finally { await unsafe.close(); }
  });

  test('applies history with exact paise, fresh credentials, and no inherited debt', async () => {
    const result = await applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
      targetConnection: target, targetDbName: target.db.databaseName, targetClassification: 'isolated-test', superAdmin: { email, password }, recoverySuperAdmin });
    assert.equal(result.status, 'complete');
    assert.equal(result.verification.passed, true);
    assert.equal(await target.db.collection('meal_days').countDocuments(), 2);
    assert.equal(await target.db.collection('payments').countDocuments(), 0);
    assert.equal(await target.db.collection('monthly_settlements').countDocuments(), 0);
    for (const collection of ['rooms', 'hostel_stays', 'expenses']) {
      assert.equal(await target.db.collection(collection).countDocuments(), 0);
    }
    assert.equal(await target.db.collection('user_accounts').countDocuments(), 2);
    assert.equal(await target.db.collection('system_settings').countDocuments({ financialStartDate: null }), 1);
    assert.deepEqual((await target.db.collection('students').find({}).sort({ rosterOrder: 1 }).toArray()).map(s => s.studentId), ids);
    const account = await target.db.collection('user_accounts').findOne({ email });
    assert.equal(account.role, 'superadmin');
    assert.equal(await bcrypt.compare(password, account.passwordHash), true);
    assert.notEqual(account.passwordHash, 'legacy-secret');
    assert.equal(result.rollback.sourceDatabase, source.db.databaseName);
    const imported = await target.db.collection('meal_days').findOne({ date });
    assert.equal(imported.importedFromLegacy, true);
    assert.equal(imported.financialClassification, 'historical');
    assert.equal(isOperationalMealDayForBoundary(imported, date), false);
    assert.equal(isOperationalMealDayForBoundary(imported, '2026-10-01'), false);
    const dataAudit = await verifyDataIntegrity(target);
    assert.equal(dataAudit.passed, true, dataAudit.issues.join('; '));
    assert.equal((await verifyIndexes(target)).passed, true);
  });

  test('rejects one-paisa target mutation and duplicate apply is idempotent', async () => {
    const again = await applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
      targetConnection: target, targetDbName: target.db.databaseName, targetClassification: 'isolated-test', superAdmin: { email, password }, recoverySuperAdmin });
    assert.equal(again.status, 'already-complete');
    await target.db.collection('meal_days').updateOne({ date }, { $set: { 'priceOverrides.morning.pricePaise': 102 } });
    const checked = await verifyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest, targetConnection: target });
    assert.equal(checked.passed, false);
    assert.match(checked.issues.join(' '), /meal_days|paise|checksum/i);
  });

  test('rejects source or foreign nonempty target before writing', async () => {
    await assert.rejects(applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
      targetConnection: source, targetDbName: source.db.databaseName, targetClassification: 'isolated-test', superAdmin: { email, password }, recoverySuperAdmin }), /source|target|distinct/i);
    const foreign = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_migration_foreign' }).asPromise();
    try {
      await foreign.db.collection('foreign').insertOne({ keep: true });
      await assert.rejects(applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: foreign, targetDbName: foreign.db.databaseName, targetClassification: 'isolated-test', superAdmin: { email, password }, recoverySuperAdmin }), /empty|foreign/i);
      assert.equal(await foreign.db.collection('foreign').countDocuments(), 1);
    } finally { await foreign.close(); }
  });

  test('rejects reused archived credentials before creating a target checkpoint', async () => {
    const fresh = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_reused_secret_target' }).asPromise();
    try {
      await assert.rejects(applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: fresh, targetDbName: fresh.db.databaseName, targetClassification: 'isolated-test',
        superAdmin: { email, password: 'legacy-password-only-16!' }, recoverySuperAdmin }), /fresh.*secrets/i);
      assert.deepEqual(await fresh.db.listCollections({}, { nameOnly: true }).toArray(), []);
    } finally { await fresh.close(); }
  });

  test('canonical-only mode refuses legacy credentials and userId-less tokens', async () => {
    const service = createAuthService({ config: { canonicalOnlyAuth: true, adminEmail: 'old@isolated.test',
      adminPasswordHash: await bcrypt.hash(password, 12) }, userAccounts: { findByEmail: async () => null },
      accounts: { findByEmail: async () => ({ memberId: 'gaurav', passwordHash: await bcrypt.hash(password, 12) }) } });
    await assert.rejects(service.authenticateCredentials({ email: 'old@isolated.test', password }), /Invalid email or password/i);
    const token = await createSessionToken('superadmin');
    await assert.rejects(verifySessionToken(token, { canonicalOnly: true }), /canonical|userId/i);
    const legacyMemberToken = await createSessionToken('member', { memberId: 'gaurav' });
    await assert.rejects(verifySessionToken(legacyMemberToken, { canonicalOnly: true }), /canonical|userId/i);
  });

  test('data and index audits understand fourth student and required index options', async () => {
    const data = await verifyDataIntegrity(target);
    assert.equal(data.issues.filter(issue => /fourth_student|custom plate allocation count/i.test(issue)).length, 0);
    const indexes = await verifyIndexes(target);
    assert.ok(indexes.results.some(row => row.model === 'Student'));
    assert.ok(indexes.results.some(row => row.model === 'StudentAuditEvent'));
    assert.ok(indexes.results.some(row => row.model === 'SystemSettings'));
    const emailIndex = (await target.db.collection('students').indexes()).find(index => index.key.email === 1);
    await target.db.collection('students').dropIndex(emailIndex.name);
    await target.db.collection('students').createIndex({ email: 1 });
    const broken = await verifyIndexes(target);
    assert.ok(broken.results.some(row => row.model === 'Student' && row.missing.some(item => /unique|partial/i.test(item))));
  });

  test('data audit rejects orphaned dynamic meal and payment references', async () => {
    const fixture = {
      students: ids.map(studentId => ({ studentId })),
      meal_days: [{ date: '2026-10-06', schemaVersion: 3, participantOrder: ['missing_student'],
        meals: { morning: { missing_student: 'taking' }, night: {} }, revision: 0,
        allocations: { morning: { mode: 'custom', plates: [{ shares: { missing_student: 6 } }] } } }],
      payments: [{ paymentId: randomUUID(), idempotencyKey: randomUUID(), memberId: 'missing_student',
        amountPaise: 100, status: 'recorded', voidedAt: null, voidReason: null }],
    };
    const mockDb = { collection: name => ({ find: () => ({ toArray: async () => fixture[name] ?? [] }) }) };
    const audit = await verifyDataIntegrity({ db: mockDb });
    assert.equal(audit.passed, false);
    assert.match(audit.issues.join('; '), /orphaned participantOrder|Unknown student reference/i);
    assert.match(audit.issues.join('; '), /Unknown memberId in payment/i);
  });

  test('data audit accepts a valid version 3 settlement snapshot with a fourth student', async () => {
    const fixture = {
      students: ids.map(studentId => ({ studentId, status: 'ACTIVE' })),
      monthly_settlements: [{ month: '2026-10', status: 'closed', snapshotVersion: 3,
        snapshot: { studentIds: ['fourth_student'],
          members: { fourth_student: { totalShareUnits: 6, billAmountPaise: 101,
            paidAmountPaise: 101, remainingAmountPaise: 0 } },
          room: { totalPhysicalPlates: 1, billAmountPaise: 101, paidAmountPaise: 101 } } }],
    };
    const mockDb = { collection: name => ({ find: () => ({ toArray: async () => fixture[name] ?? [] }) }) };
    const audit = await verifyDataIntegrity({ db: mockDb });
    assert.equal(audit.passed, true, audit.issues.join('; '));
  });

  test('restore CLI never prints credential-bearing MongoDB URIs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mealkhata-v3-restore-'));
    try {
      const archivePath = path.join(dir, 'archive.json');
      await fs.writeFile(archivePath, archive);
      const secret = 'secret-visible-only-in-environment';
      const result = spawnSync(process.execPath, ['scripts/restoreDatabase.js', archivePath, '--drop'], {
        cwd: backendDir, encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, BACKUP_ENCRYPTION_KEY: key,
          RESTORE_MONGODB_URI: `mongodb://user:${secret}@127.0.0.1:1/mealkhata-restore-drill` },
      });
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secret));
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /mongodb:\/\/user:/i);
    } finally {
      assert.ok(path.resolve(dir).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('migration CLI dry-run emits a machine-readable plan without database access', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mealkhata-v3-plan-'));
    try {
      const archivePath = path.join(dir, 'archive.json');
      const manifestPath = path.join(dir, 'manifest.json');
      await fs.writeFile(archivePath, archive);
      await fs.writeFile(manifestPath, JSON.stringify(manifest));
      const result = spawnSync(process.execPath, ['scripts/migrateV3Database.js', '--dry-run',
        '--archive', archivePath, '--manifest', manifestPath], {
        cwd: backendDir, encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, BACKUP_ENCRYPTION_KEY: key,
          MONGODB_URI: '', V3_TARGET_MONGODB_URI: '' },
      });
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.mode, 'dry-run');
      assert.equal(report.counts.meal_days, 2);
      assert.deepEqual(report.studentIds, ids);
      assert.equal(report.collections, undefined);
    } finally {
      assert.ok(path.resolve(dir).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('verified write-free meal delta replay is exact and idempotent', async () => {
    const deltaTarget = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_delta_target' }).asPromise();
    try {
      await applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: deltaTarget, targetDbName: deltaTarget.db.databaseName, targetClassification: 'isolated-test',
        superAdmin: { email, password }, recoverySuperAdmin });
      await source.db.collection('meal_days').updateOne({ date },
        { $inc: { revision: 1, 'priceOverrides.morning.pricePaise': 1 } });
      const added = { date: '2026-10-06', revision: 0,
        meals: { morning: { gaurav: 'taking' }, night: {} },
        changes: [], allocationChanges: [], priceChanges: [] };
      await source.db.collection('meal_days').insertOne(added);
      await source.db.collection('meal_history_snapshots').insertOne(buildLegacyMealSnapshot(added));
      await source.db.collection('monthly_meal_rates').updateOne({ month: '2026-10' },
        { $inc: { revision: 1, morningPricePaise: 1 } });
      const legacy = await source.db.collection('meal_days').findOne({ date: '2026-09-30' });
      const legacyBaseline = await source.db.collection('meal_history_snapshots').findOne({ date: legacy.date });
      const correctedState = { ...legacy, revision: 4,
        priceOverrides: { morning: { pricePaise: 102, reason: 'final correction' } } };
      const correctedSnapshot = { ...buildLegacyMealSnapshot(correctedState),
        snapshotId: 'legacy-correction-v1:2026-09-30:4', calculationVersion: 'legacy-correction-v1' };
      await source.db.collection('meal_history_corrections').insertOne({ date: legacy.date,
        revision: 4, previousRevision: 3, originalSourceChecksum: legacyBaseline.sourceChecksum,
        snapshotChecksum: checksumValue(correctedSnapshot), sourceState: correctedState,
        snapshot: correctedSnapshot, operation: 'price', actorRole: 'superadmin',
        reason: 'final correction', createdAt: new Date() });
      const finalArchive = (await createEncryptedBackup({ dbConnection: source, encryptionKey: key })).serializedPackage;
      const finalSourceManifest = JSON.parse(finalArchive).manifest;
      const options = { archive, encryptionKey: key, sourceManifest: manifest,
        finalArchive, finalSourceManifest, targetConnection: deltaTarget,
        targetClassification: 'isolated-test', sourceWritesStopped: true };
      await assert.rejects(replayFinalMealDelta({ ...options, sourceWritesStopped: false }), /write-free/i);
      await assert.rejects(replayFinalMealDelta({ ...options, finalSourceManifest: { ...finalSourceManifest,
        sha256Checksum: 'a'.repeat(64) } }), /manifest|checksum/i);
      await assert.rejects(replayFinalMealDelta({ ...options,
        onBeforeCheckpoint: () => { throw new Error('simulated interruption'); } }), /simulated interruption/i);
      assert.equal((await deltaTarget.db.collection('meal_days').findOne({ date })).revision, 1);
      assert.equal(await deltaTarget.db.collection('meal_days').countDocuments({ date: added.date }), 0);
      assert.equal((await deltaTarget.db.collection('v3_migration_manifests').findOne({ migrationId: 'mealkhata-v3-blue-green' })).finalSourceChecksum, undefined);
      assert.equal((await replayFinalMealDelta(options)).replayed, 2);
      assert.equal((await replayFinalMealDelta(options)).replayed, 2);
      assert.equal(await deltaTarget.db.collection('meal_history_corrections').countDocuments({ date: legacy.date }), 2);
      assert.equal((await verifyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        finalArchive, finalSourceManifest, targetConnection: deltaTarget })).passed, true);
      await deltaTarget.db.collection('meal_days').updateOne({ date: added.date },
        { $inc: { revision: 1 } });
      const altered = await verifyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        finalArchive, finalSourceManifest, targetConnection: deltaTarget });
      assert.equal(altered.passed, false);
      assert.match(altered.issues.join(' '), /meal_days|checksum/i);
    } finally { await deltaTarget.close(); }
  });

  test('changed legacy source replaces stale snapshot authority and rejects a one-paisa drift', async () => {
    const old = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_changed_legacy_source' }).asPromise();
    const fresh = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_changed_legacy_target' }).asPromise();
    try {
      await old.db.collection('meal_days').insertOne({ date: '2026-08-18', revision: 0,
        meals: { morning: { gaurav: 'taking' }, night: {} },
        changes: [], allocationChanges: [], priceChanges: [] });
      const archiveBefore = (await createEncryptedBackup({ dbConnection: old, encryptionKey: key,
        baselineReaders: createReadOnlyMealBaselineReaders(old.db) })).serializedPackage;
      const manifestBefore = JSON.parse(archiveBefore).manifest;
      const sidecarBefore = createLegacySnapshotSidecar({ archive: archiveBefore,
        sourceManifest: manifestBefore, encryptionKey: key });
      await applyV3Migration({ archive: archiveBefore, sourceManifest: manifestBefore,
        snapshotSidecar: sidecarBefore, encryptionKey: key, targetConnection: fresh,
        targetDbName: fresh.db.databaseName, targetClassification: 'isolated-test',
        superAdmin: { email, password }, recoverySuperAdmin });
      await old.db.collection('meal_days').updateOne({ date: '2026-08-18' },
        { $set: { revision: 1, priceOverrides: { morning: { pricePaise: 101,
          reason: 'last source edit' } } } });
      const finalArchive = (await createEncryptedBackup({ dbConnection: old, encryptionKey: key,
        baselineReaders: createReadOnlyMealBaselineReaders(old.db) })).serializedPackage;
      const finalSourceManifest = JSON.parse(finalArchive).manifest;
      const finalSnapshotSidecar = createLegacySnapshotSidecar({ archive: finalArchive,
        sourceManifest: finalSourceManifest, encryptionKey: key });
      const options = { archive: archiveBefore, sourceManifest: manifestBefore,
        snapshotSidecar: sidecarBefore, encryptionKey: key, finalArchive,
        finalSourceManifest, finalSnapshotSidecar, targetConnection: fresh,
        targetClassification: 'isolated-test', sourceWritesStopped: true };
      await assert.rejects(replayFinalMealDelta({ ...options, finalSnapshotSidecar: undefined }), /snapshot/i);
      await assert.rejects(replayFinalMealDelta({ ...options,
        finalSnapshotSidecar: sidecarBefore }), /sidecar|checksum/i);
      assert.equal((await replayFinalMealDelta(options)).replayed, 1);
      assert.equal((await verifyV3Migration(options)).passed, true);
      await fresh.db.collection('meal_history_snapshots').updateOne({ date: '2026-08-18' },
        { $inc: { 'costs.morning.memberAmountsPaise.gaurav': 1 } });
      const drift = await verifyV3Migration(options);
      assert.equal(drift.passed, false);
      assert.match(drift.issues.join('; '), /snapshot|paise|authority/i);
    } finally { await Promise.allSettled([old.close(), fresh.close()]); }
  });

  test('oversized final meal delta stops before opening a target transaction', async () => {
    const baseSource = await mongoose.createConnection(replSet.getUri(),
      { dbName: 'mealkhata_v3_large_delta_source' }).asPromise();
    const candidate = await mongoose.createConnection(replSet.getUri(),
      { dbName: 'mealkhata_v3_large_delta_target' }).asPromise();
    try {
      const baseArchive = (await createEncryptedBackup({ dbConnection: baseSource, encryptionKey: key })).serializedPackage;
      const baseManifest = JSON.parse(baseArchive).manifest;
      await applyV3Migration({ archive: baseArchive, sourceManifest: baseManifest,
        encryptionKey: key, targetConnection: candidate, targetDbName: candidate.db.databaseName,
        targetClassification: 'isolated-test', superAdmin: { email, password }, recoverySuperAdmin });
      const days = Array.from({ length: 257 }, (_, index) => ({
        date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
        schemaVersion: 3, participantOrder: ['gaurav'], revision: 0,
        meals: { morning: { gaurav: 'taking' }, night: {} },
        allocations: { morning: null, night: null }, changes: [],
      }));
      await baseSource.db.collection('meal_days').insertMany(days);
      const finalArchive = (await createEncryptedBackup({ dbConnection: baseSource,
        encryptionKey: key })).serializedPackage;
      const finalSourceManifest = JSON.parse(finalArchive).manifest;
      await assert.rejects(replayFinalMealDelta({ archive: baseArchive,
        sourceManifest: baseManifest, encryptionKey: key, finalArchive, finalSourceManifest,
        targetConnection: candidate, targetClassification: 'isolated-test',
        sourceWritesStopped: true }), /delta exceeds|too many.*documents/i);
      assert.equal(await candidate.db.collection('meal_days').countDocuments(), 0);
      const marker = await candidate.db.collection('v3_migration_manifests').findOne({
        migrationId: 'mealkhata-v3-blue-green' });
      assert.equal(marker.finalSourceChecksum, undefined);
    } finally { await Promise.allSettled([baseSource.close(), candidate.close()]); }
  });

  test('complete disposable migration and rollback connection rehearsal leaves frozen v2 source intact', async () => {
    const uri = replSet.getUri();
    const original = await mongoose.createConnection(uri, { dbName: 'mealkhata_v3_rehearsal_original' }).asPromise();
    const restored = await mongoose.createConnection(uri, { dbName: 'mealkhata_v3_rehearsal_restore' }).asPromise();
    const candidate = await mongoose.createConnection(uri, { dbName: 'mealkhata_v3_rehearsal_candidate' }).asPromise();
    try {
      const firstDay = { date: '2026-08-01', revision: 0,
        meals: { morning: { gaurav: 'taking' }, night: {} },
        changes: [], allocationChanges: [], priceChanges: [] };
      await original.db.collection('meal_days').insertOne(firstDay);
      await original.db.collection('payments').insertOne({ paymentId: 'old-v2-payment', memberId: 'gaurav', amountPaise: 5000 });
      const oldArchive = (await createEncryptedBackup({ dbConnection: original, encryptionKey: key,
        baselineReaders: createReadOnlyMealBaselineReaders(original.db) })).serializedPackage;
      const oldManifest = JSON.parse(oldArchive).manifest;
      const sidecar = createLegacySnapshotSidecar({ archive: oldArchive,
        sourceManifest: oldManifest, encryptionKey: key });
      assert.equal(planV3Migration({ archive: oldArchive, sourceManifest: oldManifest,
        snapshotSidecar: sidecar, encryptionKey: key }).counts.meal_days, 1);
      assert.equal((await restoreDatabase({ backupPackageString: oldArchive, encryptionKey: key,
        sourceDbConnection: original, targetDbConnection: restored })).verification.passed, true);
      const applied = await applyV3Migration({ archive: oldArchive, sourceManifest: oldManifest,
        snapshotSidecar: sidecar, encryptionKey: key, targetConnection: candidate,
        targetDbName: candidate.db.databaseName, targetClassification: 'isolated-test',
        superAdmin: { email, password }, recoverySuperAdmin });
      assert.equal(applied.verification.passed, true);
      assert.equal(await candidate.db.collection('payments').countDocuments(), 0);
      assert.equal(await candidate.db.collection('user_accounts').countDocuments({ role: 'superadmin' }), 2);
      const added = { date: '2026-08-02', revision: 0,
        meals: { morning: { nikhil: 'taking' }, night: {} },
        changes: [], allocationChanges: [], priceChanges: [] };
      await original.db.collection('meal_days').insertOne(added);
      await original.db.collection('payments').insertOne({ paymentId: 'v2-during-prep',
        memberId: 'nikhil', amountPaise: 125 });
      await original.db.collection('payments').createIndex({ memberId: 1 });
      const finalArchive = (await createEncryptedBackup({ dbConnection: original, encryptionKey: key,
        baselineReaders: createReadOnlyMealBaselineReaders(original.db) })).serializedPackage;
      const finalSourceManifest = JSON.parse(finalArchive).manifest;
      const finalSnapshotSidecar = createLegacySnapshotSidecar({ archive: finalArchive,
        sourceManifest: finalSourceManifest, encryptionKey: key });
      const frozen = await discoverSourceInventory({ dbConnection: original });
      const replay = { archive: oldArchive, sourceManifest: oldManifest, snapshotSidecar: sidecar,
        encryptionKey: key, finalArchive, finalSourceManifest, finalSnapshotSidecar,
        targetConnection: candidate, targetClassification: 'isolated-test', sourceWritesStopped: true };
      await assert.rejects(replayFinalMealDelta(replay), /outside.*meal domain|review/i);
      const nonMealChangeReview = { format: 'mealkhata-v3-nonmeal-review-v1',
        baseArchiveSha256: oldManifest.sha256Checksum,
        finalArchiveSha256: finalSourceManifest.sha256Checksum,
        decision: 'acknowledge-excluded-v2-only',
        reason: 'Verified v2 payment remains only in the frozen v2 source',
        changes: [{ collection: 'payments',
          baseChecksum: oldManifest.collectionMetadata.payments.sha256Checksum,
          finalChecksum: finalSourceManifest.collectionMetadata.payments.sha256Checksum,
          baseCount: 1, finalCount: 2,
          baseIndexesChecksum: checksumValue(oldManifest.collectionMetadata.payments.indexes),
          finalIndexesChecksum: checksumValue(finalSourceManifest.collectionMetadata.payments.indexes) }] };
      await assert.rejects(replayFinalMealDelta({ ...replay,
        nonMealChangeReview: { ...nonMealChangeReview, baseArchiveSha256: 'f'.repeat(64) } }), /review|fingerprint/i);
      replay.nonMealChangeReview = nonMealChangeReview;
      await assert.rejects(replayFinalMealDelta({ ...replay,
        onBeforeCheckpoint: () => { throw new Error('rehearsal power loss'); } }), /rehearsal power loss/);
      assert.equal(await candidate.db.collection('meal_days').countDocuments({ date: added.date }), 0);
      const resumed = await mongoose.createConnection(replSet.getUri(),
        { dbName: candidate.db.databaseName }).asPromise();
      try {
        assert.equal((await replayFinalMealDelta({ ...replay, targetConnection: resumed })).replayed, 1);
      } finally { await resumed.close(); }
      assert.equal((await replayFinalMealDelta(replay)).replayed, 1);
      assert.equal((await verifyV3Migration(replay)).passed, true);
      assert.equal((await verifyIndexes(candidate)).passed, true);
      await candidate.db.collection('system_settings').updateOne({ settingsId: 'system' },
        { $set: { financialStartDate: '2026-11-01' } }); // Disposable fixture date only.
      const beforeSwitch = await discoverSourceInventory({ dbConnection: candidate });
      const v3Payments = ['gaurav', 'nikhil'].map(memberId => ({
        paymentId: randomUUID(), idempotencyKey: randomUUID(), memberId,
        month: '2026-11', amountPaise: 125, status: 'recorded',
        voidedAt: null, voidReason: null, recordedAt: new Date('2026-11-02T12:00:00.000Z'),
      }));
      await candidate.db.collection('payments').insertMany(v3Payments);
      const postOptions = { ...replay, verificationStage: 'post-cutover' };
      const post = await verifyV3Migration(postOptions);
      assert.equal(post.passed, true, post.issues.join('; '));
      const badClaim = await candidate.db.collection('payment_reference_claims').insertOne({
        normalizedReference: 'REHEARSAL-ORPHAN', ledger: 'MESS_PAYMENT',
        documentId: 'missing-payment', memberId: 'gaurav',
      });
      const failedPost = await verifyV3Migration(postOptions);
      assert.equal(failedPost.passed, false);
      assert.match(failedPost.issues.join('; '), /REHEARSAL-ORPHAN.*missing/i);
      await candidate.db.collection('payment_reference_claims').deleteOne({ _id: badClaim.insertedId });
      assert.equal((await verifyV3Migration(postOptions)).passed, true);
      assert.equal(await candidate.db.collection('payments').countDocuments(), 2);
      // Rehearse additional post-switch domain writes before a simulated rollback.
      await candidate.db.collection('meal_days').insertOne({ date: '2026-11-02', schemaVersion: 3,
        participantOrder: ['gaurav', 'nikhil', 'devansh'], importedFromLegacy: false,
        meals: { morning: { gaurav: 'taking', nikhil: 'skip', devansh: 'skip' }, night: {} },
        revision: 0, changes: [], allocationChanges: [], priceChanges: [] });
      await candidate.db.collection('room_charges').insertOne({ chargeId: 'v3-room-charge',
        memberId: 'nikhil', month: '2026-11', baseAmountPaise: 2000, adjustments: [] });
      await candidate.db.collection('room_payments').insertOne({ roomPaymentId: 'v3-room-payment',
        chargeId: 'v3-room-charge', memberId: 'nikhil', month: '2026-11', amountPaise: 500,
        status: 'verified', reference: 'V3-ROOM-ONLY', recordedAt: new Date('2026-11-02T12:00:00Z') });
      await candidate.db.collection('expenses').insertOne({ expenseId: 'v3-expense',
        date: '2026-11-02', amountPaise: 300, paidByMemberId: 'gaurav',
        allocations: [{ memberId: 'gaurav', amountPaise: 150 },
          { memberId: 'nikhil', amountPaise: 150 }] });
      await candidate.db.collection('expense_reimbursements').insertOne({
        reimbursementId: 'v3-reimbursement', expenseId: 'v3-expense', expenseMonth: '2026-11',
        fromMemberId: 'nikhil', toMemberId: 'gaurav', amountPaise: 150,
        status: 'recorded', reference: 'V3-EXPENSE-ONLY',
        recordedAt: new Date('2026-11-02T12:00:00Z') });
      const financeReport = await auditV3OperationalFinances(candidate.db, '2026-11-01');
      assert.equal(financeReport.passed, true, financeReport.issues.join('; '));
      assert.equal(financeReport.counts.room_payments, 1);
      assert.equal(financeReport.counts.expense_reimbursements, 1);
      const afterWriteStop = await discoverSourceInventory({ dbConnection: candidate });
      const writeRegister = buildV3RollbackWriteRegister({ before: beforeSwitch,
        after: afterWriteStop, writesStopped: true });
      assert.deepEqual(new Set(writeRegister.entries.map(item => item.collection)), new Set([
        'meal_days', 'payments', 'room_charges', 'room_payments',
        'expenses', 'expense_reimbursements' ]));
      assert.equal(writeRegister.duplicateExternalReferences.length, 0);
      assert.equal(writeRegister.entries.filter(item => item.collection === 'payments').length, 2);
      assert.equal(JSON.stringify(writeRegister).includes('passwordHash'), false);
      let active = candidate;
      assert.equal(await active.db.collection('payments').countDocuments(), 2);
      active = original; // Rehearse restoring the original connection; no source write is involved.
      assert.equal(await active.db.collection('payments').countDocuments({ paymentId: 'old-v2-payment' }), 1);
      assert.equal(await active.db.collection('payments').countDocuments({ paymentId: 'v2-during-prep' }), 1);
      assert.equal(await active.db.collection('payments').countDocuments({
        paymentId: { $in: v3Payments.map(payment => payment.paymentId) } }), 0);
      assert.equal(await active.db.collection('meal_days').countDocuments(), 2);
      assert.equal(await active.db.collection('room_payments').countDocuments(), 0);
      assert.equal(await active.db.collection('expense_reimbursements').countDocuments(), 0);
      const afterRollback = await discoverSourceInventory({ dbConnection: original });
      assert.deepEqual(afterRollback.collectionOrder, frozen.collectionOrder);
      for (const name of frozen.collectionOrder) {
        assert.equal(afterRollback.collections[name].sha256Checksum,
          frozen.collections[name].sha256Checksum, `original ${name} changed`);
      }
    } finally { await Promise.allSettled([original.close(), restored.close(), candidate.close()]); }
  });
});
