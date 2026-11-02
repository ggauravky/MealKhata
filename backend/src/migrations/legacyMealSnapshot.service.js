import { MEMBER_IDS } from '../config/members.js';
import { MEAL_STATUSES, MEAL_TYPES } from '../meals/meal.constants.js';
import { serializeMealDay } from '../meals/meal.serializer.js';
import { isValidLogicalDate } from '../utils/date.js';
import { checksumValue, stableStringify } from './sourceInventory.service.js';

export const LEGACY_MEAL_CALCULATION_VERSION = 'legacy-v2';

const ACTOR_ROLES = new Set(['member', 'admin', 'superadmin']);
const SOURCE_FIELDS = Object.freeze([
  'date',
  'meals',
  'allocations',
  'priceOverrides',
  'revision',
  'changes',
  'allocationChanges',
  'priceChanges',
  'createdAt',
  'updatedAt',
]);
const SNAPSHOT_FIELDS = Object.freeze([
  'snapshotId',
  'date',
  'calculationVersion',
  'sourceChecksum',
  'sourceRevision',
  'participantOrder',
  'statuses',
  'allocations',
  'pricing',
  'costs',
  'audit',
  'sourceCreatedAt',
  'sourceUpdatedAt',
]);

function asPlainObject(value) {
  if (value && typeof value.toObject === 'function') {
    return value.toObject({ depopulate: true, flattenMaps: true });
  }
  return value;
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return structuredClone(asPlainObject(value));
}

function pickFields(value, fields) {
  const source = asPlainObject(value) ?? {};
  const result = {};
  for (const field of fields) {
    if (Object.hasOwn(source, field)) result[field] = cloneValue(source[field]);
  }
  return result;
}

function toIsoString(value, fieldName) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${fieldName} must be a valid date-time`);
  return parsed.toISOString();
}

function assertKnownStudentKeys(value, fieldName) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  for (const studentId of Object.keys(value)) {
    if (!MEMBER_IDS.includes(studentId)) {
      throw new Error(`Unknown legacy student key '${studentId}' in ${fieldName}`);
    }
  }
}

function assertKnownAllocation(allocation, fieldName) {
  if (allocation === null || allocation === undefined) return;
  const candidate = Array.isArray(allocation) ? { plates: allocation } : allocation;
  if (typeof candidate !== 'object' || !Array.isArray(candidate.plates)) return;
  candidate.plates.forEach((plate, index) => {
    assertKnownStudentKeys(plate?.shares, `${fieldName}.plates[${index}].shares`);
  });
}

function normalizeStatuses(sourceDay) {
  return Object.fromEntries(MEAL_TYPES.map((mealType) => {
    const rawStatuses = sourceDay.meals?.[mealType] ?? {};
    assertKnownStudentKeys(rawStatuses, `meals.${mealType}`);
    const statuses = Object.fromEntries(MEMBER_IDS.map((studentId) => {
      const status = rawStatuses[studentId] ?? 'not_set';
      if (!MEAL_STATUSES.includes(status)) {
        throw new Error(`Invalid legacy status '${status}' for ${mealType}.${studentId}`);
      }
      return [studentId, status];
    }));
    return [mealType, statuses];
  }));
}

function normalizeActor(change) {
  return {
    changedAt: toIsoString(change.changedAt, 'audit changedAt'),
    actorRole: ACTOR_ROLES.has(change.actorRole) ? change.actorRole : 'unknown',
    actorStudentId: typeof change.actorMemberId === 'string' && change.actorMemberId
      ? change.actorMemberId
      : null,
    mealType: change.mealType,
  };
}

function normalizeAudit(sourceDay) {
  const statusChanges = (sourceDay.changes ?? []).map((change) => ({
    ...normalizeActor(change),
    studentId: change.memberId,
    from: change.from,
    to: change.to,
  }));
  const allocationChanges = (sourceDay.allocationChanges ?? []).map((change, index) => {
    assertKnownAllocation(change.from, `allocationChanges[${index}].from`);
    assertKnownAllocation(change.to, `allocationChanges[${index}].to`);
    return {
      ...normalizeActor(change),
      changeType: change.changeType,
      from: cloneValue(change.from ?? null),
      to: cloneValue(change.to ?? null),
      reason: change.reason ?? null,
    };
  });
  const priceChanges = (sourceDay.priceChanges ?? []).map((change) => ({
    ...normalizeActor(change),
    changeType: change.changeType,
    fromPricePaise: change.fromOverridePricePaise ?? null,
    toPricePaise: change.toOverridePricePaise ?? null,
    reason: change.reason ?? null,
  }));

  return { statusChanges, allocationChanges, priceChanges };
}

function normalizeAllocation(serializedAllocation) {
  return {
    mode: serializedAllocation.mode,
    source: serializedAllocation.source,
    plates: serializedAllocation.plates.map((plate) => ({
      shares: Object.fromEntries(MEMBER_IDS.map((studentId) => [studentId, plate.shares[studentId] ?? 0])),
    })),
    physicalPlates: serializedAllocation.physicalPlates,
    shareUnits: Object.fromEntries(
      MEMBER_IDS.map((studentId) => [studentId, serializedAllocation.shareUnits[studentId] ?? 0]),
    ),
  };
}

function normalizeCost(serializedCost) {
  return {
    physicalPlates: serializedCost.physicalPlates,
    pricePaise: serializedCost.pricePaise,
    totalCostPaise: serializedCost.totalCostPaise,
    memberAmountsPaise: Object.fromEntries(
      MEMBER_IDS.map((studentId) => [studentId, serializedCost.memberAmountsPaise[studentId] ?? 0]),
    ),
    roomAmountPaise: serializedCost.roomAmountPaise,
  };
}

function comparableSnapshot(snapshot) {
  return pickFields(snapshot, SNAPSHOT_FIELDS);
}

function assertUniqueSourceDates(sourceDays) {
  const seen = new Set();
  for (const sourceDay of sourceDays) {
    if (seen.has(sourceDay.date)) throw new Error(`Duplicate legacy meal date: ${sourceDay.date}`);
    seen.add(sourceDay.date);
  }
}

export function buildLegacyMealSnapshot(rawSourceDay) {
  const sourceDay = asPlainObject(rawSourceDay);
  if (!sourceDay || typeof sourceDay !== 'object') throw new Error('A legacy meal day is required');
  if (!isValidLogicalDate(sourceDay.date)) {
    throw new Error('Legacy meal date must be a valid calendar date in YYYY-MM-DD format');
  }
  if (!Number.isSafeInteger(sourceDay.revision) || sourceDay.revision < 0) {
    throw new Error(`Legacy meal revision must be a non-negative safe integer for ${sourceDay.date}`);
  }

  for (const mealType of MEAL_TYPES) {
    assertKnownAllocation(sourceDay.allocations?.[mealType], `allocations.${mealType}`);
  }
  const statuses = normalizeStatuses(sourceDay);
  const serialized = serializeMealDay(sourceDay, sourceDay.date);
  const canonicalSource = pickFields(sourceDay, SOURCE_FIELDS);

  return {
    snapshotId: `${LEGACY_MEAL_CALCULATION_VERSION}:${sourceDay.date}`,
    date: sourceDay.date,
    calculationVersion: LEGACY_MEAL_CALCULATION_VERSION,
    sourceChecksum: checksumValue(canonicalSource),
    sourceRevision: sourceDay.revision,
    participantOrder: [...MEMBER_IDS],
    statuses,
    allocations: Object.fromEntries(MEAL_TYPES.map((mealType) => [
      mealType,
      normalizeAllocation(serialized.allocations[mealType]),
    ])),
    pricing: Object.fromEntries(MEAL_TYPES.map((mealType) => [
      mealType,
      cloneValue(serialized.pricing[mealType]),
    ])),
    costs: Object.fromEntries(MEAL_TYPES.map((mealType) => [
      mealType,
      normalizeCost(serialized.allocations[mealType].cost),
    ])),
    audit: normalizeAudit(sourceDay),
    sourceCreatedAt: toIsoString(sourceDay.createdAt, 'source createdAt'),
    sourceUpdatedAt: toIsoString(sourceDay.updatedAt, 'source updatedAt'),
  };
}

export function createLegacyMealSnapshotService({ source, snapshots } = {}) {
  if (!source || typeof source.listLegacyMealDays !== 'function') {
    throw new Error('A read-only legacy meal source is required');
  }
  if (!snapshots) throw new Error('A meal history snapshot repository is required');

  return Object.freeze({
    async capture({ dryRun = false, verify = false } = {}) {
      const sourceDays = await source.listLegacyMealDays();
      if (!Array.isArray(sourceDays)) throw new Error('Legacy meal source must return an array');
      assertUniqueSourceDates(sourceDays);
      const expectedSnapshots = sourceDays.map(buildLegacyMealSnapshot);
      const report = {
        sourceCount: expectedSnapshots.length,
        createdCount: 0,
        reusedCount: 0,
        verifiedCount: 0,
        dryRun: Boolean(dryRun),
      };

      if (dryRun && !verify) return report;

      if (verify) {
        const storedSnapshots = await snapshots.listByVersion(LEGACY_MEAL_CALCULATION_VERSION);
        if (storedSnapshots.length !== expectedSnapshots.length) {
          throw new Error(
            `Legacy snapshot count mismatch: expected ${expectedSnapshots.length}, found ${storedSnapshots.length}`,
          );
        }
        const storedByDate = new Map(storedSnapshots.map((snapshot) => [snapshot.date, snapshot]));
        for (const expected of expectedSnapshots) {
          const stored = storedByDate.get(expected.date);
          if (!stored) throw new Error(`Missing legacy meal snapshot for ${expected.date}`);
          if (stored.sourceChecksum !== expected.sourceChecksum) {
            throw new Error(`Legacy meal snapshot source checksum mismatch for ${expected.date}`);
          }
          if (stableStringify(comparableSnapshot(stored)) !== stableStringify(expected)) {
            throw new Error(`Exact snapshot verification mismatch for ${expected.date}`);
          }
          report.verifiedCount += 1;
        }
        return report;
      }

      for (const expected of expectedSnapshots) {
        const stored = await snapshots.findByDateAndVersion(
          expected.date,
          LEGACY_MEAL_CALCULATION_VERSION,
        );
        if (!stored) {
          await snapshots.create(expected);
          report.createdCount += 1;
          continue;
        }
        if (stored.sourceChecksum !== expected.sourceChecksum) {
          throw new Error(`Legacy meal snapshot source checksum mismatch for ${expected.date}`);
        }
        if (stableStringify(comparableSnapshot(stored)) !== stableStringify(expected)) {
          throw new Error(`Exact snapshot verification mismatch for ${expected.date}`);
        }
        report.reusedCount += 1;
      }

      return report;
    },
  });
}
