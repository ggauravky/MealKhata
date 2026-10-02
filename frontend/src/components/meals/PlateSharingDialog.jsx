import { AlertCircle, Check, Plus, Trash2, Utensils } from 'lucide-react';
import { useMemo, useState } from 'react';
import { usePwa } from '../../hooks/usePwa.js';
import { api } from '../../lib/api.js';
import { ROOMMATES } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';
import {
  formatPlateFraction,
  MAX_PHYSICAL_PLATES,
  MEAL_PRICES,
  splitMealCost,
  validatePlateAllocation,
} from '../../lib/plates.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.jsx';
import { Button } from '../ui/button.jsx';
import { Badge } from '../ui/badge.jsx';

const PRESET_OPTIONS = [
  { id: 'individual', label: 'Individual', desc: '1 full plate per eating member' },
  { id: '1_plate_2_people', label: '1 plate · 2 people', desc: '½ plate each (shared)' },
  { id: '1_plate_3_people', label: '1 plate · 3 people', desc: '⅓ plate each (shared)' },
  { id: '2_plates_3_equal', label: '2 plates · equal', desc: '⅔ plate each (2 shared)' },
  { id: '2_plates_1_full_2_half', label: '1 full + 2 halves', desc: '1 full + 2 half plates' },
  { id: '3_plates_3_full', label: '3 individual', desc: '1 full plate each' },
  { id: 'custom', label: 'Custom', desc: 'Manual plate allocations' },
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
    if (
      currentAllocation?.mode === 'custom' &&
      Array.isArray(currentAllocation.plates) &&
      currentAllocation.plates.length > 0
    ) {
      return currentAllocation.plates.map((p) => ({
        shares: Object.fromEntries(MEMBER_IDS.map((id) => [id, p.shares?.[id] ?? 0])),
      }));
    }
    return [{ shares: { gaurav: 3, nikhil: 3, devansh: 0 } }];
  });

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const closeDialog = () => {
    if (!saving) {
      onClose();
    }
  };

  // Derive allocation structure based on preset
  const computedAllocation = useMemo(() => {
    if (preset === 'individual') {
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
        if (prev.length <= 2) return prev;
        return prev.filter((m) => m !== id);
      }
      if (prev.length < 2) {
        return [...prev, id];
      }
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

  const mealPricePaise = MEAL_PRICES[mealType] ?? 5000;
  const mealName = mealType === 'morning' ? 'Morning' : 'Night';

  return (
    <Dialog open onOpenChange={(open) => !open && closeDialog()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Plate sharing — {mealName}
            </DialogTitle>
            <Badge variant="secondary" className="text-xs font-normal">
              {formatPaise(mealPricePaise)} / plate
            </Badge>
          </div>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Configure physical plate count and member portions for {date}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Preset Selector Grid */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Select sharing plan
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PRESET_OPTIONS.map((opt) => {
                const isSelected = preset === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setPreset(opt.id);
                      setErrorMessage('');
                    }}
                    className={`flex flex-col text-left p-2.5 rounded-lg border transition-all ${
                      isSelected
                        ? 'border-teal-600 bg-teal-50/60 dark:border-teal-500 dark:bg-teal-950/40 shadow-xs ring-1 ring-teal-600/30'
                        : 'border-slate-200/80 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {opt.label}
                      </span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />}
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sub-selectors for specific presets */}
          {preset === '1_plate_2_people' && (
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80 space-y-2 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                Choose 2 people sharing this 1 plate:
              </span>
              <div className="flex gap-2">
                {ROOMMATES.map((r) => {
                  const active = selectedTwo.includes(r.id);
                  return (
                    <Button
                      key={r.id}
                      type="button"
                      variant={active ? 'default' : 'outline'}
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => handleToggleTwoMember(r.id)}
                    >
                      {r.name} {active && '✓'}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {preset === '2_plates_1_full_2_half' && (
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80 space-y-2 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                Who gets the 1 full plate? (Other two share the second plate):
              </span>
              <div className="flex gap-2">
                {ROOMMATES.map((r) => {
                  const active = fullMemberId === r.id;
                  return (
                    <Button
                      key={r.id}
                      type="button"
                      variant={active ? 'default' : 'outline'}
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setFullMemberId(r.id)}
                    >
                      {r.name} {active && '✓'}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom mode builder */}
          {preset === 'custom' && (
            <div className="space-y-3 rounded-lg border border-slate-200/80 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Physical plates ({customPlates.length} of max {MAX_PHYSICAL_PLATES})
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={customPlates.length >= MAX_PHYSICAL_PLATES}
                  onClick={handleAddPlate}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add plate</span>
                </Button>
              </div>

              <div className="space-y-2.5">
                {customPlates.map((plate, pIdx) => {
                  const plateTotalUnits = MEMBER_IDS.reduce(
                    (s, id) => s + (plate.shares?.[id] ?? 0),
                    0,
                  );
                  const isComplete = plateTotalUnits === 6;

                  return (
                    <div
                      key={pIdx}
                      className="rounded-lg border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          <span>Plate #{pIdx + 1}</span>
                          <Badge
                            variant={isComplete ? 'taking' : 'warning'}
                            className="text-[10px] py-0"
                          >
                            {isComplete ? '1 full plate (6/6)' : `${plateTotalUnits}/6 units`}
                          </Badge>
                        </span>
                        {customPlates.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleRemovePlate(pIdx)}
                            aria-label={`Remove plate ${pIdx + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                        {ROOMMATES.map((r) => {
                          const currentVal = plate.shares?.[r.id] ?? 0;
                          return (
                            <div key={r.id} className="space-y-1">
                              <span className="text-[11px] text-slate-500 block truncate">
                                {r.name}:
                              </span>
                              <div className="flex gap-1 flex-wrap">
                                {SHARE_CHOICES.map((choice) => (
                                  <button
                                    key={choice.units}
                                    type="button"
                                    onClick={() =>
                                      handleCustomShareChange(pIdx, r.id, choice.units)
                                    }
                                    className={`px-1.5 py-0.5 rounded text-[11px] font-medium border ${
                                      currentVal === choice.units
                                        ? 'bg-teal-700 text-white border-teal-700'
                                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                    }`}
                                  >
                                    {choice.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Live Cost Preview - Requirement 62: Clean Order Summary */}
          {livePreview && (
            <div className="rounded-lg border border-slate-200/90 bg-slate-50/70 p-3.5 dark:border-slate-800/90 dark:bg-slate-900/50 space-y-2">
              <div className="flex items-center justify-between text-xs border-b border-slate-200/70 dark:border-slate-800 pb-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Utensils className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400" />
                  <span>Order summary</span>
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {livePreview.physicalPlates} physical {livePreview.physicalPlates === 1 ? 'plate' : 'plates'} · {formatPaise(livePreview.totalPricePaise)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-400 pt-1">
                {ROOMMATES.map((r) => {
                  const m = livePreview.members?.[r.id];
                  const fractionStr = formatPlateFraction(m?.shareUnits ?? 0);
                  const costStr = formatPaise(m?.costPaise ?? 0);

                  return (
                    <div key={r.id} className="flex justify-between sm:flex-col">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{r.name}:</span>
                      <span className="text-slate-600 dark:text-slate-400">
                        {fractionStr} plate · {costStr}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-4">
          <Button variant="outline" size="sm" onClick={closeDialog} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={saving || !validationResult.valid || !isOnline}
          >
            {saving ? 'Saving...' : 'Save allocation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
