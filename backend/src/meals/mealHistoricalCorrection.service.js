import { checksumValue, stableStringify } from '../migrations/sourceInventory.service.js';
import {
  buildLegacyMealSnapshot,
  LEGACY_MEAL_CALCULATION_VERSION,
  verifyLegacyMealSnapshot,
} from '../migrations/legacyMealSnapshot.service.js';
import { isValidPricePaise } from '../billing/monthlyRate.constants.js';
import { HttpError } from '../utils/HttpError.js';
import { isValidLogicalDate } from '../utils/date.js';
import { MEAL_STATUSES, MEAL_TYPES } from './meal.constants.js';
import { mealRepository } from './meal.repository.js';
import { mealHistorySnapshotRepository } from './mealHistorySnapshot.repository.js';
import { mealHistoricalCorrectionRepository } from './mealHistoricalCorrection.repository.js';
import { serializeLegacyMealSnapshot } from './meal.serializer.js';
import { calculateMemberShareUnits, deriveParticipationStatuses, validatePlateAllocation } from './plateAllocation.service.js';
import { assertMemberNotCheckedOut } from './mealCheckoutGuard.js';
import { stayRepository } from '../stays/stay.repository.js';

const CORRECTION_VERSION = 'legacy-correction-v1';
const OPERATIONS = new Set(['status', 'allocation', 'clearAllocation', 'price', 'clearPrice']);
const CORRECTION_SOURCE_FIELDS = [
  'date', 'meals', 'allocations', 'priceOverrides', 'revision',
  'changes', 'allocationChanges', 'priceChanges', 'createdAt', 'updatedAt',
];

function correctionSourceState(source) {
  return Object.fromEntries(CORRECTION_SOURCE_FIELDS
    .filter((field) => Object.hasOwn(source, field))
    .map((field) => [field, structuredClone(source[field])]));
}

export async function resolveHistoricalMealAuthority(source, {
  snapshots = mealHistorySnapshotRepository,
  corrections = mealHistoricalCorrectionRepository,
  session = null,
} = {}) {
  const baseline = verifyLegacyMealSnapshot(
    source,
    await snapshots.findByDateAndVersion(source.date, LEGACY_MEAL_CALCULATION_VERSION),
  );
  let active = baseline;
  const records = await corrections.listByDate(source.date, { session });
  for (const record of records) {
    let recalculated = null;
    try {
      if (record.sourceState) recalculated = buildLegacyMealSnapshot(record.sourceState);
    } catch {
      throw new Error(`Historical meal correction snapshot mismatch for ${source.date}`);
    }
    if (recalculated) {
      recalculated.snapshotId = record.snapshot?.snapshotId;
      recalculated.calculationVersion = CORRECTION_VERSION;
    }
    if (record.originalSourceChecksum !== baseline.sourceChecksum
      || record.previousRevision !== active.sourceRevision
      || record.revision !== active.sourceRevision + 1
      || record.snapshot?.date !== source.date
      || record.snapshot?.sourceRevision !== record.revision
      || record.snapshot?.calculationVersion !== CORRECTION_VERSION
      || JSON.stringify(record.snapshot?.participantOrder) !== JSON.stringify(baseline.participantOrder)
      || checksumValue(record.snapshot) !== record.snapshotChecksum
      || !recalculated
      || stableStringify(recalculated) !== stableStringify(record.snapshot)) {
      throw new Error(`Historical meal correction snapshot mismatch for ${source.date}`);
    }
    active = record.snapshot;
  }
  return active;
}

function sourceFromAuthority(source, authority, changedAt) {
  const allocations = Object.fromEntries(MEAL_TYPES.map((mealType) => [
    mealType,
    authority.allocations[mealType].source === 'custom'
      ? { mode: 'custom', plates: structuredClone(authority.allocations[mealType].plates) }
      : null,
  ]));
  const priceOverrides = Object.fromEntries(MEAL_TYPES.map((mealType) => [
    mealType,
    authority.pricing[mealType].isOverridden
      ? {
        pricePaise: authority.pricing[mealType].overridePricePaise,
        reason: authority.pricing[mealType].reason,
      }
      : null,
  ]));
  return {
    ...source,
    meals: structuredClone(authority.statuses),
    allocations,
    priceOverrides,
    revision: authority.sourceRevision + 1,
    updatedAt: changedAt,
  };
}

function applyCorrection(day, request, participants) {
  const { operation, mealType } = request;
  if (operation === 'status') {
    if (!participants.includes(request.memberId)) throw new HttpError(400, 'Student is not a historical participant.');
    if (!MEAL_STATUSES.includes(request.status)) throw new HttpError(400, 'Invalid meal status.');
    if (day.meals[mealType][request.memberId] === request.status) throw new HttpError(409, 'Historical meal is already in that state.');
    day.meals[mealType][request.memberId] = request.status;
    day.allocations[mealType] = null;
  } else if (operation === 'allocation') {
    let allocation;
    try {
      allocation = validatePlateAllocation(request.allocation, { participants, maxPhysicalPlates: 3 });
    } catch (error) {
      throw new HttpError(400, error.message, { cause: error });
    }
    day.allocations[mealType] = allocation;
    day.meals[mealType] = deriveParticipationStatuses(allocation, { participants });
  } else if (operation === 'clearAllocation') {
    if (!day.allocations[mealType]) throw new HttpError(409, 'Historical allocation is already clear.');
    day.allocations[mealType] = null;
  } else if (operation === 'price') {
    if (!isValidPricePaise(request.pricePaise)) throw new HttpError(400, 'Invalid meal price.');
    day.priceOverrides[mealType] = { pricePaise: request.pricePaise, reason: request.reason };
  } else if (operation === 'clearPrice') {
    if (!day.priceOverrides[mealType]) throw new HttpError(409, 'Historical price override is already clear.');
    day.priceOverrides[mealType] = null;
  }
}

export function createHistoricalMealCorrectionService({
  meals = mealRepository,
  snapshots = mealHistorySnapshotRepository,
  corrections = mealHistoricalCorrectionRepository,
  settlements = null,
  stays = null,
  timezone,
} = {}) {
  return Object.freeze({
    async correct(request) {
      const { date, expectedRevision, operation, mealType, reason, actorRole } = request;
      if (actorRole !== 'superadmin') throw new HttpError(403, 'Super Admin access is required.');
      if (!isValidLogicalDate(date) || !MEAL_TYPES.includes(mealType) || !OPERATIONS.has(operation)) {
        throw new HttpError(400, 'Invalid historical correction target or operation.');
      }
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new HttpError(400, 'An exact expected revision is required.');
      }
      if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 200) {
        throw new HttpError(400, 'A correction reason from 3 to 200 characters is required.');
      }
      if (settlements && await settlements.isMonthClosed(date.slice(0, 7))) {
        throw new HttpError(409, 'This month is closed. Reopen it before correcting meal history.');
      }

      const original = await meals.findByDate(date);
      if (!original) throw new HttpError(404, 'Saved historical meal was not found.');
      if (original.schemaVersion === 3) throw new HttpError(409, 'This meal uses the current calculation version.');
      let baseline;
      try {
        baseline = await resolveHistoricalMealAuthority(original, { snapshots, corrections });
      } catch (error) {
        throw new HttpError(503, error.message, { cause: error });
      }
      const participantOrder = baseline.participantOrder;
      const originalSourceChecksum = buildLegacyMealSnapshot(original).sourceChecksum;
      const work = async ({ session, guard }) => {
        const source = await meals.findByDate(date, { session });
        if (!source || source.schemaVersion === 3) throw new HttpError(409, 'Historical meal changed. Refresh and retry.');
        let authority;
        try {
          authority = await resolveHistoricalMealAuthority(source, { snapshots, corrections, session });
        } catch (error) {
          throw new HttpError(503, error.message, { cause: error });
        }
        if (authority.sourceRevision !== expectedRevision) {
          throw new HttpError(409, 'Historical meal revision changed. Refresh and retry.');
        }
        const changedAt = new Date();
        const correctedSource = sourceFromAuthority(source, authority, changedAt);
        applyCorrection(correctedSource, request, authority.participantOrder);
        if (operation === 'status' && request.status === 'taking') {
          await assertMemberNotCheckedOut(request.memberId, date, stays);
        }
        if (operation === 'allocation') {
          const units = calculateMemberShareUnits(correctedSource.allocations[mealType], {
            participants: authority.participantOrder,
          });
          for (const studentId of authority.participantOrder) {
            if (units[studentId] > 0) await assertMemberNotCheckedOut(studentId, date, stays);
          }
        }
        const next = buildLegacyMealSnapshot(correctedSource);
        next.snapshotId = `${CORRECTION_VERSION}:${date}:${correctedSource.revision}`;
        next.calculationVersion = CORRECTION_VERSION;
        await guard();
        await corrections.create({
          date,
          revision: correctedSource.revision,
          previousRevision: authority.sourceRevision,
          originalSourceChecksum,
          snapshotChecksum: checksumValue(next),
          sourceState: correctionSourceState(correctedSource),
          snapshot: next,
          operation,
          mealType,
          actorRole,
          reason: reason.trim(),
          createdAt: changedAt,
        }, { session });
        return serializeLegacyMealSnapshot(next, { timezone });
      };
      if (typeof meals.executeFinancialMutation === 'function') {
        return meals.executeFinancialMutation({ date, memberIds: participantOrder, actorRole }, work);
      }
      return work({ session: null, guard: async () => {} });
    },
  });
}

export const historicalMealCorrectionService = createHistoricalMealCorrectionService({ stays: stayRepository });
