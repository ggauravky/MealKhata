import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import {
  createEncryptedBackup,
  restoreDatabase,
  verifyAndDecryptBackup,
} from '../src/backup/backupEngine.js';
import { assertDistinctDatabaseUris } from '../src/migrations/sourceInventory.service.js';

const ENCRYPTION_KEY = 'task-zero-isolated-backup-key-32-bytes';
const backendDirectory = fileURLToPath(new URL('..', import.meta.url));

describe('MealKhata 3.0 Task 0 archive and baseline safety', () => {
  let replSet;
  let sourceConnection;
  let targetConnection;

  before(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = replSet.getUri();
    sourceConnection = await mongoose.createConnection(uri, {
      dbName: 'mealkhata_v3_task0_source',
      serverSelectionTimeoutMS: 15_000,
    }).asPromise();
    targetConnection = await mongoose.createConnection(uri, {
      dbName: 'mealkhata_v3_task0_target',
      serverSelectionTimeoutMS: 15_000,
    }).asPromise();

    await sourceConnection.db.collection('meal_days').insertMany([
      {
        date: '2026-09-30',
        meals: { morning: { gaurav: 'taking' }, night: { gaurav: 'skip' } },
        revision: 2,
        changes: [{ actorRole: 'superadmin', changedAt: new Date('2026-09-30T04:00:00.000Z') }],
      },
      {
        date: '2026-10-01',
        meals: { morning: { gaurav: 'taking' }, night: { gaurav: 'taking' } },
        revision: 3,
        changes: [],
      },
    ]);
    await sourceConnection.db.collection('unexpected_legacy_ledger').insertOne({
      legacyId: 'legacy-1',
      amountPaise: 12_345,
      recordedAt: new Date('2026-09-29T12:00:00.000Z'),
    });
    await sourceConnection.db.collection('unexpected_legacy_ledger').createIndex(
      { legacyId: 1 },
      { name: 'legacy_id_unique', unique: true },
    );
  });

  after(async () => {
    await Promise.allSettled([
      sourceConnection?.close(),
      targetConnection?.close(),
    ]);
    if (replSet) await replSet.stop();
  });

  /** @returns {Promise<any>} */
  async function createTaskZeroBackup() {
    return createEncryptedBackup({
      dbConnection: sourceConnection,
      encryptionKey: ENCRYPTION_KEY,
      appVersion: '3.0.0-test',
      baselineReaders: {
        async readCalendarDay(date) {
          return { date, source: 'calendar-api', timezone: 'Asia/Kolkata' };
        },
        async readMonthlyCostReport(month) {
          return { month, roomAmountPaise: month === '2026-09' ? 5_000 : 12_000 };
        },
      },
    });
  }

  test('discovers every collection and index and captures stable read-only baselines', async () => {
    const sourceUnknownCount = await sourceConnection.db
      .collection('unexpected_legacy_ledger')
      .countDocuments();

    const backup = await createTaskZeroBackup();
    const manifest = backup.manifest;
    const collectionCounts = /** @type {Record<string, number>} */ (manifest.collections);
    const collectionMetadata = /** @type {Record<string, any>} */ (manifest.collectionMetadata);
    const baselineMetadata = /** @type {any} */ (manifest.baselines);
    const { serializedPackage } = backup;

    assert.equal(collectionCounts['unexpected_legacy_ledger'], 1);
    assert.equal(collectionMetadata['unexpected_legacy_ledger'].count, 1);
    assert.match(
      collectionMetadata['unexpected_legacy_ledger'].sha256Checksum,
      /^[a-f0-9]{64}$/,
    );
    assert.deepEqual(
      collectionMetadata['unexpected_legacy_ledger'].indexes,
      [{ name: 'legacy_id_unique', key: { legacyId: 1 }, unique: true }],
    );
    assert.deepEqual(
      Object.keys(collectionMetadata['unexpected_legacy_ledger'].samples[0]),
      ['sha256Checksum'],
    );
    assert.ok(baselineMetadata);
    assert.match(baselineMetadata.sha256Checksum, /^[a-f0-9]{64}$/);
    assert.equal(baselineMetadata.calendarDayCount, 2);
    assert.equal(baselineMetadata.monthlyCostReportCount, 2);

    const verified = /** @type {any} */ (verifyAndDecryptBackup({
      backupPackageString: serializedPackage,
      encryptionKey: ENCRYPTION_KEY,
    }));
    assert.equal(verified.rawData.unexpected_legacy_ledger[0].legacyId, 'legacy-1');
    assert.deepEqual(
      verified.baselines.calendarDays.map((entry) => entry.date),
      ['2026-09-30', '2026-10-01'],
    );
    assert.deepEqual(
      verified.baselines.monthlyCostReports.map((entry) => entry.month),
      ['2026-09', '2026-10'],
    );
    assert.equal(
      await sourceConnection.db.collection('unexpected_legacy_ledger').countDocuments(),
      sourceUnknownCount,
    );
  });

  test('restores every discovered document and secondary index and verifies the target', async () => {
    const { serializedPackage } = await createTaskZeroBackup();

    const restored = /** @type {any} */ (await restoreDatabase({
      backupPackageString: serializedPackage,
      encryptionKey: ENCRYPTION_KEY,
      sourceDbConnection: sourceConnection,
      targetDbConnection: targetConnection,
      dropExisting: true,
    }));

    const restoredCounts = /** @type {Record<string, number>} */ (restored.restoredCounts);
    assert.equal(restoredCounts['unexpected_legacy_ledger'], 1);
    assert.equal(restored.verification.passed, true);
    assert.deepEqual(restored.verification.issues, []);
    assert.equal(
      await targetConnection.db.collection('unexpected_legacy_ledger').countDocuments(),
      1,
    );
    const targetIndexes = await targetConnection.db
      .collection('unexpected_legacy_ledger')
      .indexes();
    assert.deepEqual(
      targetIndexes
        .filter((index) => index.name !== '_id_')
        .map(({ name, key, unique }) => ({ name, key, unique })),
      [{ name: 'legacy_id_unique', key: { legacyId: 1 }, unique: true }],
    );
  });

  test('rejects a source database used as its own restore target before writing', async () => {
    const { serializedPackage } = await createTaskZeroBackup();
    const sourceMealCount = await sourceConnection.db.collection('meal_days').countDocuments();

    await assert.rejects(
      restoreDatabase({
        backupPackageString: serializedPackage,
        encryptionKey: ENCRYPTION_KEY,
        sourceDbConnection: sourceConnection,
        targetDbConnection: sourceConnection,
        dropExisting: true,
      }),
      /source and restore target databases must be different/i,
    );

    assert.equal(
      await sourceConnection.db.collection('meal_days').countDocuments(),
      sourceMealCount,
    );
  });

  test('treats alternate credentials and connection options as the same database target', () => {
    assert.throws(
      () => assertDistinctDatabaseUris({
        sourceUri: 'mongodb+srv://source-user:source-pass@cluster.example.test/mealkhata?retryWrites=true&w=majority',
        targetUri: 'mongodb+srv://restore-user:restore-pass@cluster.example.test/mealkhata?w=majority&retryWrites=false',
      }),
      /source and restore target databases must be different/i,
    );

    assert.doesNotThrow(() => assertDistinctDatabaseUris({
      sourceUri: 'mongodb://localhost:27017/mealkhata_source',
      targetUri: 'mongodb://localhost:27017/mealkhata_restore',
    }));
  });

  test('rejects an unexpected nonempty target before restoring any document', async () => {
    await targetConnection.db.dropDatabase();
    await targetConnection.db.collection('unrelated_target_data').insertOne({ keep: true });
    const { serializedPackage } = await createTaskZeroBackup();

    await assert.rejects(
      restoreDatabase({
        backupPackageString: serializedPackage,
        encryptionKey: ENCRYPTION_KEY,
        sourceDbConnection: sourceConnection,
        targetDbConnection: targetConnection,
      }),
      /restore target database is not empty/i,
    );

    assert.equal(
      await targetConnection.db.collection('unrelated_target_data').countDocuments(),
      1,
    );
    assert.equal(await targetConnection.db.collection('meal_days').countDocuments(), 0);
  });

  test('documents backup commands without credentials or database access', () => {
    const scripts = /** @type {Array<{script: string, expectedHelp: RegExp}>} */ ([
      { script: 'backupDatabase.js', expectedHelp: /create an encrypted archive/i },
      { script: 'verifyBackup.js', expectedHelp: /verify an encrypted archive/i },
      { script: 'restoreDatabase.js', expectedHelp: /restore into an explicit disposable database/i },
    ]);

    for (const { script, expectedHelp } of scripts) {
      const result = spawnSync(process.execPath, [`scripts/${script}`, '--help'], {
        cwd: backendDirectory,
        encoding: 'utf8',
        env: {
          ...process.env,
          BACKUP_ENCRYPTION_KEY: '',
          MONGODB_URI: '',
          RESTORE_MONGODB_URI: '',
        },
      });

      assert.equal(result.status, 0, `${script}: ${result.stderr || result.stdout}`);
      assert.match(`${result.stdout}\n${result.stderr}`, expectedHelp);
    }
  });
});
