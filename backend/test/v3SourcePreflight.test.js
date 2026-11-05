import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createEncryptedBackup } from '../src/backup/backupEngine.js';
import { createReadOnlyMealBaselineReaders } from '../src/migrations/v3ArchiveBaselines.service.js';
import { createLegacySnapshotSidecar } from '../src/migrations/v3SnapshotSidecar.service.js';
import { createV3SourcePreflight } from '../src/migrations/v3SourcePreflight.service.js';

let replica;
let connection;
const key = 'isolated-preflight-key-at-least-sixteen';
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  connection = await mongoose.createConnection(replica.getUri('v2_preflight_fixture')).asPromise();
});
after(async () => { await connection?.close(); await replica?.stop(); });

test('offline preflight lists every archived collection and exact legacy cost without source writes', async () => {
  const day = { date: '2026-09-30', revision: 0, meals: {
    morning: { gaurav: 'taking', nikhil: 'skip', devansh: 'skip' },
    night: { gaurav: 'skip', nikhil: 'skip', devansh: 'skip' },
  }, changes: [], allocationChanges: [], priceChanges: [] };
  await connection.db.collection('meal_days').insertOne(day);
  await connection.db.collection('meal_days').createIndex({ date: 1 }, { unique: true });
  await connection.db.collection('unexpected_shadow').insertOne({ original: true });
  const { serializedPackage: archive, manifest } = await createEncryptedBackup({
    dbConnection: connection, encryptionKey: key,
    baselineReaders: createReadOnlyMealBaselineReaders(connection.db),
  });
  const snapshotSidecar = createLegacySnapshotSidecar({ archive, sourceManifest: manifest, encryptionKey: key });
  const report = createV3SourcePreflight({ archive, sourceManifest: manifest,
    encryptionKey: key, snapshotSidecar });
  assert.equal(report.passed, false);
  assert.equal(report.sourceDatabase, 'v2_preflight_fixture');
  assert.equal(report.collections.meal_days.count, 1);
  assert.ok(report.collections.meal_days.indexes.some(index => index.name === 'date_1' && index.unique));
  assert.deepEqual(report.mealDates, { count: 1, first: '2026-09-30', last: '2026-09-30', months: ['2026-09'] });
  assert.deepEqual(report.participantIds, ['devansh', 'gaurav', 'nikhil']);
  assert.equal(report.historicalCosts.householdAmountPaise, 5000);
  assert.equal(report.snapshots.sidecarCount, 1);
  assert.match(report.issues.join('; '), /unexpected_shadow/);
  assert.equal((await connection.db.collection('meal_days').findOne({ date: '2026-09-30' })).revision, 0);
  assert.equal(await connection.db.collection('meal_history_snapshots').countDocuments(), 0);
});

test('offline preflight fails closed when snapshot handoff or source checksum changes', async () => {
  const { serializedPackage: archive, manifest } = await createEncryptedBackup({
    dbConnection: connection, encryptionKey: key,
    baselineReaders: createReadOnlyMealBaselineReaders(connection.db),
  });
  assert.throws(() => createV3SourcePreflight({ archive, sourceManifest: manifest, encryptionKey: key }),
    /snapshot|authority/i);
  const sidecar = createLegacySnapshotSidecar({ archive, sourceManifest: manifest, encryptionKey: key });
  sidecar.snapshots[0].sourceChecksum = '0'.repeat(64);
  assert.throws(() => createV3SourcePreflight({ archive, sourceManifest: manifest,
    encryptionKey: key, snapshotSidecar: sidecar }), /authentication|checksum/i);
});

test('preflight CLI exposes archive-only inputs and never prints a database URI', () => {
  const run = spawnSync(process.execPath, ['backend/scripts/preflightV3Source.js', '--help'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8',
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /--archive.*--manifest.*--snapshot-sidecar/i);
  assert.doesNotMatch(run.stdout + run.stderr, /mongodb(?:\+srv)?:\/\//i);
});

test('offline CLI writes a private report from verified files and signals inventory issues', async () => {
  const { serializedPackage: archive, manifest } = await createEncryptedBackup({
    dbConnection: connection, encryptionKey: key,
    baselineReaders: createReadOnlyMealBaselineReaders(connection.db),
  });
  const sidecar = createLegacySnapshotSidecar({ archive, sourceManifest: manifest, encryptionKey: key });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'v3-preflight-'));
  const files = ['archive', 'manifest', 'sidecar', 'report'].map(name => path.join(directory, name));
  try {
    await Promise.all([
      fs.writeFile(files[0], archive), fs.writeFile(files[1], JSON.stringify(manifest)),
      fs.writeFile(files[2], JSON.stringify(sidecar)),
    ]);
    const run = spawnSync(process.execPath, ['backend/scripts/preflightV3Source.js',
      '--archive', files[0], '--manifest', files[1], '--snapshot-sidecar', files[2],
      '--report', files[3]], { cwd: new URL('../../', import.meta.url), encoding: 'utf8',
      env: { ...process.env, BACKUP_ENCRYPTION_KEY: key } });
    assert.equal(run.status, 1); // The deliberately unexpected source collection blocks cutover.
    assert.doesNotMatch(run.stdout + run.stderr, /mongodb(?:\+srv)?:\/\//i);
    assert.equal(run.stdout.includes(key), false);
    const report = JSON.parse(await fs.readFile(files[3], 'utf8'));
    assert.equal(report.passed, false);
    assert.equal(report.collections.unexpected_shadow.count, 1);
  } finally {
    for (const file of files) await fs.unlink(file).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    await fs.rmdir(directory);
  }
});
