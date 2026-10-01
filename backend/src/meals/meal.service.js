import { env } from '../config/env.js';
import { HttpError } from '../utils/HttpError.js';
import { DEFAULT_MEAL_STATUS, getMealPath } from './meal.constants.js';
import { createDefaultMealDay } from './meal.defaults.js';
import { mealRepository } from './meal.repository.js';
import { serializeHistory, serializeMealDay } from './meal.serializer.js';
import {
  deriveParticipationStatuses,
  validatePlateAllocation,
} from './plateAllocation.service.js';

const MAX_CONCURRENT_RETRIES = 12;

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

export function createMealService({
  repository = mealRepository,
  settlements = null,
  timezone = env.appTimezone,
} = {}) {
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

    async changeStatus({
      date,
      mealType,
      memberId,
      status,
      actorRole,
      actorMemberId = null,
      changedAt = new Date(),
    }) {
      if (settlements && (await settlements.isMonthClosed(date.slice(0, 7)))) {
        throw new HttpError(409, 'This month is closed. Reopen the month before changing meals.');
      }

      const path = getMealPath(mealType, memberId);

      if (!path) {
        throw new TypeError('A fixed meal path is required');
      }

      try {
        for (let attempt = 0; attempt < MAX_CONCURRENT_RETRIES; attempt += 1) {
          const currentDocument = await repository.findByDate(date);
          const currentStatus = currentDocument?.meals?.[mealType]?.[memberId] ?? DEFAULT_MEAL_STATUS;
          const currentAllocation = currentDocument?.allocations?.[mealType];
          const hasCustomAllocation = currentAllocation && currentAllocation.mode === 'custom';

          if (currentStatus === status) {
            return {
              changed: false,
              allocationReset: false,
              data: serializeMealDay(currentDocument, date, { timezone }),
            };
          }

          const statusChange = {
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
            newDocument.changes.push(statusChange);

            try {
              const created = await repository.create(newDocument);
              return {
                changed: true,
                allocationReset: false,
                data: serializeMealDay(created, date, { timezone }),
              };
            } catch (error) {
              if (isDuplicateKeyError(error)) {
                continue;
              }
              throw error;
            }
          }

          if (hasCustomAllocation) {
            const allocationResetChange = {
              changedAt,
              actorRole,
              actorMemberId: actorMemberId ?? null,
              mealType,
              changeType: 'reset_on_status_change',
              from: currentAllocation,
              to: null,
              reason: `Reset because ${memberId} changed status to ${status}`,
            };

            const updated = await repository.updateMealStatusWithAllocationReset({
              date,
              path,
              fromStatus: currentStatus,
              toStatus: status,
              mealType,
              revision: currentDocument.revision,
              statusChange,
              allocationResetChange,
            });

            if (updated) {
              return {
                changed: true,
                allocationReset: true,
                data: serializeMealDay(updated, date, { timezone }),
              };
            }
          } else {
            const updated = await repository.updateIfCurrent({
              date,
              path,
              from: currentStatus,
              to: status,
              revision: currentDocument.revision,
              change: statusChange,
            });

            if (updated) {
              return {
                changed: true,
                allocationReset: false,
                data: serializeMealDay(updated, date, { timezone }),
              };
            }
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

    async setAllocation({
      date,
      mealType,
      allocation,
      actorRole,
      actorMemberId = null,
      changedAt = new Date(),
    }) {
      if (settlements && (await settlements.isMonthClosed(date.slice(0, 7)))) {
        throw new HttpError(409, 'This month is closed. Reopen the month before changing plate allocation.');
      }

      const validatedAllocation = validatePlateAllocation(allocation);
      const derivedStatuses = deriveParticipationStatuses(validatedAllocation);

      try {
        for (let attempt = 0; attempt < MAX_CONCURRENT_RETRIES; attempt += 1) {
          const currentDocument = await repository.findByDate(date);
          const currentAllocation = currentDocument?.allocations?.[mealType] ?? null;

          const allocationChange = {
            changedAt,
            actorRole,
            actorMemberId: actorMemberId ?? null,
            mealType,
            changeType: 'set',
            from: currentAllocation,
            to: validatedAllocation,
            reason: null,
          };

          if (!currentDocument) {
            const newDocument = createDefaultMealDay(date);
            newDocument.allocations = {
              morning: null,
              night: null,
              [mealType]: validatedAllocation,
            };
            newDocument.meals[mealType] = derivedStatuses;
            newDocument.revision = 1;
            newDocument.allocationChanges = [allocationChange];

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

          const updated = await repository.updateAllocationIfCurrent({
            date,
            mealType,
            allocation: validatedAllocation,
            derivedStatuses,
            revision: currentDocument.revision,
            allocationChange,
          });

          if (updated) {
            return {
              changed: true,
              data: serializeMealDay(updated, date, { timezone }),
            };
          }
        }

        throw new Error('Concurrent allocation updates did not settle');
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }

        throw new HttpError(503, error.message || 'Unable to save plate allocation. Please try again.', {
          cause: error,
        });
      }
    },

    async clearAllocation({
      date,
      mealType,
      actorRole,
      actorMemberId = null,
      changedAt = new Date(),
    }) {
      if (settlements && (await settlements.isMonthClosed(date.slice(0, 7)))) {
        throw new HttpError(409, 'This month is closed. Reopen the month before changing plate allocation.');
      }

      try {
        for (let attempt = 0; attempt < MAX_CONCURRENT_RETRIES; attempt += 1) {
          const currentDocument = await repository.findByDate(date);
          const currentAllocation = currentDocument?.allocations?.[mealType] ?? null;

          if (!currentAllocation) {
            return {
              changed: false,
              data: serializeMealDay(currentDocument, date, { timezone }),
            };
          }

          const allocationChange = {
            changedAt,
            actorRole,
            actorMemberId: actorMemberId ?? null,
            mealType,
            changeType: 'clear',
            from: currentAllocation,
            to: null,
            reason: 'Reset to default individual plates',
          };

          const updated = await repository.clearAllocationIfCurrent({
            date,
            mealType,
            revision: currentDocument.revision,
            allocationChange,
          });

          if (updated) {
            return {
              changed: true,
              data: serializeMealDay(updated, date, { timezone }),
            };
          }
        }

        throw new Error('Concurrent allocation clears did not settle');
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }

        throw new HttpError(503, error.message || 'Unable to reset plate allocation. Please try again.', {
          cause: error,
        });
      }
    },
  });
}

export const mealService = createMealService();
