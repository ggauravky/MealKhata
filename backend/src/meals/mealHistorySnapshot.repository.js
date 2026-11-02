import { MealHistorySnapshot } from './mealHistorySnapshot.model.js';

function detached(document) {
  if (!document) return null;
  return typeof document.toObject === 'function'
    ? document.toObject({ depopulate: true })
    : structuredClone(document);
}

export function createMealHistorySnapshotRepository({ model = MealHistorySnapshot } = {}) {
  return Object.freeze({
    async create(snapshot) {
      const created = await model.create(snapshot);
      return detached(created);
    },

    async findByDateAndVersion(date, calculationVersion) {
      return model.findOne({ date, calculationVersion }).lean().exec();
    },

    async listByVersion(calculationVersion) {
      return model.find({ calculationVersion }).sort({ date: 1 }).lean().exec();
    },
  });
}

export const mealHistorySnapshotRepository = createMealHistorySnapshotRepository();
