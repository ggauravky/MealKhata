import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { createDefaultMealDay } from '../src/meals/meal.defaults.js';
import { MealDay } from '../src/meals/meal.model.js';
import { mealRepository } from '../src/meals/meal.repository.js';
import { serializeHistory, serializeMealDay } from '../src/meals/meal.serializer.js';
import { Student } from '../src/students/student.model.js';

const FOURTH_STUDENT_ID = 'student_0123456789abcdef0123456789abcdef';
const KNOWN_STUDENT_IDS = ['gaurav', 'nikhil', 'devansh', FOURTH_STUDENT_ID];

async function seedKnownStudents() {
  await Student.insertMany(KNOWN_STUDENT_IDS.map((studentId, rosterOrder) => ({
    studentId,
    displayName: studentId,
    status: 'ACTIVE',
    mealEligibilityFrom: '2026-10-01',
    rosterOrder,
  })));
}

describe('Task 8 dynamic meal repository', () => {
  let replSet;

  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri('dynamic_meal_repository'));
    await Promise.all([MealDay.init(), Student.init()]);
  });

  beforeEach(async () => {
    await Promise.all([MealDay.deleteMany({}), Student.deleteMany({})]);
    await seedKnownStudents();
  });

  after(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  test('persists and reads a fourth student without returning Mongoose Maps', async () => {
    const day = {
      ...createDefaultMealDay('2026-11-02', KNOWN_STUDENT_IDS),
      allocations: {
        morning: {
          mode: 'custom',
          plates: [{ shares: { gaurav: 3, [FOURTH_STUDENT_ID]: 3 } }],
        },
        night: null,
      },
    };

    const created = await mealRepository.create(day);
    const found = await mealRepository.findByDate(day.date);

    assert.equal(created.meals.morning instanceof Map, false);
    assert.equal(created.allocations.morning.plates[0].shares instanceof Map, false);
    assert.equal(created.meals.morning[FOURTH_STUDENT_ID], 'not_set');
    assert.equal(found.meals.morning[FOURTH_STUDENT_ID], 'not_set');
    assert.equal(found.allocations.morning.plates[0].shares[FOURTH_STUDENT_ID], 3);
  });

  test('validates new v3 participant identities through the canonical student resolver', async () => {
    const unknownId = 'student_unknown';
    const day = createDefaultMealDay('2026-11-03', ['gaurav', unknownId]);

    await assert.rejects(mealRepository.create(day), /student was not found/i);
    assert.equal(await MealDay.countDocuments(), 0);
  });

  test('cannot bypass canonical identity validation by omitting schemaVersion on a new write', async () => {
    const day = createDefaultMealDay('2026-11-03', ['gaurav', 'student_unknown']);
    delete day.schemaVersion;

    await assert.rejects(mealRepository.create(day), /student was not found/i);
    assert.equal(await MealDay.countDocuments(), 0);

    const knownDay = createDefaultMealDay('2026-11-03', ['gaurav']);
    delete knownDay.schemaVersion;
    const created = await mealRepository.create(knownDay);
    assert.equal(created.schemaVersion, 3);
  });

  test('optimistic updates preserve unrelated dynamic students and reject stale revisions', async () => {
    const day = createDefaultMealDay('2026-11-04', KNOWN_STUDENT_IDS);
    await mealRepository.create(day);
    const change = {
      changedAt: new Date('2026-11-04T03:00:00.000Z'),
      actorRole: 'member',
      actorMemberId: FOURTH_STUDENT_ID,
      mealType: 'morning',
      memberId: FOURTH_STUDENT_ID,
      from: 'not_set',
      to: 'taking',
    };

    const [fourthStudentUpdate, gauravUpdate] = await Promise.all([
      mealRepository.updateIfCurrent({
        date: day.date,
        path: `meals.morning.${FOURTH_STUDENT_ID}`,
        from: 'not_set',
        to: 'taking',
        revision: 0,
        change,
      }),
      mealRepository.updateIfCurrent({
        date: day.date,
        path: 'meals.morning.gaurav',
        from: 'not_set',
        to: 'skip',
        revision: 0,
        change: { ...change, actorMemberId: 'gaurav', memberId: 'gaurav', to: 'skip' },
      }),
    ]);
    const results = [fourthStudentUpdate, gauravUpdate];
    const [updated] = results.filter(Boolean);

    assert.equal(updated.revision, 1);
    assert.ok(
      updated.meals.morning[FOURTH_STUDENT_ID] === 'taking' || updated.meals.morning.gaurav === 'skip',
    );
    assert.equal(results.filter((result) => result === null).length, 1);
    const found = await mealRepository.findByDate(day.date);
    assert.equal(
      [found.meals.morning[FOURTH_STUDENT_ID], found.meals.morning.gaurav]
        .filter((status) => status !== 'not_set').length,
      1,
    );
    assert.equal(found.meals.morning.nikhil, 'not_set');
  });

  test('rejects unsafe update paths before MongoDB can interpret them', async () => {
    const day = createDefaultMealDay('2026-11-05', KNOWN_STUDENT_IDS);
    await mealRepository.create(day);

    await assert.rejects(mealRepository.updateIfCurrent({
      date: day.date,
      path: 'meals.morning.student.invalid',
      from: 'not_set',
      to: 'taking',
      revision: 0,
      change: {
        changedAt: new Date(),
        actorRole: 'member',
        actorMemberId: 'gaurav',
        mealType: 'morning',
        memberId: 'gaurav',
        from: 'not_set',
        to: 'taking',
      },
    }), /safe|path|student/i);
  });

  test('read-only legacy access preserves archived keys, unknown actors, prices, revisions, and timestamps', async () => {
    const archivedStudentId = 'student_archived';
    const createdAt = new Date('2026-10-02T03:00:00.000Z');
    const updatedAt = new Date('2026-10-02T05:00:00.000Z');
    await mongoose.connection.db.collection('meal_days').insertOne({
      date: '2026-10-02',
      meals: {
        morning: { gaurav: 'taking', [archivedStudentId]: 'taking' },
        night: { gaurav: 'skip', [archivedStudentId]: 'skip' },
      },
      allocations: {
        morning: {
          mode: 'custom',
          plates: [{ shares: { gaurav: 3, [archivedStudentId]: 3 } }],
        },
        night: null,
      },
      priceOverrides: {
        morning: { pricePaise: 4321, reason: 'Historical receipt' },
        night: null,
      },
      revision: 11,
      changes: [{
        changedAt: new Date('2026-10-02T04:00:00.000Z'),
        actorRole: 'retired-importer',
        actorMemberId: 'legacy-operator',
        mealType: 'morning',
        memberId: archivedStudentId,
        from: 'not_set',
        to: 'taking',
      }],
      allocationChanges: [],
      priceChanges: [],
      createdAt,
      updatedAt,
    });

    const found = await mealRepository.findByDate('2026-10-02');
    const day = serializeMealDay(found, found.date);
    const history = serializeHistory(found, found.date, 10);
    const rawAfterRead = await mongoose.connection.db.collection('meal_days').findOne({ date: found.date });

    assert.equal(Object.hasOwn(found, 'schemaVersion'), false);
    assert.equal(day.meals.morning[archivedStudentId], 'taking');
    assert.equal(day.allocations.morning.plates[0].shares[archivedStudentId], 3);
    assert.equal(day.pricing.morning.overridePricePaise, 4321);
    assert.equal(day.revision, 11);
    assert.equal(history.items[0].actorRole, 'retired-importer');
    assert.equal(history.items[0].actorMemberId, 'legacy-operator');
    assert.equal(rawAfterRead.createdAt.toISOString(), createdAt.toISOString());
    assert.equal(rawAfterRead.updatedAt.toISOString(), updatedAt.toISOString());
    assert.equal(Object.hasOwn(rawAfterRead, 'schemaVersion'), false);
  });
});
