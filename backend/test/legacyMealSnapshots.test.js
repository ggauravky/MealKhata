import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { PRESET_NAMES } from '../src/meals/plateAllocation.constants.js';
import { createPresetAllocation } from '../src/meals/plateAllocation.service.js';
import {
  buildLegacyMealSnapshot,
  createLegacyMealSnapshotService,
} from '../src/migrations/legacyMealSnapshot.service.js';
import { createMealHistorySnapshotModel } from '../src/meals/mealHistorySnapshot.model.js';
import { createMealHistorySnapshotRepository } from '../src/meals/mealHistorySnapshot.repository.js';
import {
  parseLegacySnapshotArgs,
  validateLegacySnapshotConnections,
} from '../scripts/captureLegacyMealSnapshots.js';

const MEMBER_IDS = ['gaurav', 'nikhil', 'devansh'];
const STATUS = Object.freeze({
  taking: Object.freeze({ gaurav: 'taking', nikhil: 'taking', devansh: 'taking' }),
  skip: Object.freeze({ gaurav: 'skip', nikhil: 'skip', devansh: 'skip' }),
});

function legacyDay({
  date = '2026-10-20',
  allocation = createPresetAllocation(PRESET_NAMES.ONE_PLATE_THREE_SHARED),
  revision = 7,
} = {}) {
  return {
    _id: new mongoose.Types.ObjectId('6716f2c8869f4d5f5b5d0001'),
    date,
    meals: { morning: { ...STATUS.taking }, night: { ...STATUS.skip } },
    allocations: { morning: allocation, night: null },
    priceOverrides: {
      morning: { pricePaise: 100, reason: 'Verified legacy rate' },
      night: null,
    },
    revision,
    changes: [{
      changedAt: new Date('2026-10-20T04:30:00.000Z'),
      actorRole: 'retired-importer',
      actorMemberId: 'legacy-operator',
      mealType: 'morning',
      memberId: 'gaurav',
      from: 'not_set',
      to: 'taking',
    }],
    allocationChanges: [{
      changedAt: new Date('2026-10-20T04:35:00.000Z'),
      actorRole: null,
      actorMemberId: null,
      mealType: 'morning',
      changeType: 'set',
      from: null,
      to: allocation,
      reason: 'Legacy sharing record',
    }],
    priceChanges: [{
      changedAt: new Date('2026-10-20T04:40:00.000Z'),
      actorRole: 'superadmin',
      actorMemberId: null,
      mealType: 'morning',
      changeType: 'set',
      fromOverridePricePaise: null,
      toOverridePricePaise: 100,
      reason: 'Verified legacy rate',
    }],
    createdAt: new Date('2026-10-20T04:00:00.000Z'),
    updatedAt: new Date('2026-10-20T04:40:00.000Z'),
  };
}

const PRESET_CASES = [
  {
    name: PRESET_NAMES.INDIVIDUAL,
    options: { members: MEMBER_IDS },
    plates: 3,
    units: { gaurav: 6, nikhil: 6, devansh: 6 },
    amounts: { gaurav: 100, nikhil: 100, devansh: 100 },
  },
  {
    name: PRESET_NAMES.ONE_PLATE_TWO_SHARED,
    options: { members: ['gaurav', 'nikhil'] },
    plates: 1,
    units: { gaurav: 3, nikhil: 3, devansh: 0 },
    amounts: { gaurav: 50, nikhil: 50, devansh: 0 },
  },
  {
    name: PRESET_NAMES.ONE_PLATE_THREE_SHARED,
    options: {},
    plates: 1,
    units: { gaurav: 2, nikhil: 2, devansh: 2 },
    amounts: { gaurav: 33, nikhil: 34, devansh: 33 },
  },
  {
    name: PRESET_NAMES.TWO_PLATES_THREE_EQUAL,
    options: {},
    plates: 2,
    units: { gaurav: 4, nikhil: 4, devansh: 4 },
    amounts: { gaurav: 66, nikhil: 67, devansh: 67 },
  },
  {
    name: PRESET_NAMES.TWO_PLATES_ONE_FULL_TWO_HALF,
    options: { fullMemberId: 'gaurav' },
    plates: 2,
    units: { gaurav: 6, nikhil: 3, devansh: 3 },
    amounts: { gaurav: 100, nikhil: 50, devansh: 50 },
  },
  {
    name: PRESET_NAMES.THREE_PLATES_THREE_FULL,
    options: {},
    plates: 3,
    units: { gaurav: 6, nikhil: 6, devansh: 6 },
    amounts: { gaurav: 100, nikhil: 100, devansh: 100 },
  },
];

describe('legacy meal snapshot normalization', () => {
  test('freezes every legacy plate preset with exact prices, share units, and remainder rotation', () => {
    for (const fixture of PRESET_CASES) {
      const source = legacyDay({
        allocation: createPresetAllocation(fixture.name, fixture.options),
      });
      const snapshot = buildLegacyMealSnapshot(source);

      assert.equal(snapshot.calculationVersion, 'legacy-v2', fixture.name);
      assert.deepEqual(snapshot.participantOrder, MEMBER_IDS, fixture.name);
      assert.equal(snapshot.allocations.morning.physicalPlates, fixture.plates, fixture.name);
      assert.deepEqual(snapshot.allocations.morning.shareUnits, fixture.units, fixture.name);
      assert.deepEqual(snapshot.costs.morning.memberAmountsPaise, fixture.amounts, fixture.name);
      assert.equal(snapshot.costs.morning.roomAmountPaise, fixture.plates * 100, fixture.name);
      assert.equal(snapshot.pricing.morning.defaultPricePaise, 5000, fixture.name);
      assert.equal(snapshot.pricing.morning.effectivePricePaise, 100, fixture.name);
      assert.equal(snapshot.pricing.morning.isOverridden, true, fixture.name);
      assert.equal(snapshot.costs.night.roomAmountPaise, 0, fixture.name);
    }
  });

  test('captures revision and allow-listed audit facts while normalizing unknown actors', () => {
    const snapshot = buildLegacyMealSnapshot(legacyDay());

    assert.match(snapshot.sourceChecksum, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.sourceRevision, 7);
    assert.deepEqual(snapshot.statuses.morning, STATUS.taking);
    assert.deepEqual(snapshot.audit.statusChanges[0], {
      changedAt: '2026-10-20T04:30:00.000Z',
      actorRole: 'unknown',
      actorStudentId: 'legacy-operator',
      mealType: 'morning',
      studentId: 'gaurav',
      from: 'not_set',
      to: 'taking',
    });
    assert.equal(snapshot.audit.allocationChanges[0].actorRole, 'unknown');
    assert.equal(snapshot.audit.priceChanges[0].actorRole, 'superadmin');
    assert.equal(snapshot.sourceCreatedAt, '2026-10-20T04:00:00.000Z');
    assert.equal(snapshot.sourceUpdatedAt, '2026-10-20T04:40:00.000Z');
    assert.equal(Object.hasOwn(snapshot, '_id'), false);
  });

  test('produces a deterministic checksum without mutating the raw source document', () => {
    const source = legacyDay();
    const before = JSON.stringify(source);
    const reordered = {
      updatedAt: source.updatedAt,
      createdAt: source.createdAt,
      priceChanges: source.priceChanges,
      allocationChanges: source.allocationChanges,
      changes: source.changes,
      revision: source.revision,
      priceOverrides: source.priceOverrides,
      allocations: source.allocations,
      meals: source.meals,
      date: source.date,
      _id: source._id,
    };

    const first = buildLegacyMealSnapshot(source);
    const second = buildLegacyMealSnapshot(reordered);

    assert.equal(first.sourceChecksum, second.sourceChecksum);
    assert.equal(JSON.stringify(source), before);
  });

  test('fails closed when a legacy identity map contains an unknown student key', () => {
    const source = legacyDay();
    source.meals.morning.unrecognizedStudent = 'taking';

    assert.throws(() => buildLegacyMealSnapshot(source), /unknown legacy student key/i);
  });
});

describe('legacy meal snapshot persistence and verification', () => {
  let replSet;
  let targetConnection;
  let SnapshotModel;
  let snapshots;

  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    targetConnection = await mongoose.createConnection(replSet.getUri('legacy_snapshot_target')).asPromise();
    SnapshotModel = createMealHistorySnapshotModel(targetConnection);
    await SnapshotModel.init();
    snapshots = createMealHistorySnapshotRepository({ model: SnapshotModel });
  });

  after(async () => {
    await targetConnection?.close();
    await replSet?.stop();
  });

  test('strict persistence rejects unknown fields and stores one immutable verified snapshot', async () => {
    const snapshot = buildLegacyMealSnapshot(legacyDay());

    await assert.rejects(
      SnapshotModel.create({ ...snapshot, passwordHash: 'must-not-persist' }),
      /strict|passwordHash/i,
    );
    const stored = await snapshots.create(snapshot);
    assert.equal(stored.date, '2026-10-20');
    assert.equal(stored.sourceChecksum, snapshot.sourceChecksum);
    assert.equal(await SnapshotModel.countDocuments(), 1);
  });

  test('capture is idempotent, dry-run is read-only, and verify detects exact target drift', async () => {
    await SnapshotModel.deleteMany({});
    const sourceDay = legacyDay();
    let sourceReads = 0;
    const source = {
      async listLegacyMealDays() {
        sourceReads += 1;
        return [structuredClone(sourceDay)];
      },
    };
    const service = createLegacyMealSnapshotService({ source, snapshots });

    const dryRun = await service.capture({ dryRun: true });
    assert.deepEqual(dryRun, { sourceCount: 1, createdCount: 0, reusedCount: 0, verifiedCount: 0, dryRun: true });
    assert.equal(await SnapshotModel.countDocuments(), 0);

    const first = await service.capture();
    assert.deepEqual(first, { sourceCount: 1, createdCount: 1, reusedCount: 0, verifiedCount: 0, dryRun: false });
    const replay = await service.capture();
    assert.deepEqual(replay, { sourceCount: 1, createdCount: 0, reusedCount: 1, verifiedCount: 0, dryRun: false });
    const verified = await service.capture({ verify: true });
    assert.deepEqual(verified, { sourceCount: 1, createdCount: 0, reusedCount: 0, verifiedCount: 1, dryRun: false });
    assert.equal(sourceReads, 4);
    assert.equal(await SnapshotModel.countDocuments(), 1);

    await SnapshotModel.updateOne(
      { date: sourceDay.date },
      { $inc: { 'costs.morning.roomAmountPaise': 1 } },
    );
    await assert.rejects(service.capture({ verify: true }), /exact snapshot verification mismatch/i);
  });

  test('capture stops on an existing source checksum mismatch instead of overwriting history', async () => {
    await SnapshotModel.deleteMany({});
    const original = legacyDay();
    const sourceState = [original];
    const service = createLegacyMealSnapshotService({
      source: { listLegacyMealDays: async () => structuredClone(sourceState) },
      snapshots,
    });
    await service.capture();
    sourceState[0] = legacyDay({ revision: 8 });

    await assert.rejects(service.capture(), /source checksum mismatch/i);
    const [stored] = await snapshots.listByVersion('legacy-v2');
    assert.equal(stored.sourceRevision, 7);
  });

  test('verification fails closed when the target snapshot count differs from the source', async () => {
    await SnapshotModel.deleteMany({});
    const service = createLegacyMealSnapshotService({
      source: { listLegacyMealDays: async () => [legacyDay()] },
      snapshots,
    });

    await assert.rejects(service.capture({ verify: true }), /snapshot count mismatch/i);
  });
});

describe('legacy snapshot CLI safety', () => {
  test('requires an explicit target database and parses dry-run/verify modes', () => {
    assert.throws(() => parseLegacySnapshotArgs([]), /--target-db/i);
    assert.throws(() => parseLegacySnapshotArgs(['--target-db']), /value/i);
    assert.deepEqual(parseLegacySnapshotArgs([
      '--target-db',
      'mongodb://127.0.0.1:27017/mealkhata-snapshot-target',
      '--dry-run',
      '--verify',
    ]), {
      targetUri: 'mongodb://127.0.0.1:27017/mealkhata-snapshot-target',
      dryRun: true,
      verify: true,
    });
  });

  test('rejects source and target connections that resolve to the same database', () => {
    assert.throws(() => validateLegacySnapshotConnections({
      sourceUri: 'mongodb://127.0.0.1:27017/mealkhata?retryWrites=true',
      targetUri: 'mongodb://127.0.0.1:27017/mealkhata?retryWrites=false',
    }), /different databases/i);
  });

  test('requires an explicitly classified local snapshot target, regardless of database name', () => {
    const sourceUri = 'mongodb://127.0.0.1:27017/source';
    const targetUri = 'mongodb://127.0.0.1:27017/mealkhata-snapshot-target';
    assert.throws(() => validateLegacySnapshotConnections({ sourceUri, targetUri }), /isolated-test/i);
    assert.throws(() => validateLegacySnapshotConnections({ sourceUri,
      targetUri: 'mongodb+srv://atlas.example.test/mealkhata-snapshot-target',
      targetClassification: 'isolated-test' }), /local/i);
    assert.doesNotThrow(() => validateLegacySnapshotConnections({ sourceUri, targetUri,
      targetClassification: 'isolated-test' }));
  });
});
