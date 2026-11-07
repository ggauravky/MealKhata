import { env } from '../config/env.js';
import { createDefaultMealDay } from './meal.defaults.js';
import {
  calculateMemberShareUnits,
  getEffectiveMealAllocation,
  splitMealCost,
} from './plateAllocation.service.js';
import { MEAL_PRICES, resolvePhysicalPlateLimit } from './plateAllocation.constants.js';
import { calculateStoredShareUnits, extractMealParticipantIds, normalizeParticipantIds, toPlainMealValue } from './mealParticipants.js';

function serializeDate(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializeMealDay(
  document,
  date,
  { timezone = env.appTimezone, participants } = {},
) {
  const source = toPlainMealValue(document ?? createDefaultMealDay(date, participants));
  const participantIds = normalizeParticipantIds(
    source.participantOrder?.length
      ? source.participantOrder
      : (source.schemaVersion !== 3 && participants ? participants : extractMealParticipantIds(source)),
  );

  const morningAllocation = getEffectiveMealAllocation({
    statuses: source.meals?.morning,
    customAllocation: source.allocations?.morning,
    participants: participantIds,
  });

  const nightAllocation = getEffectiveMealAllocation({
    statuses: source.meals?.night,
    customAllocation: source.allocations?.night,
    participants: participantIds,
  });

  const defaultMorningPrice = MEAL_PRICES.morning;
  const defaultNightPrice = MEAL_PRICES.night;

  const morningOverride = source.priceOverrides?.morning ?? null;
  const nightOverride = source.priceOverrides?.night ?? null;

  const isMorningOverridden = Boolean(
    morningOverride &&
    typeof morningOverride.pricePaise === 'number' &&
    Number.isInteger(morningOverride.pricePaise) &&
    morningOverride.pricePaise >= 0,
  );
  const isNightOverridden = Boolean(
    nightOverride &&
    typeof nightOverride.pricePaise === 'number' &&
    Number.isInteger(nightOverride.pricePaise) &&
    nightOverride.pricePaise >= 0,
  );

  const effectiveMorningPrice = isMorningOverridden ? morningOverride.pricePaise : defaultMorningPrice;
  const effectiveNightPrice = isNightOverridden ? nightOverride.pricePaise : defaultNightPrice;

  const morningCost = splitMealCost({
    date,
    mealType: 'morning',
    effectiveAllocation: morningAllocation,
    pricePaise: effectiveMorningPrice,
    participants: participantIds,
  });

  const nightCost = splitMealCost({
    date,
    mealType: 'night',
    effectiveAllocation: nightAllocation,
    pricePaise: effectiveNightPrice,
    participants: participantIds,
  });

  const serializeAllocation = (mealType, effectiveAllocation, cost) => {
    const storedAllocation = source.allocations?.[mealType];
    const isStoredCustom = storedAllocation?.mode === 'custom' && Array.isArray(storedAllocation.plates);
    const plates = isStoredCustom ? storedAllocation.plates : effectiveAllocation.plates;
    return {
      mode: isStoredCustom ? storedAllocation.mode : effectiveAllocation.mode,
      source: isStoredCustom ? 'custom' : effectiveAllocation.source,
      plates,
      physicalPlates: plates.length,
      shareUnits: isStoredCustom ? calculateStoredShareUnits(storedAllocation) : calculateMemberShareUnits(effectiveAllocation, { participants: participantIds }),
      cost,
    };
  };

  return {
    date,
    ...(source.financialClassification ? { financialClassification: source.financialClassification } : {}),
    ...(source.cutoverClassificationSource ? { cutoverClassificationSource: source.cutoverClassificationSource } : {}),
    ...(source.importedFromLegacy ? { importedFromLegacy: true } : {}),
    ...(Object.hasOwn(source, 'schemaVersion') ? { schemaVersion: source.schemaVersion } : {}),
    ...(source.participantOrder ? { participantOrder: [...participantIds] } : {}),
    timezone,
    saved: Boolean(document),
    revision: source.revision,
    maxPhysicalPlates: resolvePhysicalPlateLimit(participantIds.length),
    meals: {
      morning: { ...(source.meals?.morning ?? {}) },
      night: { ...(source.meals?.night ?? {}) },
    },
    allocations: {
      morning: serializeAllocation('morning', morningAllocation, morningCost),
      night: serializeAllocation('night', nightAllocation, nightCost),
    },
    pricing: {
      morning: {
        defaultPricePaise: defaultMorningPrice,
        effectivePricePaise: effectiveMorningPrice,
        overridePricePaise: isMorningOverridden ? morningOverride.pricePaise : null,
        isOverridden: isMorningOverridden,
        reason: isMorningOverridden ? morningOverride.reason ?? null : null,
      },
      night: {
        defaultPricePaise: defaultNightPrice,
        effectivePricePaise: effectiveNightPrice,
        overridePricePaise: isNightOverridden ? nightOverride.pricePaise : null,
        isOverridden: isNightOverridden,
        reason: isNightOverridden ? nightOverride.reason ?? null : null,
      },
    },
    dailyCostSummary: {
      members: Object.fromEntries(
        participantIds.map((id) => [
          id,
          {
            morningAmountPaise: morningCost.members[id].amountPaise,
            nightAmountPaise: nightCost.members[id].amountPaise,
            totalAmountPaise: morningCost.members[id].amountPaise + nightCost.members[id].amountPaise,
          },
        ]),
      ),
      room: {
        morningAmountPaise: morningCost.roomAmountPaise,
        nightAmountPaise: nightCost.roomAmountPaise,
        totalAmountPaise: morningCost.roomAmountPaise + nightCost.roomAmountPaise,
      },
    },
    plateCounts: {
      morning: morningAllocation.plates.length,
      night: nightAllocation.plates.length,
      total: morningAllocation.plates.length + nightAllocation.plates.length,
    },
    createdAt: serializeDate(source.createdAt),
    updatedAt: serializeDate(source.updatedAt),
  };
}

export function serializeLegacyMealSnapshot(snapshot, { timezone = env.appTimezone } = {}) {
  const participants = normalizeParticipantIds(snapshot.participantOrder);
  const costFor = (mealType) => {
    const cost = snapshot.costs[mealType];
    return {
      ...structuredClone(cost),
      physicalPlateCount: cost.physicalPlates,
      members: Object.fromEntries(participants.map((studentId) => [studentId, {
        shareUnits: snapshot.allocations[mealType].shareUnits[studentId],
        amountPaise: cost.memberAmountsPaise[studentId],
        plateEquivalent: snapshot.allocations[mealType].shareUnits[studentId] / 6,
      }])),
    };
  };
  const morningCost = costFor('morning');
  const nightCost = costFor('night');
  return {
    date: snapshot.date,
    calculationVersion: snapshot.calculationVersion,
    participantOrder: participants,
    timezone,
    saved: true,
    revision: snapshot.sourceRevision,
    meals: structuredClone(snapshot.statuses),
    allocations: {
      morning: { ...structuredClone(snapshot.allocations.morning), cost: morningCost },
      night: { ...structuredClone(snapshot.allocations.night), cost: nightCost },
    },
    pricing: structuredClone(snapshot.pricing),
    dailyCostSummary: {
      members: Object.fromEntries(participants.map((studentId) => [studentId, {
        morningAmountPaise: morningCost.memberAmountsPaise[studentId],
        nightAmountPaise: nightCost.memberAmountsPaise[studentId],
        totalAmountPaise: morningCost.memberAmountsPaise[studentId] + nightCost.memberAmountsPaise[studentId],
      }])),
      room: {
        morningAmountPaise: morningCost.roomAmountPaise,
        nightAmountPaise: nightCost.roomAmountPaise,
        totalAmountPaise: morningCost.roomAmountPaise + nightCost.roomAmountPaise,
      },
    },
    plateCounts: {
      morning: morningCost.physicalPlates,
      night: nightCost.physicalPlates,
      total: morningCost.physicalPlates + nightCost.physicalPlates,
    },
    createdAt: snapshot.sourceCreatedAt,
    updatedAt: snapshot.sourceUpdatedAt,
  };
}

export function serializeHistory(document, date, limit) {
  const source = toPlainMealValue(document) ?? {};
  const changes = source.changes ?? [];
  const allocationChanges = source.allocationChanges ?? [];
  const priceChanges = source.priceChanges ?? [];

  const serializedStatus = changes.map((change) => ({
    changedAt: serializeDate(change.changedAt),
    actorRole: change.actorRole,
    actorMemberId: change.actorMemberId ?? null,
    mealType: change.mealType,
    memberId: change.memberId,
    from: change.from,
    to: change.to,
    type: 'status',
  }));

  const serializedAllocations = allocationChanges.map((change) => ({
    changedAt: serializeDate(change.changedAt),
    actorRole: change.actorRole,
    actorMemberId: change.actorMemberId ?? null,
    mealType: change.mealType,
    changeType: change.changeType,
    from: change.from,
    to: change.to,
    reason: change.reason ?? null,
    type: 'allocation',
  }));

  const serializedPriceChanges = priceChanges.map((change) => ({
    changedAt: serializeDate(change.changedAt),
    actorRole: change.actorRole,
    actorMemberId: change.actorMemberId ?? null,
    mealType: change.mealType,
    changeType: change.changeType,
    fromPricePaise: change.fromOverridePricePaise ?? MEAL_PRICES[change.mealType] ?? null,
    toPricePaise:
      change.toOverridePricePaise ??
      (change.changeType === 'clear' ? (MEAL_PRICES[change.mealType] ?? null) : null),
    reason: change.reason ?? null,
    type: 'price',
  }));

  // Merge all events chronologically (newest first)
  const allMerged = [...serializedStatus, ...serializedAllocations, ...serializedPriceChanges].sort(
    (a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime(),
  );

  const items = allMerged.slice(0, limit);

  return {
    date,
    items,
    allocationChanges: serializedAllocations
      .slice(Math.max(0, serializedAllocations.length - limit))
      .reverse(),
    priceChanges: serializedPriceChanges
      .slice(Math.max(0, serializedPriceChanges.length - limit))
      .reverse(),
  };
}
