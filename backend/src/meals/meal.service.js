import { env } from '../config/env.js';
import { isValidPricePaise } from '../billing/monthlyRate.constants.js';
import { isValidLogicalDate } from '../utils/date.js';
import { HttpError } from '../utils/HttpError.js';
import { DEFAULT_MEAL_STATUS, getMealPath, MEAL_TYPES } from './meal.constants.js';
import { createDefaultMealDay } from './meal.defaults.js';
import { mealRepository } from './meal.repository.js';
import { serializeHistory, serializeMealDay } from './meal.serializer.js';
import {
  deriveParticipationStatuses,
  validatePlateAllocation,
} from './plateAllocation.service.js';
import { stayRepository } from '../stays/stay.repository.js';
import { MEMBER_IDS } from '../config/members.js';

const MAX_CONCURRENT_RETRIES = 12;

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

async function assertMemberNotCheckedOut(memberId, date, stays) {
  if (!stays) return;
  const activeStay = typeof stays.getActiveStayForMember === 'function'
    ? await stays.getActiveStayForMember(memberId)
    : (typeof stays.findActiveStayForMember === 'function' ? await stays.findActiveStayForMember(memberId) : null);

  if (!activeStay) {
    const memberStays = typeof stays.listStaysForMember === 'function'
      ? await stays.listStaysForMember(memberId)
      : (typeof stays.findStaysByMember === 'function' ? await stays.findStaysByMember(memberId) : []);

    const checkedOutStays = (memberStays || []).filter((s) => s.status === 'CHECKED_OUT' && s.actualLeftOn);
    if (checkedOutStays.length > 0) {
      checkedOutStays.sort((a, b) => (b.actualLeftOn || '').localeCompare(a.actualLeftOn || ''));
      const lastStay = checkedOutStays[0];
      if (date > lastStay.actualLeftOn) {
        throw new HttpError(400, `Meal participation is blocked after hostel checkout on ${lastStay.actualLeftOn}.`);
      }
    }
  }
}

export function createMealService({
  repository = mealRepository,
  settlements = null,
  stays = null,
  timezone = env.appTimezone,
} = {}) {
  const runFinancialMutation = (date, actorRole, work) => {
    if (typeof repository.executeFinancialMutation === 'function') {
      return repository.executeFinancialMutation({ date, memberIds: MEMBER_IDS, actorRole }, work);
    }
    return work({ session: null, guard: async () => {} });
  };

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

      if (status === 'taking' && stays) {
        await assertMemberNotCheckedOut(memberId, date, stays);
      }

      const path = getMealPath(mealType, memberId);

      if (!path) {
        throw new TypeError('A fixed meal path is required');
      }

      try {
        return await runFinancialMutation(date, actorRole, async ({ session, guard }) => {
          for (let attempt = 0; attempt < MAX_CONCURRENT_RETRIES; attempt += 1) {
            const currentDocument = await repository.findByDate(date, { session });
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
              await guard();
              const created = await repository.create(newDocument, { session });
              return {
                changed: true,
                allocationReset: false,
                data: serializeMealDay(created, date, { timezone }),
              };
            } catch (error) {
              if (isDuplicateKeyError(error)) {
                if (session) throw error;
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

            await guard();
            const updated = await repository.updateMealStatusWithAllocationReset({
              date,
              path,
              fromStatus: currentStatus,
              toStatus: status,
              mealType,
              revision: currentDocument.revision,
              statusChange,
              allocationResetChange,
            }, { session });

            if (updated) {
              return {
                changed: true,
                allocationReset: true,
                data: serializeMealDay(updated, date, { timezone }),
              };
            }
          } else {
            await guard();
            const updated = await repository.updateIfCurrent({
              date,
              path,
              from: currentStatus,
              to: status,
              revision: currentDocument.revision,
              change: statusChange,
            }, { session });

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
        });
      } catch (error) {
        if (error instanceof HttpError || error.statusCode) {
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

      if (stays && validatedAllocation.plates) {
        for (const [mId, plates] of Object.entries(validatedAllocation.plates)) {
          if (plates > 0) {
            await assertMemberNotCheckedOut(mId, date, stays);
          }
        }
      }

      try {
        return await runFinancialMutation(date, actorRole, async ({ session, guard }) => {
          for (let attempt = 0; attempt < MAX_CONCURRENT_RETRIES; attempt += 1) {
            const currentDocument = await repository.findByDate(date, { session });
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
              await guard();
              const created = await repository.create(newDocument, { session });
              return {
                changed: true,
                data: serializeMealDay(created, date, { timezone }),
              };
            } catch (error) {
              if (isDuplicateKeyError(error)) {
                if (session) throw error;
                continue;
              }
              throw error;
            }
          }

          await guard();
          const updated = await repository.updateAllocationIfCurrent({
            date,
            mealType,
            allocation: validatedAllocation,
            derivedStatuses,
            revision: currentDocument.revision,
            allocationChange,
          }, { session });

          if (updated) {
            return {
              changed: true,
              data: serializeMealDay(updated, date, { timezone }),
            };
          }
          }

          throw new Error('Concurrent allocation updates did not settle');
        });
      } catch (error) {
        if (error instanceof HttpError || error.statusCode) {
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
        return await runFinancialMutation(date, actorRole, async ({ session, guard }) => {
          for (let attempt = 0; attempt < MAX_CONCURRENT_RETRIES; attempt += 1) {
            const currentDocument = await repository.findByDate(date, { session });
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
            reason: 'Reset to individual plates',
          };

          await guard();
          const updated = await repository.clearAllocationIfCurrent({
            date,
            mealType,
            revision: currentDocument.revision,
            allocationChange,
          }, { session });

          if (updated) {
            return {
              changed: true,
              data: serializeMealDay(updated, date, { timezone }),
            };
          }
          }

          throw new Error('Concurrent allocation clears did not settle');
        });
      } catch (error) {
        if (error instanceof HttpError || error.statusCode) {
          throw error;
        }

        throw new HttpError(503, error.message || 'Unable to reset plate allocation. Please try again.', {
          cause: error,
        });
      }
    },

    async setPriceOverride({
      date,
      mealType,
      pricePaise,
      reason = null,
      actorRole,
      actorMemberId = null,
      changedAt = new Date(),
    }) {
      if (!isValidLogicalDate(date)) {
        throw new HttpError(400, 'Date must be a valid calendar date in YYYY-MM-DD format.');
      }

      if (!MEAL_TYPES.includes(mealType)) {
        throw new HttpError(400, 'Invalid meal type.');
      }

      if (!isValidPricePaise(pricePaise)) {
        throw new HttpError(400, 'Price must be a valid non-negative integer paise within allowed limits.');
      }

      if (reason !== undefined && reason !== null && typeof reason !== 'string') {
        throw new HttpError(400, 'Reason must be a string.');
      }

      if (typeof reason === 'string' && reason.trim().length > 200) {
        throw new HttpError(400, 'Reason must be at most 200 characters.');
      }

      if (settlements && (await settlements.isMonthClosed(date.slice(0, 7)))) {
        throw new HttpError(409, 'This month is closed. Reopen the month before changing meal prices.');
      }

      const normalizedReason =
        typeof reason === 'string' && reason.trim()
          ? reason.trim().replace(/\s+/g, ' ').slice(0, 200)
          : null;

      try {
        return await runFinancialMutation(date, actorRole, async ({ session, guard }) => {
          for (let attempt = 0; attempt < MAX_CONCURRENT_RETRIES; attempt += 1) {
            const currentDocument = await repository.findByDate(date, { session });
          const currentOverride = currentDocument?.priceOverrides?.[mealType] ?? null;
          const currentPrice = currentOverride?.pricePaise ?? null;
          const currentReason = currentOverride?.reason ?? null;

          if (currentPrice === pricePaise && currentReason === normalizedReason) {
            return {
              changed: false,
              data: serializeMealDay(currentDocument, date, { timezone }),
            };
          }

          const priceChange = {
            changedAt,
            actorRole,
            actorMemberId: actorMemberId ?? null,
            mealType,
            changeType: 'set',
            fromOverridePricePaise: currentPrice,
            toOverridePricePaise: pricePaise,
            reason: normalizedReason,
          };

          const newOverride = {
            pricePaise,
            reason: normalizedReason,
          };

          if (!currentDocument) {
            const newDocument = createDefaultMealDay(date);
            newDocument.priceOverrides[mealType] = newOverride;
            newDocument.revision = 1;
            newDocument.priceChanges.push(priceChange);

            try {
              await guard();
              const created = await repository.create(newDocument, { session });
              return {
                changed: true,
                data: serializeMealDay(created, date, { timezone }),
              };
            } catch (error) {
              if (isDuplicateKeyError(error)) {
                if (session) throw error;
                continue;
              }
              throw error;
            }
          }

          await guard();
          const updated = await repository.updatePriceOverrideIfCurrent({
            date,
            mealType,
            priceOverride: newOverride,
            revision: currentDocument.revision,
            priceChange,
          }, { session });

          if (updated) {
            return {
              changed: true,
              data: serializeMealDay(updated, date, { timezone }),
            };
          }
          }

          throw new Error('Concurrent price updates did not settle');
        });
      } catch (error) {
        if (error instanceof HttpError || error.statusCode) {
          throw error;
        }

        throw new HttpError(503, error.message || 'Unable to save price override. Please try again.', {
          cause: error,
        });
      }
    },

    async clearPriceOverride({
      date,
      mealType,
      actorRole,
      actorMemberId = null,
      changedAt = new Date(),
    }) {
      if (!isValidLogicalDate(date)) {
        throw new HttpError(400, 'Date must be a valid calendar date in YYYY-MM-DD format.');
      }

      if (!MEAL_TYPES.includes(mealType)) {
        throw new HttpError(400, 'Invalid meal type.');
      }

      if (settlements && (await settlements.isMonthClosed(date.slice(0, 7)))) {
        throw new HttpError(409, 'This month is closed. Reopen the month before changing meal prices.');
      }

      try {
        return await runFinancialMutation(date, actorRole, async ({ session, guard }) => {
          for (let attempt = 0; attempt < MAX_CONCURRENT_RETRIES; attempt += 1) {
            const currentDocument = await repository.findByDate(date, { session });
          const currentOverride = currentDocument?.priceOverrides?.[mealType] ?? null;

          if (!currentOverride) {
            return {
              changed: false,
              data: serializeMealDay(currentDocument, date, { timezone }),
            };
          }

          const priceChange = {
            changedAt,
            actorRole,
            actorMemberId: actorMemberId ?? null,
            mealType,
            changeType: 'clear',
            fromOverridePricePaise: currentOverride.pricePaise,
            toOverridePricePaise: null,
            reason: 'Reset to standard price',
          };

          await guard();
          const updated = await repository.clearPriceOverrideIfCurrent({
            date,
            mealType,
            revision: currentDocument.revision,
            priceChange,
          }, { session });

          if (updated) {
            return {
              changed: true,
              data: serializeMealDay(updated, date, { timezone }),
            };
          }
          }

          throw new Error('Concurrent price clears did not settle');
        });
      } catch (error) {
        if (error instanceof HttpError || error.statusCode) {
          throw error;
        }

        throw new HttpError(503, error.message || 'Unable to reset meal price. Please try again.', {
          cause: error,
        });
      }
    },
  });
}

export const mealService = createMealService({ stays: stayRepository });
