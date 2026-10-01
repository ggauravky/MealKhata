import { MealDay } from './meal.model.js';

function toPlainObject(document) {
  return document?.toObject ? document.toObject() : document;
}

export const mealRepository = Object.freeze({
  async findByDate(date) {
    return MealDay.findOne({ date }).lean().exec();
  },

  async findInDateRange(startDate, endDate) {
    return MealDay.find({ date: { $gte: startDate, $lte: endDate } })
      .select({ date: 1, meals: 1, allocations: 1, revision: 1, updatedAt: 1, _id: 0 })
      .lean()
      .exec();
  },

  async create(day) {
    const document = await MealDay.create(day);
    return toPlainObject(document);
  },

  async updateIfCurrent({ date, path, from, to, revision, change }) {
    return MealDay.findOneAndUpdate(
      { date, revision, [path]: from },
      {
        $set: { [path]: to },
        $inc: { revision: 1 },
        $push: { changes: change },
      },
      { returnDocument: 'after', runValidators: true },
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
  }) {
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
      { returnDocument: 'after', runValidators: true },
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
  }) {
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
      { returnDocument: 'after', runValidators: true },
    )
      .lean()
      .exec();
  },

  async clearAllocationIfCurrent({ date, mealType, revision, allocationChange }) {
    return MealDay.findOneAndUpdate(
      { date, revision },
      {
        $set: { [`allocations.${mealType}`]: null },
        $inc: { revision: 1 },
        $push: { allocationChanges: allocationChange },
      },
      { returnDocument: 'after', runValidators: true },
    )
      .lean()
      .exec();
  },
});
