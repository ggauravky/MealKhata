import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createEncryptedBackup, restoreDatabase } from '../src/backup/backupEngine.js';
import { createReadOnlyMealBaselineReaders } from '../src/migrations/v3ArchiveBaselines.service.js';
import { createLegacySnapshotSidecar } from '../src/migrations/v3SnapshotSidecar.service.js';
import { collectSourceEvidence, compareSourceEvidenceToArchive,
  createMongoSourceReadAdapter } from '../src/migrations/v3SourceEvidence.service.js';
import { buildHistoricalCostEvidence } from '../src/migrations/v3HistoricalEvidence.service.js';

const implementation = await import('../src/migrations/v3ReleaseEvidence.service.js').catch(() => ({}));
const { verifyRecoveryEvidence, buildReleaseEvidencePackage,
  verifyReleaseEvidencePackage, writeProtectedReleaseEvidence } = implementation;
const key = 'isolated-release-evidence-key-2026';
const sourceId = { clusterId: 'local-c', databaseName: 'source_release_fixture', replicaSet: 'rs-local' };
const recoveryId = { clusterId: 'local-c', databaseName: 'recovery_release_fixture', replicaSet: 'rs-local' };
let replica;
let source;
let recovery;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  source = await mongoose.createConnection(replica.getUri(sourceId.databaseName)).asPromise();
  recovery = await mongoose.createConnection(replica.getUri(recoveryId.databaseName)).asPromise();
});
after(async () => { await source?.close(); await recovery?.close(); await replica?.stop(); });
beforeEach(async () => {
  await Promise.all([source.db.dropDatabase(), recovery.db.dropDatabase()]);
  await source.db.collection('meal_days').insertOne({ date: '2026-09-30', revision: 0,
    meals: { morning: { gaurav: 'taking', nikhil: 'skip', devansh: 'skip' },
      night: { gaurav: 'skip', nikhil: 'skip', devansh: 'skip' } },
    changes: [], allocationChanges: [], priceChanges: [] });
  await source.db.collection('meal_days').createIndex({ date: 1 }, { unique: true });
  await source.db.collection('payments').insertOne({ paymentId: 'old-v2', amountPaise: 500 });
});
async function fixture() {
  const reader = createMongoSourceReadAdapter({ dbConnection: source,
    observeWriteEpoch: async () => 'stable-token',
    observePermissions: async () => ({ principalId: 'read-only',
      actions: ['find', 'listCollections', 'listIndexes'] }) });
  const rescanSource = () => collectSourceEvidence({ reader, expectedIdentity: sourceId,
    observeControlPlane: async () => sourceId, observeConnection: async () => sourceId });
  const inventory = await rescanSource();
  const { serializedPackage: archive, manifest } = await createEncryptedBackup({
    dbConnection: source, encryptionKey: key,
    baselineReaders: createReadOnlyMealBaselineReaders(source.db) });
  const sidecar = createLegacySnapshotSidecar({ archive, sourceManifest: manifest, encryptionKey: key });
  const comparison = compareSourceEvidenceToArchive({ evidence: inventory,
    archive, sourceManifest: manifest, encryptionKey: key });
  const historical = buildHistoricalCostEvidence({ archive, sourceManifest: manifest,
    encryptionKey: key, snapshotSidecar: sidecar });
  return { inventory, archive, manifest, sidecar, comparison, historical, rescanSource };
}

test('complete recovery archive restores every old collection and index, with no v3-only payment', async () => {
  assert.equal(typeof verifyRecoveryEvidence, 'function');
  const data = await fixture();
  await restoreDatabase({ backupPackageString: data.archive, encryptionKey: key,
    sourceDbConnection: source, targetDbConnection: recovery });
  const result = await verifyRecoveryEvidence({ ...data, encryptionKey: key,
    sourceInventoryAfter: await data.rescanSource(),
    expectedSourceIdentity: sourceId, expectedRecoveryIdentity: recoveryId,
    recoveryConnection: recovery, observeRecoveryControlPlane: async () => recoveryId,
    observeRecoveryConnection: async () => recoveryId,
    v2ReadProbe: async () => ({ passed: Boolean(await recovery.db.collection('meal_days')
      .findOne({ date: '2026-09-30' })) }),
    v3OnlyRecords: [{ collection: 'payments', field: 'paymentId', value: 'v3-only-payment' }] });
  assert.equal(result.passed, true);
  assert.equal(await recovery.db.collection('payments').countDocuments({ paymentId: 'old-v2' }), 1);
  assert.ok((await recovery.db.collection('meal_days').indexes()).some(index => index.name === 'date_1' && index.unique));
  await assert.rejects(verifyRecoveryEvidence({ ...data, encryptionKey: key,
    sourceInventoryAfter: await data.rescanSource(), expectedSourceIdentity: sourceId,
    expectedRecoveryIdentity: recoveryId, recoveryConnection: recovery,
    observeRecoveryControlPlane: async () => ({ ...recoveryId, clusterId: 'wrong' }),
    observeRecoveryConnection: async () => recoveryId,
    v2ReadProbe: async () => ({ passed: true }) }), /identity/i);
  await recovery.db.collection('payments').insertOne({ paymentId: 'v3-only-payment', amountPaise: 1 });
  await assert.rejects(verifyRecoveryEvidence({ ...data, encryptionKey: key,
    sourceInventoryAfter: await data.rescanSource(),
    expectedSourceIdentity: sourceId, expectedRecoveryIdentity: recoveryId,
    recoveryConnection: recovery, observeRecoveryControlPlane: async () => recoveryId,
    observeRecoveryConnection: async () => recoveryId,
    v2ReadProbe: async () => ({ passed: true }),
    v3OnlyRecords: [{ collection: 'payments', field: 'paymentId', value: 'v3-only-payment' }] }),
  /recovery|checksum|v3-only/i);
});

test('protected package stores detailed paise and signatures while public summary stays aggregate', async () => {
  assert.equal(typeof buildReleaseEvidencePackage, 'function');
  const data = await fixture();
  const evidence = buildReleaseEvidencePackage({ releaseId: 'task17-synthetic', planVersion: 'stage-a-v1',
    sourceInventory: data.inventory, archiveComparison: data.comparison,
    historicalCosts: data.historical, snapshotSidecarSha256: data.historical.snapshotSidecarSha256,
    approvals: [{ signerId: 'owner-test', signature: 'secret-signature' }],
    missingEligibility: ['gaurav'], provenance: 'synthetic',
    blockers: ['genuine source authorization pending'] });
  assert.equal(evidence.private.sourceStatus, 'SOURCE_EVIDENCE_PENDING');
  assert.equal(evidence.private.implementationStatus, 'IMPLEMENTATION_VERIFIED');
  assert.equal(evidence.private.readiness, 'NOT_READY — BLOCKERS REMAIN');
  assert.equal(evidence.public.studentTotalsPaise, undefined);
  assert.equal(JSON.stringify(evidence.public).includes('gaurav'), false);
  assert.equal(JSON.stringify(evidence.public).includes('secret-signature'), false);
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'v3-private-evidence-'));
  try {
    const written = await writeProtectedReleaseEvidence({ evidence,
      jsonPath: path.join(folder, 'evidence.json'), markdownPath: path.join(folder, 'review.md') });
    assert.equal(written.status, 'SOURCE_EVIDENCE_PENDING');
    assert.equal(JSON.stringify(written).includes('secret-signature'), false);
    const stored = JSON.parse(await fs.readFile(path.join(folder, 'evidence.json'), 'utf8'));
    assert.equal(stored.approvals[0].signature, 'secret-signature');
    assert.equal(stored.historicalCosts.studentTotalsPaise.gaurav, 5000);
    assert.equal(verifyReleaseEvidencePackage(stored), true);
    stored.historicalCosts.studentTotalsPaise.gaurav += 1;
    assert.throws(() => verifyReleaseEvidencePackage(stored), /checksum|tamper/i);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(path.join(folder, 'evidence.json'))).mode & 0o077, 0);
    }
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
