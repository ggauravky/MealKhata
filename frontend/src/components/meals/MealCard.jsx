import { Check, Minus, Settings2, Utensils } from 'lucide-react';
import { ROOMMATES } from '../../lib/constants.js';
import {
  formatPlateCount,
  formatPlateFraction,
  formatPlateFractionAccessible,
  getMealPlateCount,
} from '../../lib/plates.js';

const statusOptions = [
  { id: 'taking', label: 'Taking' },
  { id: 'skip', label: 'Skip' },
];

export function MealCard({
  mealType,
  title,
  meals = {},
  allocation = null,
  allocationDetails = null,
  editable = false,
  editableMemberIds = null,
  pendingRow,
  onChange,
  canConfigureSharing = false,
  onConfigureSharing = null,
}) {
  const takingCount = getMealPlateCount(meals);

  // Derive physical plates and shared status
  let physicalPlates = takingCount;
  let isShared = false;

  if (allocationDetails) {
    physicalPlates = allocationDetails.physicalPlates ?? takingCount;
    isShared = Boolean(allocationDetails.isShared);
  } else if (allocation && allocation.mode === 'custom' && Array.isArray(allocation.plates)) {
    physicalPlates = allocation.plates.length;
    isShared = true;
  }

  // Calculate member share units if custom allocation
  const getMemberShareUnits = (memberId) => {
    if (allocationDetails?.members?.[memberId]) {
      return allocationDetails.members[memberId].shareUnits ?? 0;
    }
    if (allocation && Array.isArray(allocation.plates)) {
      return allocation.plates.reduce((sum, p) => sum + (p.shares?.[memberId] ?? 0), 0);
    }
    return meals[memberId] === 'taking' ? 6 : 0;
  };

  return (
    <article className={`meal-card meal-card--${mealType}`}>
      <header className="meal-card__header">
        <div className="meal-card__header-main">
          <div className="meal-card__title-row">
            <h2>{title}</h2>
            {isShared && (
              <span className="shared-pill" aria-label="Shared physical plates">
                <Utensils size={12} aria-hidden="true" />
                Shared plate
              </span>
            )}
          </div>
          <p>
            <strong>{takingCount} taking</strong>
            <span aria-hidden="true"> · </span>
            <span>{formatPlateCount(physicalPlates)}</span>
          </p>
        </div>

        {canConfigureSharing && onConfigureSharing && (
          <button
            type="button"
            className="button button--quiet button--compact meal-card__share-btn"
            onClick={onConfigureSharing}
            aria-label={`Configure ${title} plate sharing`}
          >
            <Settings2 size={15} aria-hidden="true" />
            Configure Sharing
          </button>
        )}
      </header>

      <div className="meal-card__members">
        {ROOMMATES.map((member) => {
          const currentStatus = meals[member.id];
          const rowId = `${mealType}:${member.id}`;
          const pending = pendingRow === rowId;
          const isRowEditable = Boolean(
            onChange && (editableMemberIds ? editableMemberIds.includes(member.id) : editable),
          );

          const shareUnits = getMemberShareUnits(member.id);
          const hasFractionalShare = isShared && shareUnits > 0 && shareUnits < 6;

          return (
            <div className="meal-member-row" key={member.id}>
              <div className="meal-member-row__person">
                <span className="roommate__avatar" aria-hidden="true">{member.initial}</span>
                <div className="meal-member-row__name-block">
                  <span>{member.name}</span>
                  {hasFractionalShare && (
                    <small
                      className="meal-member-row__share-hint"
                      aria-label={`${formatPlateFractionAccessible(shareUnits)}`}
                    >
                      {formatPlateFraction(shareUnits)} plate
                    </small>
                  )}
                </div>
              </div>

              {isRowEditable ? (
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
