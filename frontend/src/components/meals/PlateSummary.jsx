import { formatPlateCount, getPlateCounts } from '../../lib/plates.js';

export function PlateSummary({ meals, label = 'Daily plate count' }) {
  const counts = getPlateCounts(meals);

  return (
    <section className="plate-summary" aria-label={label}>
      <div><span>Morning</span><strong>{formatPlateCount(counts.morning)}</strong></div>
      <div><span>Night</span><strong>{formatPlateCount(counts.night)}</strong></div>
      <div className="plate-summary__total"><span>Total</span><strong>{formatPlateCount(counts.total)}</strong></div>
    </section>
  );
}
