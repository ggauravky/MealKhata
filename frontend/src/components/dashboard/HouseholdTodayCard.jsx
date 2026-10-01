import { CookingPot, UtensilsCrossed } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatPlateCount, formatPlateFraction } from '../../lib/plates.js';

export function HouseholdTodayCard({ household, today, role }) {
  if (!household) return null;

  const {
    morningPlates = 0,
    nightPlates = 0,
    totalPlates = 0,
    morningEating = 0,
    nightEating = 0,
    members = [],
  } = household;
  const canManage = role === 'admin' || role === 'superadmin';

  return (
    <section className="panel household-today-card" aria-labelledby="household-today-title">
      <div className="household-today-card__header">
        <div>
          <span className="section-eyebrow">HOUSEHOLD TODAY</span>
          <h2 id="household-today-title">Kitchen Plate Summary</h2>
        </div>
        {canManage && (
          <Link
            className="button button--secondary button--compact"
            to={`/admin?date=${today}`}
          >
            <UtensilsCrossed size={16} aria-hidden="true" />
            Manage Today
          </Link>
        )}
      </div>

      <div className="plate-metric-row">
        <div className="plate-metric-card plate-metric-card--morning">
          <span className="plate-metric-card__label">Morning Meal</span>
          <strong className="plate-metric-card__value">
            {formatPlateCount(morningPlates)}
          </strong>
          <span className="plate-metric-card__subtitle">
            {morningEating} {morningEating === 1 ? 'person eating' : 'people eating'}
          </span>
        </div>

        <div className="plate-metric-card plate-metric-card--night">
          <span className="plate-metric-card__label">Night Meal</span>
          <strong className="plate-metric-card__value">
            {formatPlateCount(nightPlates)}
          </strong>
          <span className="plate-metric-card__subtitle">
            {nightEating} {nightEating === 1 ? 'person eating' : 'people eating'}
          </span>
        </div>

        <div className="plate-metric-card plate-metric-card--total">
          <span className="plate-metric-card__label">Total Physical</span>
          <strong className="plate-metric-card__value">
            <CookingPot size={18} aria-hidden="true" />
            {formatPlateCount(totalPlates)}
          </strong>
          <span className="plate-metric-card__subtitle">ordered today</span>
        </div>
      </div>

      <div className="household-member-list" aria-label="Roommate meal status">
        {members.map((member) => {
          const morningShareStr = member.morningShareUnits !== undefined && member.morningShareUnits < 6 && member.morningShareUnits > 0
            ? ` (${formatPlateFraction(member.morningShareUnits)})`
            : '';
          const nightShareStr = member.nightShareUnits !== undefined && member.nightShareUnits < 6 && member.nightShareUnits > 0
            ? ` (${formatPlateFraction(member.nightShareUnits)})`
            : '';
          const totalPlateDisplay = member.totalShareUnits !== undefined
            ? `${formatPlateFraction(member.totalShareUnits)} ${member.totalShareUnits === 6 ? 'plate' : 'plates'}`
            : formatPlateCount(member.plates ?? 0);

          return (
            <div key={member.memberId} className="household-member-row">
              <div className="household-member-row__name">
                <span className={`avatar avatar--${member.memberId}`} aria-hidden="true">
                  {member.name.charAt(0)}
                </span>
                <span>{member.name}</span>
              </div>
              <div className="household-member-row__meals">
                <span className={`badge-pill badge-pill--${member.morning}`}>
                  M: {member.morning === 'taking' ? `Taking${morningShareStr}` : 'Skip'}
                </span>
                <span className={`badge-pill badge-pill--${member.night}`}>
                  N: {member.night === 'taking' ? `Taking${nightShareStr}` : 'Skip'}
                </span>
                <span className="household-member-row__count">
                  {totalPlateDisplay}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
