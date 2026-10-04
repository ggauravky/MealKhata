import { Moon, SunMedium, Users } from 'lucide-react';
import { formatPaise } from '../../lib/money.js';
import { formatPlateFraction } from '../../lib/plates.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Badge } from '../ui/badge.jsx';

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
    <Card className="border-slate-200/90 dark:border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
          My meals today
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Morning Slot */}
          <div
            className={`flex flex-col justify-between rounded-lg border p-4 transition-colors ${
              morning === 'taking'
                ? 'border-emerald-200/80 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20'
                : 'border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40'
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <SunMedium className="h-4 w-4 text-amber-500" />
                  <span>Morning</span>
                </span>
                {isMorningShared && (
                  <Badge variant="shared" className="gap-1 text-[10px] py-0 px-1.5">
                    <Users className="h-3 w-3" />
                    <span>Shared</span>
                  </Badge>
                )}
              </div>

              <div className="mt-2.5 flex items-baseline gap-2">
                <span
                  className={`text-lg font-bold tracking-tight ${
                    morning === 'taking'
                      ? 'text-emerald-800 dark:text-emerald-300'
                      : morning === 'skip'
                        ? 'text-slate-600 dark:text-slate-400'
                        : 'text-slate-400 dark:text-slate-500 font-medium'
                  }`}
                >
                  {morning === 'taking' ? 'Taking' : morning === 'skip' ? 'Skip' : 'Not set'}
                </span>
              </div>

              {morning === 'taking' ? (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {isMorningShared ? (
                    <>
                      <span>Share: <strong>{formatPlateFraction(morningShareUnits)} plate</strong></span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-200">
                        {formatPaise(morningCostPaise)}
                      </span>
                    </>
                  ) : (
                    <span>Cost: <strong>{formatPaise(morningCostPaise || 5000)}</strong></span>
                  )}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Cost: <strong>₹0</strong>
                </p>
              )}
            </div>

            {canEdit && (
              <div
                className="mt-4 flex rounded-md bg-slate-200/60 p-0.5 dark:bg-slate-800/80"
                role="group"
                aria-label="Morning meal choice"
              >
                <button
                  type="button"
                  aria-pressed={morning === 'taking'}
                  disabled={!isOnline || pendingRow === `morning:${hero.memberId}`}
                  onClick={() => isOnline && onChange('morning', hero.memberId, 'taking')}
                  className={`flex-1 rounded-sm py-1.5 text-xs font-medium transition-all ${
                    morning === 'taking'
                      ? 'bg-emerald-600 text-white shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Taking
                </button>
                <button
                  type="button"
                  aria-pressed={morning === 'skip'}
                  disabled={!isOnline || pendingRow === `morning:${hero.memberId}`}
                  onClick={() => isOnline && onChange('morning', hero.memberId, 'skip')}
                  className={`flex-1 rounded-sm py-1.5 text-xs font-medium transition-all ${
                    morning === 'skip'
                      ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Skip
                </button>
              </div>
            )}
          </div>

          {/* Night Slot */}
          <div
            className={`flex flex-col justify-between rounded-lg border p-4 transition-colors ${
              night === 'taking'
                ? 'border-emerald-200/80 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20'
                : 'border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40'
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <Moon className="h-4 w-4 text-indigo-500" />
                  <span>Night</span>
                </span>
                {isNightShared && (
                  <Badge variant="shared" className="gap-1 text-[10px] py-0 px-1.5">
                    <Users className="h-3 w-3" />
                    <span>Shared</span>
                  </Badge>
                )}
              </div>

              <div className="mt-2.5 flex items-baseline gap-2">
                <span
                  className={`text-lg font-bold tracking-tight ${
                    night === 'taking'
                      ? 'text-emerald-800 dark:text-emerald-300'
                      : night === 'skip'
                        ? 'text-slate-600 dark:text-slate-400'
                        : 'text-slate-400 dark:text-slate-500 font-medium'
                  }`}
                >
                  {night === 'taking' ? 'Taking' : night === 'skip' ? 'Skip' : 'Not set'}
                </span>
              </div>

              {night === 'taking' ? (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {isNightShared ? (
                    <>
                      <span>Share: <strong>{formatPlateFraction(nightShareUnits)} plate</strong></span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-200">
                        {formatPaise(nightCostPaise)}
                      </span>
                    </>
                  ) : (
                    <span>Cost: <strong>{formatPaise(nightCostPaise || 7000)}</strong></span>
                  )}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Cost: <strong>₹0</strong>
                </p>
              )}
            </div>

            {canEdit && (
              <div
                className="mt-4 flex rounded-md bg-slate-200/60 p-0.5 dark:bg-slate-800/80"
                role="group"
                aria-label="Night meal choice"
              >
                <button
                  type="button"
                  aria-pressed={night === 'taking'}
                  disabled={!isOnline || pendingRow === `night:${hero.memberId}`}
                  onClick={() => isOnline && onChange('night', hero.memberId, 'taking')}
                  className={`flex-1 rounded-sm py-1.5 text-xs font-medium transition-all ${
                    night === 'taking'
                      ? 'bg-emerald-600 text-white shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Taking
                </button>
                <button
                  type="button"
                  aria-pressed={night === 'skip'}
                  disabled={!isOnline || pendingRow === `night:${hero.memberId}`}
                  onClick={() => isOnline && onChange('night', hero.memberId, 'skip')}
                  className={`flex-1 rounded-sm py-1.5 text-xs font-medium transition-all ${
                    night === 'skip'
                      ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Skip
                </button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
