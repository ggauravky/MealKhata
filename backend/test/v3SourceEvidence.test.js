import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createEncryptedBackup } from '../src/backup/backupEngine.js';
import { createReadOnlyMealBaselineReaders } from '../src/migrations/v3ArchiveBaselines.service.js';
import { createLegacySnapshotSidecar } from '../src/migrations/v3SnapshotSidecar.service.js';
import { checksumValue } from '../src/migrations/sourceInventory.service.js';

const implementation = await import('../src/migrations/v3SourceEvidence.service.js').catch(() => ({}));
const { createMongoSourceReadAdapter, collectSourceEvidence,
  compareSourceEvidenceToArchive } = implementation;
const { buildHistoricalCostEvidence } =
  await import('../src/migrations/v3HistoricalEvidence.service.js').catch(() => ({}));
const { verifyFrozenAmendmentArtifacts } =
  await import('../src/migrations/v3FrozenSourceEvidence.service.js').catch(() => ({}));
const identity = { clusterId: 'fixture-cluster', databaseName: 'source_evidence_fixture', replicaSet: 'fixture-rs' };
const key = 'isolated-source-evidence-key-2026';
let replica;
let connection;
let epoch;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  connection = await mongoose.createConnection(replica.getUri(identity.databaseName)).asPromise();
});
after(async () => { await connection?.close(); await replica?.stop(); });
beforeEach(async () => {
  await connection.db.dropDatabase();
  epoch = 'epoch-1';
  await connection.db.collection('meal_days').insertOne({ date: '2026-09-30', revision: 0,
    meals: { morning: { gaurav: 'taking', nikhil: 'skip', devansh: 'skip' },
      night: { gaurav: 'skip', nikhil: 'skip', devansh: 'skip' } },
    changes: [], allocationChanges: [], priceChanges: [], createdAt: new Date('2026-09-30T00:00:00Z') });
  await connection.db.collection('meal_days').createIndex({ date: 1 }, { unique: true });
  await connection.db.collection('payments').insertOne({ paymentId: 'old-1', amountPaise: 1 });
});
function setup(overrides = {}) {
  const reader = createMongoSourceReadAdapter({ dbConnection: connection,
    observeWriteEpoch: async () => epoch,
    observePermissions: async () => ({ principalId: 'readonly-1',
      actions: ['find', 'listCollections', 'listIndexes'] }), ...overrides });
  return { reader, expectedIdentity: identity,
    observeControlPlane: async () => identity, observeConnection: async () => identity };
}

test('snapshot inventory records collections, unique indexes, original IDs, audits, dates and old ledgers without writes', async () => {
  assert.equal(typeof collectSourceEvidence, 'function');
  await connection.db.collection('unexpected_shadow').insertOne({ original: true });
  const evidence = await collectSourceEvidence(setup());
  assert.equal(evidence.consistency.level, 'SNAPSHOT_WITH_STABLE_WRITE_EPOCH');
  assert.equal(evidence.collections.meal_days.count, 1);
  assert.ok(evidence.collections.meal_days.indexes.some(index => index.unique && index.name === 'date_1'));
  assert.equal(evidence.collections.payments.count, 1);
  assert.deepEqual(evidence.meals.dates, ['2026-09-30']);
  assert.deepEqual(evidence.meals.originalIdsPresent, ['gaurav', 'nikhil', 'devansh']);
  assert.equal(evidence.meals.monthCounts['2026-09'], 1);
  assert.ok(evidence.findings.some(item => item.includes('unexpected_shadow')));
  assert.equal((await connection.db.collection('meal_days').findOne({ date: '2026-09-30' })).revision, 0);
  assert.equal(await connection.db.collection('unexpected_shadow').countDocuments(), 1);
});

test('write epoch and index drift during inventory fail closed despite snapshot reads', async () => {
  const base = setup();
  const reader = { ...base.reader,
    async readDocuments(name, session) {
      const result = await base.reader.readDocuments(name, session);
      if (name === 'meal_days') {
        await connection.db.collection('payments').updateOne({ paymentId: 'old-1' },
          { $set: { amountPaise: 2 } });
        epoch = 'epoch-2';
      }
      return result;
    } };
  await assert.rejects(collectSourceEvidence({ ...base, reader }), /changed|stale|epoch/i);
  epoch = 'epoch-1';
  let indexReads = 0;
  const indexReader = { ...base.reader,
    async listIndexes(name) {
      indexReads += 1;
      const indexes = await base.reader.listIndexes(name);
      return indexReads > 2 && name === 'payments'
        ? [...indexes, { name: 'new_partial', key: { paymentId: 1 }, unique: true,
          partialFilterExpression: { amountPaise: { $gt: 0 } } }] : indexes;
    } };
  await assert.rejects(collectSourceEvidence({ ...base, reader: indexReader }), /index|changed|stale/i);
});

test('changed source document during backup preparation cannot match the consistent inventory', async () => {
  const evidence = await collectSourceEvidence(setup());
  await connection.db.collection('payments').updateOne({ paymentId: 'old-1' },
    { $set: { amountPaise: 2 } });
  const { serializedPackage: archive, manifest } = await createEncryptedBackup({
    dbConnection: connection, encryptionKey: key,
    baselineReaders: createReadOnlyMealBaselineReaders(connection.db) });
  assert.throws(() => compareSourceEvidenceToArchive({ evidence, archive,
    sourceManifest: manifest, encryptionKey: key }), /checksum|changed|stale/i);
});

test('permission, identity and snapshot failures stop read-only source evidence', async () => {
  await assert.rejects(collectSourceEvidence(setup({ observePermissions: async () => ({
    principalId: 'writable', actions: ['find', 'listCollections', 'listIndexes', 'insert'] }) })),
  /read.only|scope|permission/i);
  await assert.rejects(collectSourceEvidence({ ...setup(),
    observeControlPlane: async () => ({ ...identity, clusterId: 'wrong' }) }), /identity/i);
  const base = setup();
  await assert.rejects(collectSourceEvidence({ ...base,
    reader: { ...base.reader, withSnapshot: async () => { throw new Error('snapshot expired'); } } }),
  /snapshot|consistent/i);
});

test('authenticated archive, fourth identity and proposed target conserve every historical paise', async () => {
  assert.equal(typeof buildHistoricalCostEvidence, 'function');
  await connection.db.collection('students').insertOne({ studentId: 'fourth',
    displayName: 'Fourth', status: 'ARCHIVED', rosterOrder: 3 });
  const { serializedPackage: archive, manifest } = await createEncryptedBackup({
    dbConnection: connection, encryptionKey: key,
    baselineReaders: createReadOnlyMealBaselineReaders(connection.db) });
  const snapshotSidecar = createLegacySnapshotSidecar({ archive, sourceManifest: manifest, encryptionKey: key });
  const targetHistory = { meal_days: (await connection.db.collection('meal_days').find({}).toArray()),
    meal_history_snapshots: snapshotSidecar.snapshots, meal_history_corrections: [] };
  const evidence = buildHistoricalCostEvidence({ archive, sourceManifest: manifest,
    encryptionKey: key, snapshotSidecar, targetHistory });
  assert.equal(evidence.passed, true);
  assert.equal(evidence.dayCount, 1);
  assert.equal(evidence.householdAmountPaise, 5000);
  assert.equal(evidence.studentTotalsPaise.gaurav, 5000);
  assert.ok(evidence.historicalStudentIds.includes('fourth'));
  assert.equal(evidence.months['2026-09'].householdAmountPaise, 5000);
  assert.equal(evidence.daily[0].sourceAuthoritySha256, evidence.daily[0].targetAuthoritySha256);
  const onePaise = structuredClone(targetHistory);
  onePaise.meal_history_snapshots[0].costs.morning.memberAmountsPaise.gaurav += 1;
  assert.throws(() => buildHistoricalCostEvidence({ archive, sourceManifest: manifest,
    encryptionKey: key, snapshotSidecar, targetHistory: onePaise }), /paise|authority|cost/i);
  assert.throws(() => buildHistoricalCostEvidence({ archive, sourceManifest: manifest,
    encryptionKey: key, snapshotSidecar, targetHistory: { ...targetHistory, meal_days: [] } }),
  /missing|date/i);
  assert.throws(() => buildHistoricalCostEvidence({ archive, sourceManifest: manifest,
    encryptionKey: key, snapshotSidecar: null }), /snapshot|authority/i);
  assert.throws(() => buildHistoricalCostEvidence({ archive, sourceManifest: manifest,
    encryptionKey: key, snapshotSidecar,
    targetHistory: { ...targetHistory, meal_days: [...targetHistory.meal_days, ...targetHistory.meal_days] } }),
  /duplicate|date/i);
  const partialMonth = buildHistoricalCostEvidence({ archive, sourceManifest: manifest,
    encryptionKey: key, snapshotSidecar, financialStartDate: '2026-09-15' });
  assert.equal(partialMonth.householdAmountPaise, evidence.householdAmountPaise);
  assert.equal(partialMonth.financialStartDateDecision, '2026-09-15');
});

test('unknown collection remains in complete encrypted archive and exact comparison', async () => {
  await connection.db.collection('unclassified_v2').insertOne({ preserved: true });
  const evidence = await collectSourceEvidence(setup());
  const { serializedPackage: archive, manifest } = await createEncryptedBackup({
    dbConnection: connection, encryptionKey: key,
    baselineReaders: createReadOnlyMealBaselineReaders(connection.db) });
  const result = compareSourceEvidenceToArchive({ evidence, archive,
    sourceManifest: manifest, encryptionKey: key });
  assert.equal(result.passed, true);
  assert.equal(manifest.collectionMetadata.unclassified_v2.count, 1);
  assert.ok(evidence.findings.some(item => item.includes('unclassified_v2')));
});

test('frozen amendment artifacts bind source snapshots, sidecar, reviewed v2-only drift and meal delta', async () => {
  assert.equal(typeof verifyFrozenAmendmentArtifacts, 'function');
  const baseEvidence = await collectSourceEvidence(setup());
  const baseBackup = await createEncryptedBackup({ dbConnection: connection, encryptionKey: key,
    baselineReaders: createReadOnlyMealBaselineReaders(connection.db) });
  await connection.db.collection('payments').insertOne({ paymentId: 'legitimate-v2-only', amountPaise: 3 });
  const freezeAt = new Date().toISOString();
  await new Promise(resolve => setTimeout(resolve, 5));
  const finalEvidence = await collectSourceEvidence(setup());
  const finalBackup = await createEncryptedBackup({ dbConnection: connection, encryptionKey: key,
    baselineReaders: createReadOnlyMealBaselineReaders(connection.db) });
  const sidecar = createLegacySnapshotSidecar({ archive: finalBackup.serializedPackage,
    sourceManifest: finalBackup.manifest, encryptionKey: key });
  const review = { format: 'mealkhata-v3-nonmeal-review-v1',
    baseArchiveSha256: baseBackup.manifest.sha256Checksum,
    finalArchiveSha256: finalBackup.manifest.sha256Checksum,
    decision: 'acknowledge-excluded-v2-only', reason: 'Payment stays in the frozen v2 archive',
    changes: [{ collection: 'payments', baseChecksum: baseBackup.manifest.collectionMetadata.payments.sha256Checksum,
      finalChecksum: finalBackup.manifest.collectionMetadata.payments.sha256Checksum,
      baseCount: 1, finalCount: 2,
      baseIndexesChecksum: checksumValue(baseBackup.manifest.collectionMetadata.payments.indexes),
      finalIndexesChecksum: checksumValue(finalBackup.manifest.collectionMetadata.payments.indexes) }] };
  const options = { baseEvidence, finalEvidence, baseArchive: baseBackup.serializedPackage,
    baseManifest: baseBackup.manifest, finalArchive: finalBackup.serializedPackage,
    finalManifest: finalBackup.manifest, finalSidecar: sidecar, encryptionKey: key,
    nonMealChangeReview: review, freezeAt,
    verifyWriteFreeze: async () => ({ passed: true, sourceIdentity: identity,
      freezeAt,
      finalArchiveSha256: finalBackup.manifest.sha256Checksum }) };
  await assert.rejects(verifyFrozenAmendmentArtifacts({ ...options,
    nonMealChangeReview: null }), /drift|review|non.meal/i);
  const result = await verifyFrozenAmendmentArtifacts(options);
  assert.equal(result.passed, true);
  assert.equal(result.finalArchiveSha256, finalBackup.manifest.sha256Checksum);
  assert.equal(result.sidecarSha256, checksumValue(sidecar));
  assert.equal(result.nonMealChanges.length, 1);
  await assert.rejects(verifyFrozenAmendmentArtifacts({ ...options,
    finalEvidence: baseEvidence }), /archive|source|fingerprint|changed/i);
  const impossibleFreeze = '2020-01-01T00:00:00.000Z';
  await assert.rejects(verifyFrozenAmendmentArtifacts({ ...options,
    freezeAt: impossibleFreeze, verifyWriteFreeze: async () => ({ passed: true,
      sourceIdentity: identity, freezeAt: impossibleFreeze,
      finalArchiveSha256: finalBackup.manifest.sha256Checksum }) }), /freeze|chronolog|archive/i);
});
