import { CookingPot, UtensilsCrossed } from 'lucide-react';
import { Link } from 'react-router-dom';

export function HouseholdTodayCard({ household, today, role }) {
  if (!household) return null;

  const { morningPlates, nightPlates, totalPlates, members } = household;
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
        <div className="plate-metric-card">
          <span className="plate-metric-card__label">Morning</span>
          <strong className="plate-metric-card__value">
            {morningPlates} {morningPlates === 1 ? 'plate' : 'plates'}
          </strong>
        </div>
        <div className="plate-metric-card">
          <span className="plate-metric-card__label">Night</span>
          <strong className="plate-metric-card__value">
            {nightPlates} {nightPlates === 1 ? 'plate' : 'plates'}
          </strong>
        </div>
        <div className="plate-metric-card plate-metric-card--total">
          <span className="plate-metric-card__label">Total Today</span>
          <strong className="plate-metric-card__value">
            <CookingPot size={18} aria-hidden="true" />
            {totalPlates} {totalPlates === 1 ? 'plate' : 'plates'}
          </strong>
        </div>
      </div>

      <div className="household-member-list" aria-label="Roommate meal status">
        {members.map((member) => (
          <div key={member.memberId} className="household-member-row">
            <div className="household-member-row__name">
              <span className={`avatar avatar--${member.memberId}`} aria-hidden="true">
                {member.name.charAt(0)}
              </span>
              <span>{member.name}</span>
            </div>
            <div className="household-member-row__meals">
              <span className={`badge-pill badge-pill--${member.morning}`}>
                M: {member.morning === 'taking' ? 'Taking' : 'Skip'}
              </span>
              <span className={`badge-pill badge-pill--${member.night}`}>
                N: {member.night === 'taking' ? 'Taking' : 'Skip'}
              </span>
              <span className="household-member-row__count">
                {member.plates} {member.plates === 1 ? 'plate' : 'plates'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
