import { MealDay } from './meal.model.js';
import { guardFinancialMutation } from '../finance/financialMutationGuard.js';
import { runFinancialTransaction } from '../finance/financialTransaction.js';

function toPlainObject(document) {
  return document?.toObject ? document.toObject() : document;
}

export const mealRepository = Object.freeze({
  async executeFinancialMutation({ date, memberIds, actorRole }, work) {
    return runFinancialTransaction(
      async (session) => work({
        session,
        guard: () => guardFinancialMutation({
          memberIds,
          effectiveDate: date,
          actorRole,
          session,
        }),
      }),
      { retryOnDuplicateKey: true },
    );
  },

  async findByDate(date, { session } = {}) {
    const q = MealDay.findOne({ date });
    if (session) q.session(session);
    return q.lean().exec();
  },

  async findInDateRange(startDate, endDate) {
    return MealDay.find({ date: { $gte: startDate, $lte: endDate } })
      .select({ date: 1, meals: 1, allocations: 1, priceOverrides: 1, revision: 1, updatedAt: 1, _id: 0 })
      .lean()
      .exec();
  },

  async create(day, { session } = {}) {
    if (session) {
      const [document] = await MealDay.create([day], { session });
      return toPlainObject(document);
    }
    return toPlainObject(await MealDay.create(day));
  },

  async updateIfCurrent({ date, path, from, to, revision, change }, { session } = {}) {
    return MealDay.findOneAndUpdate(
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

    return MealDay.findOneAndUpdate(
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
    const $set = {
      [`allocations.${mealType}`]: allocation,
    };

    if (derivedStatuses) {
      for (const [memberId, status] of Object.entries(derivedStatuses)) {
        $set[`meals.${mealType}.${memberId}`] = status;
      }
    }

    return MealDay.findOneAndUpdate(
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
    return MealDay.findOneAndUpdate(
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
    return MealDay.findOneAndUpdate(
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
    return MealDay.findOneAndUpdate(
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
