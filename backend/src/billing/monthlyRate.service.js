import { HttpError } from '../utils/HttpError.js';
import { monthlyRateRepository } from './monthlyRate.repository.js';
import { serializeMonthlyRate } from './monthlyRate.serializer.js';

export function createMonthlyRateService({ repository = monthlyRateRepository } = {}) {
  return Object.freeze({
    async getRate(month) {
      try {
        const doc = await repository.findByMonth(month);
        return serializeMonthlyRate(doc, month);
      } catch (error) {
        throw new HttpError(503, 'Meal rates are temporarily unavailable.', { cause: error });
      }
    },

    async updateRate() {
      throw new HttpError(405, 'Meal prices are fixed at ₹50 for Morning and ₹70 for Night.');
    },
  });
}

export const monthlyRateService = createMonthlyRateService();
