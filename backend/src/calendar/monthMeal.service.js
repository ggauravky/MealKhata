import { env } from '../config/env.js';
import { mealRepository } from '../meals/meal.repository.js';
import { serializeLegacyMealSnapshot, serializeMealDay } from '../meals/meal.serializer.js';
import { mealHistorySnapshotRepository } from '../meals/mealHistorySnapshot.repository.js';
import { mealHistoricalCorrectionRepository } from '../meals/mealHistoricalCorrection.repository.js';
import { resolveHistoricalMealAuthority } from '../meals/mealHistoricalCorrection.service.js';
import { studentResolver } from '../students/studentResolver.service.js';
import { HttpError } from '../utils/HttpError.js';
import { firstDateOfMonth, lastDateOfMonth, listDatesInMonth } from '../utils/month.js';

function serializeMonthDay(document, date, { timezone = env.appTimezone, participants, snapshot } = {}) {
  const serialized = snapshot
    ? serializeLegacyMealSnapshot(snapshot, { timezone })
    : serializeMealDay(document, date, { timezone, participants });

  const morningStatuses = Object.values(serialized.meals.morning);
  const nightStatuses = Object.values(serialized.meals.night);
  const morningTaking = morningStatuses.filter((status) => status === 'taking').length;
  const nightTaking = nightStatuses.filter((status) => status === 'taking').length;
  const morningSkipping = morningStatuses.filter((status) => status === 'skip').length;
  const nightSkipping = nightStatuses.filter((status) => status === 'skip').length;
  const morningNotSet = morningStatuses.filter((status) => status === 'not_set').length;
  const nightNotSet = nightStatuses.filter((status) => status === 'not_set').length;

  const isMorningCustom = serialized.allocations.morning.source === 'custom';
  const isNightCustom = serialized.allocations.night.source === 'custom';
  const hasCustomAllocation = isMorningCustom || isNightCustom;

  const hasMealActivity = Boolean(
    document && (
      hasCustomAllocation ||
      Object.values(serialized.meals.morning).some((s) => s === 'taking' || s === 'skip') ||
      Object.values(serialized.meals.night).some((s) => s === 'taking' || s === 'skip')
    ),
  );

  return {
    date,
    schemaVersion: serialized.schemaVersion ?? document?.schemaVersion ?? null,
    calculationVersion: serialized.calculationVersion ?? null,
    participantOrder: serialized.participantOrder ?? [...new Set([
      ...Object.keys(serialized.meals?.morning ?? {}),
      ...Object.keys(serialized.meals?.night ?? {}),
    ])],
    financialClassification: document?.financialClassification ?? null,
    cutoverClassificationSource: document?.cutoverClassificationSource ?? null,
    importedFromLegacy: document?.importedFromLegacy ?? Boolean(snapshot),
    saved: serialized.saved,
    hasMealActivity,
    hasCustomAllocation,
    revision: serialized.revision,
    meals: serialized.meals,
    allocations: serialized.allocations,
    pricing: serialized.pricing,
    dailyCostSummary: serialized.dailyCostSummary,
    priceOverrides: snapshot
      ? Object.fromEntries(['morning', 'night'].map((mealType) => [
        mealType,
        snapshot.pricing[mealType].isOverridden
          ? { pricePaise: snapshot.pricing[mealType].overridePricePaise, reason: snapshot.pricing[mealType].reason }
          : null,
      ]))
      : document?.priceOverrides ?? null,
    counts: {
      morningTaking,
      morningSkipping,
      morningNotSet,
      nightTaking,
      nightSkipping,
      nightNotSet,
      morningPhysicalPlates: serialized.plateCounts.morning,
      nightPhysicalPlates: serialized.plateCounts.night,
      totalPhysicalPlates: serialized.plateCounts.total,
      isMorningCustom,
      isNightCustom,
    },
  };
}

export function createMonthMealService({
  repository = mealRepository,
  students = null,
  snapshots = null,
  corrections = null,
  timezone = env.appTimezone,
} = {}) {
  return Object.freeze({
    async getMonth(month) {
      try {
        const documents = await repository.findInDateRange(
          firstDateOfMonth(month),
          lastDateOfMonth(month),
        );
        const byDate = new Map(documents.map((document) => [document.date, document]));

        const days = await Promise.all(listDatesInMonth(month).map(async (date) => {
          const document = byDate.get(date);
          const participants = !document && students
            ? (await students.listEligibleOn(date)).map(({ studentId }) => studentId)
            : undefined;
          const snapshot = document && document.schemaVersion !== 3 && snapshots
            ? await resolveHistoricalMealAuthority(document, {
              snapshots,
              corrections: corrections ?? { listByDate: async () => [] },
            })
            : null;
          return serializeMonthDay(document, date, { timezone, participants, snapshot });
        }));

        return {
          month,
          timezone,
          days,
        };
      } catch (error) {
        if (/historical meal (?:correction )?snapshot/i.test(error.message)) {
          throw new HttpError(503, error.message, { cause: error });
        }
        throw new HttpError(503, 'Monthly meal data is temporarily unavailable.', { cause: error });
      }
    },
  });
}

export const monthMealService = createMonthMealService({
  students: studentResolver,
  snapshots: mealHistorySnapshotRepository,
  corrections: mealHistoricalCorrectionRepository,
});
