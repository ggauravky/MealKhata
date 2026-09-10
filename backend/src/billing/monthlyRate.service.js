import { HttpError } from '../utils/HttpError.js';
import { monthlyRateRepository } from './monthlyRate.repository.js';
import { serializeMonthlyRate } from './monthlyRate.serializer.js';

const MAX_RETRIES = 12;

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

function selectPrices(source) {
  return {
    morningPricePaise: source.morningPricePaise,
    nightPricePaise: source.nightPricePaise,
  };
}

export function createMonthlyRateService({ repository = monthlyRateRepository } = {}) {
  return Object.freeze({
    async getRate(month) {
      try {
        return serializeMonthlyRate(await repository.findByMonth(month), month);
      } catch (error) {
        throw new HttpError(503, 'Meal rates are temporarily unavailable.', { cause: error });
      }
    },

    async updateRate({ month, morningPricePaise, nightPricePaise, actorRole, changedAt = new Date() }) {
      const prices = { morningPricePaise, nightPricePaise };

      try {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
          const current = await repository.findByMonth(month);

          if (
            current &&
            current.morningPricePaise === morningPricePaise &&
            current.nightPricePaise === nightPricePaise
          ) {
            return { changed: false, data: serializeMonthlyRate(current, month) };
          }

          const change = {
            changedAt,
            actorRole,
            from: current ? selectPrices(current) : null,
            to: prices,
          };

          if (!current) {
            try {
              const created = await repository.create({
                month,
                ...prices,
                revision: 1,
                changes: [change],
              });
              return { changed: true, data: serializeMonthlyRate(created, month) };
            } catch (error) {
              if (isDuplicateKeyError(error)) {
                continue;
              }

              throw error;
            }
          }

          const updated = await repository.updateIfCurrent({ month, current, prices, change });

          if (updated) {
            return { changed: true, data: serializeMonthlyRate(updated, month) };
          }
        }

        throw new Error('Concurrent rate updates did not settle');
      } catch (error) {
        throw new HttpError(503, 'Unable to save meal rates. Please try again.', { cause: error });
      }
    },
  });
}

export const monthlyRateService = createMonthlyRateService();

