import { MEMBER_IDS } from '../config/members.js';
import { env } from '../config/env.js';
import { createDefaultMealDay } from './meal.defaults.js';
import {
  calculateMemberShareUnits,
  getEffectiveMealAllocation,
  splitMealCost,
} from './plateAllocation.service.js';
import { MEAL_PRICES } from './plateAllocation.constants.js';

function serializeDate(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializeMealDay(document, date, { timezone = env.appTimezone } = {}) {
  const source = document ?? createDefaultMealDay(date);

  const morningAllocation = getEffectiveMealAllocation({
    statuses: source.meals?.morning,
    customAllocation: source.allocations?.morning,
  });

  const nightAllocation = getEffectiveMealAllocation({
    statuses: source.meals?.night,
    customAllocation: source.allocations?.night,
  });

  const morningUnits = calculateMemberShareUnits(morningAllocation);
  const nightUnits = calculateMemberShareUnits(nightAllocation);

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
  });

  const nightCost = splitMealCost({
    date,
    mealType: 'night',
    effectiveAllocation: nightAllocation,
    pricePaise: effectiveNightPrice,
  });

  return {
    date,
    timezone,
    saved: Boolean(document),
    revision: source.revision,
    meals: {
      morning: { ...source.meals?.morning },
      night: { ...source.meals?.night },
    },
    allocations: {
      morning: {
        mode: morningAllocation.mode,
        source: morningAllocation.source,
        plates: morningAllocation.plates,
        physicalPlates: morningAllocation.plates.length,
        shareUnits: morningUnits,
        cost: morningCost,
      },
      night: {
        mode: nightAllocation.mode,
        source: nightAllocation.source,
        plates: nightAllocation.plates,
        physicalPlates: nightAllocation.plates.length,
        shareUnits: nightUnits,
        cost: nightCost,
      },
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
        MEMBER_IDS.map((id) => [
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
    updatedAt: serializeDate(source.updatedAt),
  };
}

export function serializeHistory(document, date, limit) {
  const changes = document?.changes ?? [];
  const allocationChanges = document?.allocationChanges ?? [];
  const priceChanges = document?.priceChanges ?? [];

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
