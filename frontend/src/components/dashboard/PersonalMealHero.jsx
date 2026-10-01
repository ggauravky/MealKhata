import { Check, Utensils, X } from 'lucide-react';
import { formatPaise } from '../../lib/money.js';
import { formatPlateFraction } from '../../lib/plates.js';

export function PersonalMealHero({ hero, isOnline = true, pendingRow = '', onChange }) {
  if (!hero) return null;

  const {
    morning,
    night,
    morningShareUnits = 0,
    nightShareUnits = 0,
    morningCostPaise = 0,
    nightCostPaise = 0,
    isMorningShared = false,
    isNightShared = false,
    canEdit,
  } = hero;

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
            <div className="personal-slot__header-line">
              <span className="personal-slot__meal">Morning Meal</span>
              {isMorningShared && (
                <span className="shared-pill shared-pill--compact" aria-label="Shared physical plate">
                  <Utensils size={11} aria-hidden="true" /> Shared
                </span>
              )}
            </div>

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

            {morning === 'taking' && (
              <p className="personal-slot__share-detail">
                {isMorningShared ? (
                  <>
                    <span>Your share: <strong>{formatPlateFraction(morningShareUnits)} plate</strong></span>
                    <span aria-hidden="true"> · </span>
                    <span className="personal-slot__cost">{formatPaise(morningCostPaise)}</span>
                  </>
                ) : (
                  <span>Cost: <strong>{formatPaise(morningCostPaise || 5000)}</strong></span>
                )}
              </p>
            )}
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
            <div className="personal-slot__header-line">
              <span className="personal-slot__meal">Night Meal</span>
              {isNightShared && (
                <span className="shared-pill shared-pill--compact" aria-label="Shared physical plate">
                  <Utensils size={11} aria-hidden="true" /> Shared
                </span>
              )}
            </div>

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

            {night === 'taking' && (
              <p className="personal-slot__share-detail">
                {isNightShared ? (
                  <>
                    <span>Your share: <strong>{formatPlateFraction(nightShareUnits)} plate</strong></span>
                    <span aria-hidden="true"> · </span>
                    <span className="personal-slot__cost">{formatPaise(nightCostPaise)}</span>
                  </>
                ) : (
                  <span>Cost: <strong>{formatPaise(nightCostPaise || 7000)}</strong></span>
                )}
              </p>
            )}
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
