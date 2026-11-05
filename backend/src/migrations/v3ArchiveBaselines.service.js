import { serializeLegacyMealSnapshot, serializeMealDay } from '../meals/meal.serializer.js';
import { serializeMonthlyRate } from '../billing/monthlyRate.serializer.js';
import { calculateBillingSummary } from '../reports/billing.service.js';
import { firstDateOfMonth, lastDateOfMonth } from '../utils/month.js';
import { buildLegacyMealSnapshot, verifyLegacyMealSnapshot } from './legacyMealSnapshot.service.js';

/** Read-only historical baselines for both original v2 and snapshot-backed sources. */
export function createReadOnlyMealBaselineReaders(db) {
  if (!db?.collection) throw new Error('A connected source database is required');
  const readCalendarDay = async date => {
    const day = await db.collection('meal_days').findOne({ date });
    if (!day) throw new Error(`Archived source meal day disappeared: ${date}`);
    if (day.schemaVersion === 3) return serializeMealDay(day, date);
    const stored = await db.collection('meal_history_snapshots').findOne({ date,
      calculationVersion: 'legacy-v2' });
    const baseline = stored ? verifyLegacyMealSnapshot(day, stored) : buildLegacyMealSnapshot(day);
    const correction = await db.collection('meal_history_corrections').find({ date })
      .sort({ revision: -1 }).limit(1).next();
    return serializeLegacyMealSnapshot(correction?.snapshot ?? baseline);
  };
  return {
    readCalendarDay,
    async readMonthlyCostReport(month) {
      const days = await db.collection('meal_days').find({ date: { $gte: `${month}-01`,
        $lte: `${month}-31` } }).sort({ date: 1 }).toArray();
      const serializedDays = await Promise.all(days.map(day => readCalendarDay(day.date)));
      const rate = await db.collection('monthly_meal_rates').findOne({ month });
      const summary = calculateBillingSummary(serializedDays, serializeMonthlyRate(rate, month), {
        startDate: firstDateOfMonth(month), endDate: lastDateOfMonth(month),
      });
      const memberAmountsPaise = Object.fromEntries(Object.entries(summary.members)
        .map(([id, value]) => [id, value.amountPaise]));
      const roomAmountPaise = summary.room.amountPaise;
      if (Object.values(memberAmountsPaise).reduce((sum, amount) => sum + amount, 0) !== roomAmountPaise) {
        throw new Error(`Historical monthly meal costs do not conserve exact paise in ${month}`);
      }
      return { month, dayCount: days.length, memberAmountsPaise,
        roomAmountPaise, householdAmountPaise: roomAmountPaise };
    },
  };
}
