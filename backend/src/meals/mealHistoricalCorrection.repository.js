import { MealHistoricalCorrection } from './mealHistoricalCorrection.model.js';

export function createMealHistoricalCorrectionRepository({ model = MealHistoricalCorrection } = {}) {
  return Object.freeze({
    async listByDate(date, { session = null } = {}) {
      const query = model.find({ date }).sort({ revision: 1 }).lean();
      if (session) query.session(session);
      return query.exec();
    },
    async create(record, { session = null } = {}) {
      if (session) {
        const [created] = await model.create([record], { session });
        return created.toObject();
      }
      return (await model.create(record)).toObject();
    },
  });
}

export const mealHistoricalCorrectionRepository = createMealHistoricalCorrectionRepository();
