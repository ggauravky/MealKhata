import { Check, Minus } from 'lucide-react';
import { ROOMMATES } from '../../lib/constants.js';
import { formatPlateCount, getMealPlateCount } from '../../lib/plates.js';

const statusOptions = [
  { id: 'taking', label: 'Taking' },
  { id: 'skip', label: 'Skip' },
];

export function MealCard({ mealType, title, meals, editable = false, pendingRow, onChange }) {
  const takingCount = getMealPlateCount(meals);
  const skippingCount = ROOMMATES.length - takingCount;

  return (
    <article className="meal-card">
      <header className="meal-card__header">
        <div>
          <h2>{title}</h2>
          <p><strong>{formatPlateCount(takingCount)}</strong> <span aria-hidden="true">•</span> {takingCount} taking <span aria-hidden="true">•</span> {skippingCount} skipping</p>
        </div>
      </header>

      <div className="meal-card__members">
        {ROOMMATES.map((member) => {
          const currentStatus = meals[member.id];
          const rowId = `${mealType}:${member.id}`;
          const pending = pendingRow === rowId;

          return (
            <div className="meal-member-row" key={member.id}>
              <div className="meal-member-row__person">
                <span className="roommate__avatar" aria-hidden="true">{member.initial}</span>
                <span>{member.name}</span>
              </div>

              {editable ? (
                <div className="meal-segmented" aria-label={`${member.name} ${title} status`}>
                  {statusOptions.map((option) => (
                    <button
                      className={`meal-segmented__button is-${option.id}${currentStatus === option.id ? ' is-active' : ''}`}
                      type="button"
                      key={option.id}
                      aria-pressed={currentStatus === option.id}
                      disabled={pending}
                      onClick={() => onChange(mealType, member.id, option.id)}
                    >
                      {option.id === 'taking' ? <Check size={16} aria-hidden="true" /> : <Minus size={16} aria-hidden="true" />}
                      {pending && currentStatus !== option.id ? 'Saving' : option.label}
                    </button>
                  ))}
                </div>
              ) : (
                <span className={`meal-status is-${currentStatus}`}>
                  {currentStatus === 'taking' ? <Check size={16} aria-hidden="true" /> : <Minus size={16} aria-hidden="true" />}
                  {currentStatus === 'taking' ? 'Taking' : 'Skip'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}
