import { AlertCircle, Check, Info, Plus, Trash2, Utensils, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePwa } from '../../hooks/usePwa.js';
import { api } from '../../lib/api.js';
import { ROOMMATES } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';
import {
  formatPlateFraction,
  formatPlateFractionAccessible,
  MAX_PHYSICAL_PLATES,
  MEAL_PRICES,
  SHARE_UNITS_PER_PLATE,
  splitMealCost,
  validatePlateAllocation,
} from '../../lib/plates.js';

const PRESET_OPTIONS = [
  { id: 'individual', label: 'Individual Plates', desc: '1 full plate per eating member' },
  { id: '1_plate_2_people', label: '1 Plate → 2 People', desc: '½ plate each (shared)' },
  { id: '1_plate_3_people', label: '1 Plate → 3 People', desc: '⅓ plate each (shared)' },
  { id: '2_plates_3_equal', label: '2 Plates → 3 Equal', desc: '⅔ plate each (2 plates shared)' },
  { id: '2_plates_1_full_2_half', label: '2 Plates → 1 Full + 2 Half', desc: '1 member gets full, 2 share 1' },
  { id: '3_plates_3_full', label: '3 Plates → 3 Full', desc: '1 full plate for all 3 members' },
  { id: 'custom', label: 'Custom Shares', desc: 'Configure physical plates manually' },
];

const SHARE_CHOICES = [
  { units: 0, label: 'None', srLabel: '0 plates' },
  { units: 2, label: '⅓', srLabel: 'one third plate' },
  { units: 3, label: '½', srLabel: 'half plate' },
  { units: 4, label: '⅔', srLabel: 'two thirds plate' },
  { units: 6, label: '1', srLabel: 'one full plate' },
];

const MEMBER_IDS = ROOMMATES.map((r) => r.id);

export function PlateSharingDialog({
  date,
  mealType,
  currentAllocation = null,
  currentMeals = {},
  onClose,
  onSaved,
}) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(document.activeElement);
  const { isOnline } = usePwa();

  const [preset, setPreset] = useState(() => {
    if (currentAllocation && currentAllocation.mode === 'custom') {
      return 'custom';
    }
    return 'individual';
  });

  // Sub-parameters for presets
  const [selectedTwo, setSelectedTwo] = useState(['gaurav', 'nikhil']);
  const [fullMemberId, setFullMemberId] = useState('gaurav');

  // Custom plates state
  const [customPlates, setCustomPlates] = useState(() => {
    if (currentAllocation?.mode === 'custom' && Array.isArray(currentAllocation.plates) && currentAllocation.plates.length > 0) {
      return currentAllocation.plates.map((p) => ({
        shares: Object.fromEntries(MEMBER_IDS.map((id) => [id, p.shares?.[id] ?? 0])),
      }));
    }
    return [
      { shares: { gaurav: 3, nikhil: 3, devansh: 0 } },
    ];
  });

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const previousFocus = previousFocusRef.current;
    dialogRef.current?.showModal();
    return () => previousFocus?.focus?.();
  }, []);

  const closeDialog = () => {
    if (!saving) {
      onClose();
    }
  };

  // Derive allocation structure based on preset
  const computedAllocation = useMemo(() => {
    if (preset === 'individual') {
      // 1 plate per taking member
      const plates = [];
      for (const id of MEMBER_IDS) {
        if (currentMeals[id] === 'taking') {
          const shares = Object.fromEntries(MEMBER_IDS.map((m) => [m, 0]));
          shares[id] = 6;
          plates.push({ shares });
        }
      }
      return { mode: 'default', plates };
    }

    if (preset === '1_plate_2_people') {
      const shares = Object.fromEntries(MEMBER_IDS.map((id) => [id, 0]));
      shares[selectedTwo[0]] = 3;
      shares[selectedTwo[1]] = 3;
      return { mode: 'custom', plates: [{ shares }] };
    }

    if (preset === '1_plate_3_people') {
      const shares = Object.fromEntries(MEMBER_IDS.map((id) => [id, 2]));
      return { mode: 'custom', plates: [{ shares }] };
    }

    if (preset === '2_plates_3_equal') {
      return {
        mode: 'custom',
        plates: [
          { shares: Object.fromEntries(MEMBER_IDS.map((id) => [id, 2])) },
          { shares: Object.fromEntries(MEMBER_IDS.map((id) => [id, 2])) },
        ],
      };
    }

    if (preset === '2_plates_1_full_2_half') {
      const otherTwo = MEMBER_IDS.filter((id) => id !== fullMemberId);
      const plate1 = { shares: Object.fromEntries(MEMBER_IDS.map((id) => [id, 0])) };
      plate1.shares[fullMemberId] = 6;
      const plate2 = { shares: Object.fromEntries(MEMBER_IDS.map((id) => [id, 0])) };
      plate2.shares[otherTwo[0]] = 3;
      plate2.shares[otherTwo[1]] = 3;
      return { mode: 'custom', plates: [plate1, plate2] };
    }

    if (preset === '3_plates_3_full') {
      return {
        mode: 'custom',
        plates: MEMBER_IDS.map((id) => {
          const shares = Object.fromEntries(MEMBER_IDS.map((m) => [m, 0]));
          shares[id] = 6;
          return { shares };
        }),
      };
    }

    // Custom mode
    return {
      mode: 'custom',
      plates: customPlates.map((p) => ({
        shares: Object.fromEntries(MEMBER_IDS.map((id) => [id, p.shares?.[id] ?? 0])),
      })),
    };
  }, [preset, selectedTwo, fullMemberId, customPlates, currentMeals]);

  // Validation
  const validationResult = useMemo(() => {
    try {
      if (computedAllocation.mode === 'default') {
        return { valid: true, error: null };
      }
      validatePlateAllocation(computedAllocation);
      return { valid: true, error: null };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }, [computedAllocation]);

  // Live bill preview
  const livePreview = useMemo(() => {
    try {
      return splitMealCost({
        date,
        mealType,
        effectiveAllocation: computedAllocation,
        pricePaise: MEAL_PRICES[mealType],
      });
    } catch {
      return null;
    }
  }, [date, mealType, computedAllocation]);

  // Custom plate handlers
  const handleAddPlate = () => {
    if (customPlates.length >= MAX_PHYSICAL_PLATES) return;
    setCustomPlates((prev) => [
      ...prev,
      { shares: Object.fromEntries(MEMBER_IDS.map((id) => [id, 0])) },
    ]);
  };

  const handleRemovePlate = (index) => {
    if (customPlates.length <= 1) return;
    setCustomPlates((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCustomShareChange = (plateIndex, memberId, units) => {
    setCustomPlates((prev) => {
      const next = prev.map((p, i) => {
        if (i !== plateIndex) return p;
        return {
          ...p,
          shares: {
            ...p.shares,
            [memberId]: units,
          },
        };
      });
      return next;
    });
  };

  const handleToggleTwoMember = (id) => {
    setSelectedTwo((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 2) return prev; // Keep at least 2
        return prev.filter((m) => m !== id);
      }
      if (prev.length < 2) {
        return [...prev, id];
      }
      // Replace second element
      return [prev[0], id];
    });
  };

  const handleSave = async () => {
    if (!isOnline) {
      setErrorMessage('Connect to the internet to change plate sharing.');
      return;
    }

    if (!validationResult.valid) {
      setErrorMessage(validationResult.error);
      return;
    }

    setSaving(true);
    setErrorMessage('');

    try {
      if (computedAllocation.mode === 'default') {
        const response = await api.delete(`/api/meals/${date}/${mealType}/allocation`);
        onSaved?.(response.data);
      } else {
        const response = await api.put(`/api/meals/${date}/${mealType}/allocation`, {
          plates: computedAllocation.plates,
        });
        onSaved?.(response.data);
      }
      onClose();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to save plate allocation.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToIndividual = async () => {
    if (!isOnline) {
      setErrorMessage('Connect to the internet to change plate sharing.');
      return;
    }

    setSaving(true);
    setErrorMessage('');

    try {
      const response = await api.delete(`/api/meals/${date}/${mealType}/allocation`);
      onSaved?.(response.data);
      onClose();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to reset plate allocation.');
    } finally {
      setSaving(false);
    }
  };

  const mealPricePaise = MEAL_PRICES[mealType] ?? 5000;
  const mealName = mealType === 'morning' ? 'Morning' : 'Night';

  return (
    <dialog
      className="plate-dialog"
      ref={dialogRef}
      aria-labelledby="plate-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        closeDialog();
      }}
    >
      <div className="plate-dialog__header">
        <div className="plate-dialog__header-copy">
          <span className="plate-dialog__eyebrow">
            {mealName} Meal · Fixed {formatPaise(mealPricePaise)} / physical plate
          </span>
          <h2 id="plate-dialog-title">Configure Plate Sharing</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close dialog"
          onClick={closeDialog}
          disabled={saving}
        >
          <X size={19} aria-hidden="true" />
        </button>
      </div>

      <div className="plate-dialog__content">
        {!isOnline && (
          <div className="plate-dialog__banner plate-dialog__banner--warning">
            <AlertCircle size={16} aria-hidden="true" />
            <span>Connect to the internet to change plate sharing.</span>
          </div>
        )}

        {errorMessage && (
          <div className="plate-dialog__banner plate-dialog__banner--error" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Preset Selector */}
        <section className="plate-section">
          <label className="plate-section__title" id="preset-label">
            Choose Sharing Preset
          </label>
          <div className="plate-preset-grid" role="radiogroup" aria-labelledby="preset-label">
            {PRESET_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={preset === opt.id}
                className={`plate-preset-card ${preset === opt.id ? 'is-selected' : ''}`}
                onClick={() => setPreset(opt.id)}
              >
                <div className="plate-preset-card__header">
                  <strong>{opt.label}</strong>
                  {preset === opt.id && <Check size={16} className="plate-preset-card__check" />}
                </div>
                <span>{opt.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Preset Configuration Details */}
        {preset === '1_plate_2_people' && (
          <section className="plate-section plate-subconfig">
            <span className="plate-section__subtitle">Who is sharing this plate? (Select 2)</span>
            <div className="plate-member-toggle-group">
              {ROOMMATES.map((m) => {
                const isSelected = selectedTwo.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`plate-chip-button ${isSelected ? 'is-active' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => handleToggleTwoMember(m.id)}
                  >
                    <span className="roommate__avatar" aria-hidden="true">{m.initial}</span>
                    <span>{m.name}</span>
                    <span className="plate-chip-share">{isSelected ? '½ plate' : 'None'}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {preset === '2_plates_1_full_2_half' && (
          <section className="plate-section plate-subconfig">
            <span className="plate-section__subtitle">Who gets the 1 full plate?</span>
            <div className="plate-member-toggle-group">
              {ROOMMATES.map((m) => {
                const isFull = fullMemberId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`plate-chip-button ${isFull ? 'is-active' : ''}`}
                    aria-pressed={isFull}
                    onClick={() => setFullMemberId(m.id)}
                  >
                    <span className="roommate__avatar" aria-hidden="true">{m.initial}</span>
                    <span>{m.name}</span>
                    <span className="plate-chip-share">{isFull ? '1 full plate' : '½ plate'}</span>
                  </button>
                );
              })}
            </div>
            <p className="plate-subconfig__hint">
              The other two roommates will share the 2nd physical plate equally (½ plate each).
            </p>
          </section>
        )}

        {preset === 'custom' && (
          <section className="plate-section plate-custom-builder">
            <div className="plate-custom-header">
              <span className="plate-section__subtitle">Manual Physical Plates ({customPlates.length} of {MAX_PHYSICAL_PLATES})</span>
              {customPlates.length < MAX_PHYSICAL_PLATES && (
                <button
                  type="button"
                  className="button button--secondary button--compact"
                  onClick={handleAddPlate}
                >
                  <Plus size={15} aria-hidden="true" /> Add Plate
                </button>
              )}
            </div>

            <div className="plate-custom-list">
              {customPlates.map((plate, pIdx) => {
                const plateSum = MEMBER_IDS.reduce((sum, id) => sum + (plate.shares[id] ?? 0), 0);
                const isPlateFull = plateSum === SHARE_UNITS_PER_PLATE;
                const unitsNeeded = SHARE_UNITS_PER_PLATE - plateSum;

                return (
                  <article key={pIdx} className="plate-builder-card">
                    <div className="plate-builder-card__head">
                      <div>
                        <strong>Plate #{pIdx + 1}</strong>
                        <span className={`plate-badge ${isPlateFull ? 'plate-badge--full' : 'plate-badge--warning'}`}>
                          {plateSum} / {SHARE_UNITS_PER_PLATE} units
                          {unitsNeeded > 0 && ` (Needs ${formatPlateFraction(unitsNeeded)} more)`}
                          {unitsNeeded < 0 && ` (Over by ${formatPlateFraction(-unitsNeeded)})`}
                        </span>
                      </div>
                      {customPlates.length > 1 && (
                        <button
                          type="button"
                          className="icon-button icon-button--danger"
                          title="Remove plate"
                          aria-label={`Remove Plate #${pIdx + 1}`}
                          onClick={() => handleRemovePlate(pIdx)}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    <div className="plate-builder-members">
                      {ROOMMATES.map((m) => {
                        const curUnits = plate.shares[m.id] ?? 0;
                        return (
                          <div key={m.id} className="plate-builder-member-row">
                            <div className="plate-builder-member-row__name">
                              <span className="roommate__avatar" aria-hidden="true">{m.initial}</span>
                              <span>{m.name}</span>
                            </div>
                            <div className="plate-share-chips" role="group" aria-label={`${m.name} share on Plate #${pIdx + 1}`}>
                              {SHARE_CHOICES.map((choice) => (
                                <button
                                  key={choice.units}
                                  type="button"
                                  className={`plate-share-chip ${curUnits === choice.units ? 'is-active' : ''}`}
                                  aria-pressed={curUnits === choice.units}
                                  aria-label={`${choice.srLabel} for ${m.name}`}
                                  onClick={() => handleCustomShareChange(pIdx, m.id, choice.units)}
                                >
                                  {choice.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* Live Bill & Allocation Preview */}
        {livePreview && (
          <section className="plate-preview-panel">
            <div className="plate-preview-header">
              <span className="plate-section__title">
                <Utensils size={16} aria-hidden="true" />
                Live Cost & Plate Preview
              </span>
              <span className="plate-preview-room-total">
                {livePreview.physicalPlates} {livePreview.physicalPlates === 1 ? 'physical plate' : 'physical plates'} = {formatPaise(livePreview.roomAmountPaise)}
              </span>
            </div>

            <div className="plate-preview-grid">
              {ROOMMATES.map((m) => {
                const memData = livePreview.members[m.id] || { shareUnits: 0, amountPaise: 0 };
                const fractionStr = formatPlateFraction(memData.shareUnits);
                const a11yStr = formatPlateFractionAccessible(memData.shareUnits);
                const isEating = memData.shareUnits > 0;

                return (
                  <div key={m.id} className={`plate-preview-card ${isEating ? 'is-eating' : 'is-skipping'}`}>
                    <div className="plate-preview-card__member">
                      <span className="roommate__avatar" aria-hidden="true">{m.initial}</span>
                      <div>
                        <strong>{m.name}</strong>
                        <span className="plate-preview-fraction" aria-label={a11yStr}>
                          {isEating ? `${fractionStr} plate` : 'Skip'}
                        </span>
                      </div>
                    </div>
                    <div className="plate-preview-card__cost">
                      <strong>{formatPaise(memData.amountPaise)}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Validation Error Hint */}
        {!validationResult.valid && (
          <div className="plate-validation-note" role="status">
            <Info size={15} aria-hidden="true" />
            <span>{validationResult.error}</span>
          </div>
        )}
      </div>

      <div className="plate-dialog__actions">
        {currentAllocation?.mode === 'custom' && (
          <button
            type="button"
            className="button button--quiet"
            onClick={handleResetToIndividual}
            disabled={saving || !isOnline}
          >
            Reset to Individual
          </button>
        )}
        <button
          type="button"
          className="button button--secondary"
          onClick={closeDialog}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={handleSave}
          disabled={saving || !validationResult.valid || !isOnline}
        >
          {saving ? 'Saving Plan...' : 'Save Plate Plan'}
        </button>
      </div>
    </dialog>
  );
}
