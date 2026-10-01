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
    morningPlates = (allocations.morning?.mode === 'custom' && Array.isArray(allocations.morning.plates))
      ? allocations.morning.plates.length
      : getMealPlateCount(meals?.morning);
    nightPlates = (allocations.night?.mode === 'custom' && Array.isArray(allocations.night.plates))
      ? allocations.night.plates.length
      : getMealPlateCount(meals?.night);
  } else {
    const counts = getPlateCounts(meals);
    morningPlates = counts.morning;
    nightPlates = counts.night;
  }

  const totalPlates = morningPlates + nightPlates;

  return (
    <section className="plate-summary" aria-label={label}>
      <div><span>Morning</span><strong>{formatPlateCount(morningPlates)}</strong></div>
      <div><span>Night</span><strong>{formatPlateCount(nightPlates)}</strong></div>
      <div className="plate-summary__total"><span>Total</span><strong>{formatPlateCount(totalPlates)}</strong></div>
    </section>
  );
}
