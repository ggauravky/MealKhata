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
import { createEncryptedBackup, restoreDatabase, toExtendedJson } from '../src/backup/backupEngine.js';
import { createAuthService } from '../src/auth/auth.service.js';
import { createSessionToken, verifySessionToken } from '../src/auth/token.service.js';
import { verifyDataIntegrity } from '../scripts/verifyData.js';
import { verifyIndexes } from '../scripts/verifyIndexes.js';
import { buildLegacyMealSnapshot } from '../src/migrations/legacyMealSnapshot.service.js';
import { checksumValue } from '../src/migrations/sourceInventory.service.js';
import { serializeLegacyMealSnapshot, serializeMealDay } from '../src/meals/meal.serializer.js';
import { isOperationalMealDayForBoundary } from '../src/finance/financialBoundary.service.js';
import {
  applyV3Migration,
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
        sourceManifest: oldManifest, targetConnection: fresh, targetDbName: fresh.db.databaseName,
        superAdmin: { email, password }, recoverySuperAdmin });
      assert.equal(result.verification.passed, true);
      const generated = await fresh.db.collection('students').find({}).sort({ rosterOrder: 1 }).toArray();
      assert.deepEqual(generated.map(student => student.studentId), ids.slice(0, 3));
      assert.ok(generated.every(student => student._id instanceof mongoose.Types.ObjectId
        && student.mealEligibilityFrom === null));
      assert.equal(await old.db.collection('students').countDocuments(), 0);
    } finally { await Promise.allSettled([old.close(), fresh.close()]); }
  });

  test('applies history with exact paise, fresh credentials, and no inherited debt', async () => {
    const result = await applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
      targetConnection: target, targetDbName: target.db.databaseName, superAdmin: { email, password }, recoverySuperAdmin });
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
      targetConnection: target, targetDbName: target.db.databaseName, superAdmin: { email, password }, recoverySuperAdmin });
    assert.equal(again.status, 'already-complete');
    await target.db.collection('meal_days').updateOne({ date }, { $set: { 'priceOverrides.morning.pricePaise': 102 } });
    const checked = await verifyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest, targetConnection: target });
    assert.equal(checked.passed, false);
    assert.match(checked.issues.join(' '), /meal_days|paise|checksum/i);
  });

  test('rejects source or foreign nonempty target before writing', async () => {
    await assert.rejects(applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
      targetConnection: source, targetDbName: source.db.databaseName, superAdmin: { email, password }, recoverySuperAdmin }), /source|target|distinct/i);
    const foreign = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_migration_foreign' }).asPromise();
    try {
      await foreign.db.collection('foreign').insertOne({ keep: true });
      await assert.rejects(applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: foreign, targetDbName: foreign.db.databaseName, superAdmin: { email, password }, recoverySuperAdmin }), /empty|foreign/i);
      assert.equal(await foreign.db.collection('foreign').countDocuments(), 1);
    } finally { await foreign.close(); }
  });

  test('rejects reused archived credentials before creating a target checkpoint', async () => {
    const fresh = await mongoose.createConnection(replSet.getUri(), { dbName: 'mealkhata_v3_reused_secret_target' }).asPromise();
    try {
      await assert.rejects(applyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: fresh, targetDbName: fresh.db.databaseName,
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
        targetConnection: deltaTarget, targetDbName: deltaTarget.db.databaseName,
        superAdmin: { email, password }, recoverySuperAdmin });
      const changed = await source.db.collection('meal_days').findOne({ date });
      changed.revision += 1;
      changed.priceOverrides.morning.pricePaise += 1;
      const added = { ...changed, _id: new mongoose.Types.ObjectId(), date: '2026-10-06', revision: 0 };
      const deltaDocuments = [toExtendedJson(changed), toExtendedJson(added)];
      const options = { targetConnection: deltaTarget, deltaDocuments,
        expectedSourceChecksum: manifest.sha256Checksum,
        expectedDeltaChecksum: checksumValue(deltaDocuments), sourceWritesStopped: true };
      await assert.rejects(replayFinalMealDelta({ ...options, sourceWritesStopped: false }), /write-free/i);
      await assert.rejects(replayFinalMealDelta({ ...options, expectedDeltaChecksum: 'a'.repeat(64) }), /checksum/i);
      assert.equal((await replayFinalMealDelta(options)).replayed, 2);
      assert.equal((await replayFinalMealDelta(options)).replayed, 2);
      assert.equal((await verifyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: deltaTarget })).passed, true);
      await deltaTarget.db.collection('meal_days').updateOne({ date: added.date },
        { $inc: { 'priceOverrides.morning.pricePaise': 1 } });
      const altered = await verifyV3Migration({ archive, encryptionKey: key, sourceManifest: manifest,
        targetConnection: deltaTarget });
      assert.equal(altered.passed, false);
      assert.match(altered.issues.join(' '), /delta checksum/i);
    } finally { await deltaTarget.close(); }
  });
});
