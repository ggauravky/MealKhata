import { MonthlyMealRate } from './monthlyRate.model.js';

function toPlainObject(document) {
  return document?.toObject ? document.toObject() : document;
}

export const monthlyRateRepository = Object.freeze({
  async findByMonth(month) {
    return MonthlyMealRate.findOne({ month }).lean().exec();
  },

  async create(rate) {
    const document = await MonthlyMealRate.create(rate);
    return toPlainObject(document);
  },

  async updateIfCurrent({ month, current, prices, change }) {
    return MonthlyMealRate.findOneAndUpdate(
      {
        month,
        revision: current.revision,
        morningPricePaise: current.morningPricePaise,
        nightPricePaise: current.nightPricePaise,
      },
      {
        $set: prices,
        $inc: { revision: 1 },
        $push: { changes: change },
      },
      { new: true, runValidators: true },
    )
      .lean()
      .exec();
  },
});

