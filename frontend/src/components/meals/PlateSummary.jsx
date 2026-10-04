import { Moon, SunMedium, Utensils } from 'lucide-react';
import { formatPlateCount, getMealPlateCount, getPlateCounts } from '../../lib/plates.js';

export function PlateSummary({
  meals = {},
  allocations = null,
  allocationDetails = null,
  label = 'Daily physical plate count',
}) {
  let morningPlates;
  let nightPlates;

  if (allocationDetails) {
    morningPlates = allocationDetails.morning?.physicalPlates ?? getMealPlateCount(meals?.morning);
    nightPlates = allocationDetails.night?.physicalPlates ?? getMealPlateCount(meals?.night);
  } else if (allocations) {
    morningPlates =
      allocations.morning?.mode === 'custom' && Array.isArray(allocations.morning.plates)
        ? allocations.morning.plates.length
        : (allocations.morning?.physicalPlates ?? getMealPlateCount(meals?.morning));
    nightPlates =
      allocations.night?.mode === 'custom' && Array.isArray(allocations.night.plates)
        ? allocations.night.plates.length
        : (allocations.night?.physicalPlates ?? getMealPlateCount(meals?.night));
  } else {
    const counts = getPlateCounts(meals);
    morningPlates = counts.morning;
    nightPlates = counts.night;
  }

  const totalPlates = morningPlates + nightPlates;

  return (
    <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label={label}>
      {/* Morning Tile */}
      <div className="flex flex-col items-center justify-center p-2 sm:p-2.5 rounded-lg border border-amber-200/70 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-950/20 text-center transition-colors">
        <span className="flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-300">
          <SunMedium className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>Morning</span>
        </span>
        <strong className="text-xs sm:text-sm md:text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
          {formatPlateCount(morningPlates)}
        </strong>
      </div>

      {/* Night Tile */}
      <div className="flex flex-col items-center justify-center p-2 sm:p-2.5 rounded-lg border border-indigo-200/70 bg-indigo-50/50 dark:border-indigo-900/30 dark:bg-indigo-950/20 text-center transition-colors">
        <span className="flex items-center gap-1 text-[11px] font-medium text-indigo-800 dark:text-indigo-300">
          <Moon className="h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <span>Night</span>
        </span>
        <strong className="text-xs sm:text-sm md:text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
          {formatPlateCount(nightPlates)}
        </strong>
      </div>

      {/* Total Tile */}
      <div className="flex flex-col items-center justify-center p-2 sm:p-2.5 rounded-lg border border-teal-200/70 bg-teal-50/50 dark:border-teal-900/30 dark:bg-teal-950/20 text-center transition-colors">
        <span className="flex items-center gap-1 text-[11px] font-medium text-teal-800 dark:text-teal-300">
          <Utensils className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
          <span>Total</span>
        </span>
        <strong className="text-xs sm:text-sm md:text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
          {formatPlateCount(totalPlates)}
        </strong>
      </div>
    </section>
  );
}
