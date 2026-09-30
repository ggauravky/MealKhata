import { env } from '../config/env.js';
import { HttpError } from '../utils/HttpError.js';
import { DEFAULT_MEAL_STATUS, getMealPath } from './meal.constants.js';
import { createDefaultMealDay } from './meal.defaults.js';
import { mealRepository } from './meal.repository.js';
import { serializeHistory, serializeMealDay } from './meal.serializer.js';

const MAX_CONCURRENT_RETRIES = 12;

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

export function createMealService({ repository = mealRepository, timezone = env.appTimezone } = {}) {
  return Object.freeze({
    async getDay(date) {
      try {
        const document = await repository.findByDate(date);
        return serializeMealDay(document, date, { timezone });
      } catch (error) {
        throw new HttpError(503, 'Meal data is temporarily unavailable.', { cause: error });
      }
    },

    async getHistory(date, limit) {
      try {
        const document = await repository.findByDate(date);
        return serializeHistory(document, date, limit);
      } catch (error) {
        throw new HttpError(503, 'Meal history is temporarily unavailable.', { cause: error });
      }
    },

    async changeStatus({ date, mealType, memberId, status, actorRole, actorMemberId = null, changedAt = new Date() }) {
      const path = getMealPath(mealType, memberId);

      if (!path) {
        throw new TypeError('A fixed meal path is required');
      }

      try {
        for (let attempt = 0; attempt < MAX_CONCURRENT_RETRIES; attempt += 1) {
          const currentDocument = await repository.findByDate(date);
          const currentStatus = currentDocument?.meals?.[mealType]?.[memberId] ?? DEFAULT_MEAL_STATUS;

          if (currentStatus === status) {
            return {
              changed: false,
              data: serializeMealDay(currentDocument, date, { timezone }),
            };
          }

          const change = {
            changedAt,
            actorRole,
            actorMemberId: actorMemberId ?? null,
            mealType,
            memberId,
            from: currentStatus,
            to: status,
          };

          if (!currentDocument) {
            const newDocument = createDefaultMealDay(date);
            newDocument.meals[mealType][memberId] = status;
            newDocument.revision = 1;
            newDocument.changes.push(change);

            try {
              const created = await repository.create(newDocument);
              return {
                changed: true,
                data: serializeMealDay(created, date, { timezone }),
              };
            } catch (error) {
              if (isDuplicateKeyError(error)) {
                continue;
              }

              throw error;
            }
          }

          const updated = await repository.updateIfCurrent({
            date,
            path,
            from: currentStatus,
            to: status,
            revision: currentDocument.revision,
            change,
          });

          if (updated) {
            return {
              changed: true,
              data: serializeMealDay(updated, date, { timezone }),
            };
          }
        }

        throw new Error('Concurrent meal updates did not settle');
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }

        throw new HttpError(503, 'Unable to save the meal change. Please try again.', {
          cause: error,
        });
      }
    },
  });
}

export const mealService = createMealService();

