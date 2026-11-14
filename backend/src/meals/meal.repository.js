import { MealDay } from './meal.model.js';
import { guardFinancialMutation } from '../finance/financialMutationGuard.js';
import { runFinancialTransaction } from '../finance/financialTransaction.js';
import { studentResolver } from '../students/studentResolver.service.js';
import { assertSafeStudentId } from '../students/studentId.js';
import {
  extractMealParticipantIds,
  normalizeParticipantIds,
  toPlainMealValue,
  validateStudentKeyedRecord,
} from './mealParticipants.js';

function toPlainObject(document) {
  return toPlainMealValue(document);
}

function statusPathStudentId(path) {
  const match = /^meals\.(morning|night)\.(.+)$/.exec(path);
  if (!match) throw new TypeError('Meal status path must target one safe student identity');
  return assertSafeStudentId(match[2]);
}

async function assertKnownParticipants(day, resolver) {
  if (day?.schemaVersion !== 3) return;
  const ordered = normalizeParticipantIds(day.participantOrder ?? extractMealParticipantIds(day));
  const allowed = new Set(ordered);
  for (const mealType of ['morning', 'night']) {
    validateStudentKeyedRecord(day.meals?.[mealType], `meals.${mealType}`);
    for (const studentId of Object.keys(day.meals?.[mealType] ?? {})) {
      if (!allowed.has(studentId)) throw new TypeError(`Meal status contains an unrecorded student: ${studentId}`);
    }
    for (const plate of day.allocations?.[mealType]?.plates ?? []) {
      validateStudentKeyedRecord(plate?.shares, `allocations.${mealType}.shares`);
      for (const studentId of Object.keys(plate?.shares ?? {})) {
        if (!allowed.has(studentId)) throw new TypeError(`Meal allocation contains an unrecorded student: ${studentId}`);
      }
    }
  }
  for (const studentId of ordered) await resolver.assertKnown(studentId);
}

async function assertKnownStatusPath(path, resolver) {
  const studentId = statusPathStudentId(path);
  await resolver.assertKnown(studentId);
  return studentId;
}

export function createMealRepository({ model = MealDay, resolver = studentResolver } = {}) {
  return Object.freeze({
  async executeFinancialMutation({ date, memberIds, actorRole }, work) {
    return runFinancialTransaction(
      async (session) => work({
        session,
        guard: ({ memberIds: currentMemberIds = memberIds } = {}) => guardFinancialMutation({
          memberIds: currentMemberIds,
          effectiveDate: date,
          actorRole,
          session,
        }),
      }),
      { retryOnDuplicateKey: true, maxRetries: 12 },
    );
  },

  async findByDate(date, { session } = {}) {
    const q = model.findOne({ date });
    if (session) q.session(session);
    return q.lean().exec();
  },

  async findInDateRange(startDate, endDate) {
    return model.find({ date: { $gte: startDate, $lte: endDate } })
      .select({ date: 1, schemaVersion: 1, participantOrder: 1, financialClassification: 1, cutoverClassificationSource: 1, importedFromLegacy: 1, meals: 1, allocations: 1, priceOverrides: 1, revision: 1, changes: 1, allocationChanges: 1, priceChanges: 1, createdAt: 1, updatedAt: 1, _id: 0 })
      .lean()
      .exec();
  },

  async create(day, { session } = {}) {
    const newDay = { ...toPlainMealValue(day), schemaVersion: 3 };
    await assertKnownParticipants(newDay, resolver);
    if (session) {
      const [document] = await model.create([newDay], { session });
      return toPlainObject(document);
    }
    return toPlainObject(await model.create(newDay));
  },

  async updateIfCurrent({ date, path, from, to, revision, change }, { session } = {}) {
    await assertKnownStatusPath(path, resolver);
    return model.findOneAndUpdate(
      { date, revision, [path]: from },
      {
        $set: { [path]: to },
        $inc: { revision: 1 },
        $push: { changes: change },
      },
      { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) },
    )
      .lean()
      .exec();
  },

  async updateMealStatusWithAllocationReset({
    date,
    path,
    fromStatus,
    toStatus,
    mealType,
    revision,
    statusChange,
    allocationResetChange,
  }, { session } = {}) {
    await assertKnownStatusPath(path, resolver);
    const update = {
      $set: {
        [path]: toStatus,
        [`allocations.${mealType}`]: null,
      },
      $inc: { revision: 1 },
      $push: { changes: statusChange },
    };

    if (allocationResetChange) {
      update.$push.allocationChanges = allocationResetChange;
    }

    return model.findOneAndUpdate(
      { date, revision, [path]: fromStatus },
      update,
      { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) },
    )
      .lean()
      .exec();
  },

  async updateAllocationIfCurrent({
    date,
    mealType,
    allocation,
    derivedStatuses,
    revision,
    allocationChange,
  }, { session } = {}) {
    await assertKnownParticipants({
      schemaVersion: 3,
      meals: { morning: {}, night: {}, [mealType]: derivedStatuses ?? {} },
      allocations: { morning: null, night: null, [mealType]: allocation },
    }, resolver);
    const $set = {
      [`allocations.${mealType}`]: allocation,
    };

    if (derivedStatuses) {
      for (const [memberId, status] of Object.entries(derivedStatuses)) {
        $set[`meals.${mealType}.${memberId}`] = status;
      }
    }

    return model.findOneAndUpdate(
      { date, revision },
      {
        $set,
        $inc: { revision: 1 },
        $push: { allocationChanges: allocationChange },
      },
      { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) },
    )
      .lean()
      .exec();
  },

  async clearAllocationIfCurrent({ date, mealType, revision, allocationChange }, { session } = {}) {
    return model.findOneAndUpdate(
      { date, revision },
      {
        $set: { [`allocations.${mealType}`]: null },
        $inc: { revision: 1 },
        $push: { allocationChanges: allocationChange },
      },
      { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) },
    )
      .lean()
      .exec();
  },

  async updatePriceOverrideIfCurrent({ date, mealType, priceOverride, revision, priceChange }, { session } = {}) {
    return model.findOneAndUpdate(
      { date, revision },
      {
        $set: { [`priceOverrides.${mealType}`]: priceOverride },
        $inc: { revision: 1 },
        $push: { priceChanges: priceChange },
      },
      { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) },
    )
      .lean()
      .exec();
  },

  async clearPriceOverrideIfCurrent({ date, mealType, revision, priceChange }, { session } = {}) {
    return model.findOneAndUpdate(
      { date, revision },
      {
        $set: { [`priceOverrides.${mealType}`]: null },
        $inc: { revision: 1 },
        $push: { priceChanges: priceChange },
      },
      { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) },
    )
      .lean()
      .exec();
  },
  });
}

export const mealRepository = createMealRepository();
