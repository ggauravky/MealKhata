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
      .select({ date: 1, meals: 1, revision: 1, updatedAt: 1, _id: 0 })
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
      { new: true, runValidators: true },
    )
      .lean()
      .exec();
  },
});
