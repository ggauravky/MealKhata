import { env } from '../config/env.js';
import { isValidPricePaise } from '../billing/monthlyRate.constants.js';
import { isValidLogicalDate } from '../utils/date.js';
import { HttpError } from '../utils/HttpError.js';
import { DEFAULT_MEAL_STATUS, getMealPath, MEAL_TYPES } from './meal.constants.js';
import { createDefaultMealDay } from './meal.defaults.js';
import { mealRepository } from './meal.repository.js';
import { serializeHistory, serializeLegacyMealSnapshot, serializeMealDay } from './meal.serializer.js';
import {
  calculateMemberShareUnits,
  deriveParticipationStatuses,
  validatePlateAllocation,
} from './plateAllocation.service.js';
import { stayRepository } from '../stays/stay.repository.js';
import { MEMBER_IDS } from '../config/members.js';
import { studentResolver } from '../students/studentResolver.service.js';
import { extractMealParticipantIds, normalizeParticipantIds } from './mealParticipants.js';
import { resolvePhysicalPlateLimit } from './plateAllocation.constants.js';
import { mealHistorySnapshotRepository } from './mealHistorySnapshot.repository.js';
import { mealHistoricalCorrectionRepository } from './mealHistoricalCorrection.repository.js';
import { resolveHistoricalMealAuthority } from './mealHistoricalCorrection.service.js';
import { assertMemberNotCheckedOut } from './mealCheckoutGuard.js';

const MAX_CONCURRENT_RETRIES = 12;

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

export function createMealService({
  repository = mealRepository,
  settlements = null,
  stays = null,
  students = null,
  snapshots = null,
  corrections = null,
  timezone = env.appTimezone,
} = {}) {
  const listEligibleStudentIds = async (date) => {
    if (!students) return MEMBER_IDS;
    const eligibleStudents = await students.listEligibleOn(date);
    return eligibleStudents.map(({ studentId }) => studentId);
  };

  const createDefaultDayForDate = async (date) => (
    createDefaultMealDay(date, await listEligibleStudentIds(date))
  );

  const participantsForDay = async (document, date) => document
    ? normalizeParticipantIds(document.participantOrder?.length ? document.participantOrder : extractMealParticipantIds(document))
    : listEligibleStudentIds(date);

  const verifiedSnapshot = async (document) => resolveHistoricalMealAuthority(document, {
    snapshots,
    corrections: corrections ?? { listByDate: async () => [] },
  });

  const serializeDay = async (document, date) => {
    if (document && document.schemaVersion !== 3 && snapshots) {
      return {
        ...serializeLegacyMealSnapshot(await verifiedSnapshot(document), { timezone }),
        ...(document.financialClassification ? { financialClassification: document.financialClassification } : {}),
        ...(document.cutoverClassificationSource ? { cutoverClassificationSource: document.cutoverClassificationSource } : {}),
        ...(document.importedFromLegacy ? { importedFromLegacy: true } : {}),
      };
    }
    return serializeMealDay(document, date, {
      timezone,
      ...(document ? {} : { participants: await listEligibleStudentIds(date) }),
    });
  };

  const runFinancialMutation = async (date, actorRole, work, proposedIds = []) => {
    const previous = await repository.findByDate(date);
    if (previous && previous.schemaVersion !== 3 && snapshots) {
      await verifiedSnapshot(previous);
      throw new HttpError(409, 'Historical meal correction requires an explicit revision-aware correction.');
    }
    const memberIds = normalizeParticipantIds([
      ...(previous ? extractMealParticipantIds(previous) : await listEligibleStudentIds(date)),
      ...proposedIds,
    ]);
    if (typeof repository.executeFinancialMutation === 'function') {
      return repository.executeFinancialMutation({ date, memberIds, actorRole }, async ({ session, guard }) => work({
        session,
        guard: async () => {
          const current = await repository.findByDate(date, { session });
          if (current && current.schemaVersion !== 3 && snapshots) {
            await verifiedSnapshot(current);
            throw new HttpError(409, 'Historical meal correction requires an explicit revision-aware correction.');
          }
          const currentIds = current
            ? extractMealParticipantIds(current)
            : await listEligibleStudentIds(date);
          await guard({ memberIds: normalizeParticipantIds([...memberIds, ...currentIds]) });
        },
      }));
    }
    return work({ session: null, guard: async () => {} });
  };

  return Object.freeze({
    async getDay(date) {
      try {
        const document = await repository.findByDate(date);
        return serializeDay(document, date);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (/historical meal (?:correction )?snapshot/i.test(error.message)) {
          throw new HttpError(503, error.message, { cause: error });
        }
        throw new HttpError(503, 'Meal data is temporarily unavailable.', { cause: error });
      }
    },

    async getHistory(date, limit) {
      try {
        const document = await repository.findByDate(date);
        if (document && document.schemaVersion !== 3 && snapshots) await verifiedSnapshot(document);
        const history = serializeHistory(document, date, limit);
        if (document && document.schemaVersion !== 3 && corrections) {
          const correctionEvents = (await corrections.listByDate(date)).map((record) => ({
            changedAt: new Date(record.createdAt).toISOString(),
            actorRole: record.actorRole,
            actorMemberId: null,
            mealType: record.mealType,
            changeType: record.operation,
            reason: record.reason,
            revision: record.revision,
            type: 'historical_correction',
          }));
          history.items = [...history.items, ...correctionEvents]
            .sort((a, b) => b.changedAt.localeCompare(a.changedAt)).slice(0, limit);
        }
        return history;
      } catch (error) {
        if (/historical meal (?:correction )?snapshot/i.test(error.message)) {
          throw new HttpError(503, error.message, { cause: error });
        }
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
          if (currentDocument && !(await participantsForDay(currentDocument, date)).includes(memberId)) {
            throw new HttpError(409, 'Student is not a participant in this saved meal.');
          }
          const currentStatus = currentDocument?.meals?.[mealType]?.[memberId] ?? DEFAULT_MEAL_STATUS;
          const currentAllocation = currentDocument?.allocations?.[mealType];
          const hasCustomAllocation = currentAllocation && currentAllocation.mode === 'custom';

          if (currentStatus === status) {
            return {
              changed: false,
              allocationReset: false,
              data: await serializeDay(currentDocument, date),
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
            const newDocument = await createDefaultDayForDate(date);
            if (!Object.hasOwn(newDocument.meals[mealType], memberId)) {
              if (!students) throw new HttpError(400, 'Invalid member.');
              if (typeof students.assertKnown === 'function') await students.assertKnown(memberId);
              throw new HttpError(409, 'Student is not eligible for meals on this date.');
            }
            newDocument.meals[mealType][memberId] = status;
            newDocument.revision = 1;
            newDocument.changes.push(statusChange);

            try {
              await guard();
              const created = await repository.create(newDocument, { session });
              return {
                changed: true,
                allocationReset: false,
                data: await serializeDay(created, date),
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
                data: await serializeDay(updated, date),
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
                data: await serializeDay(updated, date),
              };
            }
          }
          }

          throw new Error('Concurrent meal updates did not settle');
        }, [memberId]);
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
      expectedRevision = null,
      actorRole,
      actorMemberId = null,
      changedAt = new Date(),
    }) {
      if (settlements && (await settlements.isMonthClosed(date.slice(0, 7)))) {
        throw new HttpError(409, 'This month is closed. Reopen the month before changing plate allocation.');
      }
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
        throw new HttpError(400, 'Expected revision must be a non-negative integer.');
      }

      const existingDay = await repository.findByDate(date);
      if (expectedRevision !== null && (existingDay?.revision ?? 0) !== expectedRevision) {
        throw new HttpError(409, 'Meal revision changed. Refresh and retry the allocation.');
      }
      const participantIds = await participantsForDay(existingDay, date);
      const validatedAllocation = validatePlateAllocation(allocation, {
        participants: participantIds,
        maxPhysicalPlates: resolvePhysicalPlateLimit(participantIds.length),
      });
      const derivedStatuses = deriveParticipationStatuses(validatedAllocation, { participants: participantIds });

      if (stays && validatedAllocation.plates) {
        for (const [mId, units] of Object.entries(calculateMemberShareUnits(validatedAllocation, { participants: participantIds }))) {
          if (mId !== 'totalUnits' && units > 0) {
            await assertMemberNotCheckedOut(mId, date, stays);
          }
        }
      }

      try {
        return await runFinancialMutation(date, actorRole, async ({ session, guard }) => {
          for (let attempt = 0; attempt < MAX_CONCURRENT_RETRIES; attempt += 1) {
            const currentDocument = await repository.findByDate(date, { session });
          if (expectedRevision !== null && (currentDocument?.revision ?? 0) !== expectedRevision) {
            throw new HttpError(409, 'Meal revision changed. Refresh and retry the allocation.');
          }
          const currentIds = await participantsForDay(currentDocument, date);
          if (currentIds.length !== participantIds.length
            || currentIds.some((studentId, index) => studentId !== participantIds[index])) {
            throw new HttpError(409, 'Meal participants changed. Refresh and retry the allocation.');
          }
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
            const newDocument = await createDefaultDayForDate(date);
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
                data: await serializeDay(created, date),
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
              data: await serializeDay(updated, date),
            };
          }
          }

          throw new Error('Concurrent allocation updates did not settle');
        }, participantIds);
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
              data: await serializeDay(currentDocument, date),
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
              data: await serializeDay(updated, date),
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
              data: await serializeDay(currentDocument, date),
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
            const newDocument = await createDefaultDayForDate(date);
            newDocument.priceOverrides[mealType] = newOverride;
            newDocument.revision = 1;
            newDocument.priceChanges.push(priceChange);

            try {
              await guard();
              const created = await repository.create(newDocument, { session });
              return {
                changed: true,
                data: await serializeDay(created, date),
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
              data: await serializeDay(updated, date),
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
              data: await serializeDay(currentDocument, date),
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
              data: await serializeDay(updated, date),
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

export const mealService = createMealService({
  stays: stayRepository,
  students: studentResolver,
  snapshots: mealHistorySnapshotRepository,
  corrections: mealHistoricalCorrectionRepository,
});
