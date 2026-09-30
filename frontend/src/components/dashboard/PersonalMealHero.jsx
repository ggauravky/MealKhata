import { Check, X } from 'lucide-react';

export function PersonalMealHero({ hero, isOnline = true, pendingRow = '', onChange }) {
  if (!hero) return null;

  const { morning, night, canEdit } = hero;

  return (
    <section className="panel personal-hero-card" aria-labelledby="personal-hero-title">
      <div className="personal-hero-card__header">
        <div>
          <span className="section-eyebrow">YOUR MEALS TODAY</span>
          <h2 id="personal-hero-title">Today&apos;s Meal Choice</h2>
        </div>
      </div>

      <div className="personal-hero-grid">
        {/* Morning Slot */}
        <div className={`personal-slot personal-slot--${morning}`}>
          <div className="personal-slot__info">
            <span className="personal-slot__meal">Morning Meal</span>
            <strong className={`personal-slot__status status-text--${morning}`}>
              {morning === 'taking' ? (
                <>
                  <Check size={16} aria-hidden="true" /> Taking
                </>
              ) : (
                <>
                  <X size={16} aria-hidden="true" /> Skip
                </>
              )}
            </strong>
          </div>
          {canEdit && (
            <div className="meal-switch" role="group" aria-label="Morning meal choice">
              <button
                type="button"
                className={`meal-switch__btn ${morning === 'taking' ? 'is-active is-taking' : ''}`}
                aria-pressed={morning === 'taking'}
                disabled={!isOnline || pendingRow === `morning:${hero.memberId}`}
                onClick={() => isOnline && onChange('morning', hero.memberId, 'taking')}
              >
                Taking
              </button>
              <button
                type="button"
                className={`meal-switch__btn ${morning === 'skip' ? 'is-active is-skip' : ''}`}
                aria-pressed={morning === 'skip'}
                disabled={!isOnline || pendingRow === `morning:${hero.memberId}`}
                onClick={() => isOnline && onChange('morning', hero.memberId, 'skip')}
              >
                Skip
              </button>
            </div>
          )}
        </div>

        {/* Night Slot */}
        <div className={`personal-slot personal-slot--${night}`}>
          <div className="personal-slot__info">
            <span className="personal-slot__meal">Night Meal</span>
            <strong className={`personal-slot__status status-text--${night}`}>
              {night === 'taking' ? (
                <>
                  <Check size={16} aria-hidden="true" /> Taking
                </>
              ) : (
                <>
                  <X size={16} aria-hidden="true" /> Skip
                </>
              )}
            </strong>
          </div>
          {canEdit && (
            <div className="meal-switch" role="group" aria-label="Night meal choice">
              <button
                type="button"
                className={`meal-switch__btn ${night === 'taking' ? 'is-active is-taking' : ''}`}
                aria-pressed={night === 'taking'}
                disabled={!isOnline || pendingRow === `night:${hero.memberId}`}
                onClick={() => isOnline && onChange('night', hero.memberId, 'taking')}
              >
                Taking
              </button>
              <button
                type="button"
                className={`meal-switch__btn ${night === 'skip' ? 'is-active is-skip' : ''}`}
                aria-pressed={night === 'skip'}
                disabled={!isOnline || pendingRow === `night:${hero.memberId}`}
                onClick={() => isOnline && onChange('night', hero.memberId, 'skip')}
              >
                Skip
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
