import { ChevronLeft, ChevronRight, Moon, SunMedium, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { MealCard } from '../components/meals/MealCard.jsx';
import { PlateSummary } from '../components/meals/PlateSummary.jsx';
import { Card, CardContent, CardHeader } from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { useCalendarMonth } from '../hooks/useCalendarMonth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useServerToday } from '../hooks/useServerToday.js';
import { useSettlement } from '../hooks/useSettlement.js';
import { formatLogicalDate } from '../lib/logicalDate.js';
import {
  addLogicalMonths,
  formatLogicalMonth,
  getMondayFirstOffset,
  isValidLogicalMonth,
} from '../lib/logicalMonth.js';

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarPage() {
  useDocumentTitle('Calendar');
  const serverToday = useServerToday();
  const [searchParams] = useSearchParams();
  const queryMonth = searchParams.get('month');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  const month =
    selectedMonth ||
    (isValidLogicalMonth(queryMonth) ? queryMonth : serverToday.date.slice(0, 7));
  const calendar = useCalendarMonth(month);
  const settlement = useSettlement(month);
  const isMonthClosed = settlement.isClosed;

  const fallbackDate = calendar.data?.today.startsWith(month)
    ? calendar.data.today
    : calendar.data?.days[0]?.date;
  const activeDate = selectedDate.startsWith(`${month}-`) ? selectedDate : fallbackDate;
  const activeDay = calendar.data?.days.find((day) => day.date === activeDate);

  const leadingCells = calendar.data ? getMondayFirstOffset(calendar.data.days[0].date) : 0;
  const trailingCells = calendar.data
    ? (7 - ((leadingCells + calendar.data.days.length) % 7)) % 7
    : 0;

  const moveMonth = (amount) => {
    if (month) {
      setSelectedMonth(addLogicalMonths(month, amount));
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Calendar"
        description="Physical plate requirements across each day. Cells show physical plates ordered for morning and night."
      />

      {serverToday.error && (
        <ErrorState title="Calendar unavailable" message={serverToday.error} />
      )}

      {month && (
        <Card className="border-slate-200/90 dark:border-slate-800">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800/80">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {formatLogicalMonth(month)}
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {calendar.loading ? 'Updating...' : 'Monthly plate schedule'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => moveMonth(-1)}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs font-medium"
                onClick={() => {
                  setSelectedMonth(serverToday.date.slice(0, 7));
                  setSelectedDate(serverToday.date);
                }}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => moveMonth(1)}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <input
                type="month"
                value={month}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="h-8 rounded-sm border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 ml-1 cursor-pointer"
                aria-label="Jump to month"
              />
            </div>
          </CardHeader>

          <CardContent className="pt-4">
            {calendar.error && (
              <ErrorState
                title="Unable to load calendar"
                message={calendar.error}
                actionLabel="Try again"
                onAction={calendar.refresh}
              />
            )}

            {calendar.loading && !calendar.data && (
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: 35 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-md" />
                ))}
              </div>
            )}

            {calendar.data && (
              <div
                className="month-calendar"
                aria-label={`${formatLogicalMonth(month)} meal calendar`}
              >
                {/* Weekday labels */}
                <div className="grid grid-cols-7 gap-1.5 mb-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {weekdays.map((weekday) => (
                    <div key={weekday} className="py-1">
                      {weekday}
                    </div>
                  ))}
                </div>

                {/* Day cells */}
                <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                  {Array.from({ length: leadingCells }, (_, index) => (
                    <div
                      key={`leading-${index}`}
                      className="min-h-[64px] sm:min-h-[72px] rounded-lg bg-slate-50/50 dark:bg-slate-900/30 opacity-40 border border-transparent"
                      aria-hidden="true"
                    />
                  ))}

                  {calendar.data.days.map((day) => {
                    const isToday = day.date === calendar.data.today;
                    const isSelected = day.date === activeDate;
                    const morningPlates =
                      day.counts.morningPhysicalPlates ?? day.counts.morningTaking ?? 0;
                    const nightPlates =
                      day.counts.nightPhysicalPlates ?? day.counts.nightTaking ?? 0;

                    return (
                      <button
                        key={day.date}
                        type="button"
                        onClick={() => setSelectedDate(day.date)}
                        aria-pressed={isSelected}
                        aria-current={isToday ? 'date' : undefined}
                        className={`flex flex-col justify-between min-h-[64px] sm:min-h-[72px] p-1.5 sm:p-2 rounded-lg border text-left transition-all ${
                          isSelected
                            ? 'border-teal-600 bg-teal-50/60 shadow-xs dark:border-teal-500 dark:bg-teal-950/40 ring-1 ring-teal-600/30'
                            : 'border-slate-200/70 bg-white hover:bg-slate-50/80 hover:border-slate-300 dark:border-slate-800/80 dark:bg-[#171a1f] dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span
                            className={`text-xs font-semibold inline-flex items-center justify-center ${
                              isToday
                                ? 'h-5 w-5 rounded-full bg-teal-700 text-white dark:bg-teal-500 dark:text-slate-950'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {Number(day.date.slice(-2))}
                          </span>
                          {day.hasCustomAllocation && (
                            <span
                              title="Shared plates configured"
                              className="text-purple-600 dark:text-purple-400"
                            >
                              <Users className="h-3 w-3" />
                            </span>
                          )}
                        </div>

                        {/* Morning & Night indicators */}
                        <div className="mt-1 space-y-0.5 text-[10px] sm:text-[11px] font-medium leading-none">
                          <span className="flex items-center gap-1 text-amber-800 dark:text-amber-300/90">
                            <SunMedium className="h-2.5 w-2.5 shrink-0 hidden sm:inline" />
                            <span>M {morningPlates}</span>
                          </span>
                          <span className="flex items-center gap-1 text-indigo-800 dark:text-indigo-300/90">
                            <Moon className="h-2.5 w-2.5 shrink-0 hidden sm:inline" />
                            <span>N {nightPlates}</span>
                          </span>
                        </div>
                      </button>
                    );
                  })}

                  {Array.from({ length: trailingCells }, (_, index) => (
                    <div
                      key={`trailing-${index}`}
                      className="min-h-[64px] sm:min-h-[72px] rounded-lg bg-slate-50/50 dark:bg-slate-900/30 opacity-40 border border-transparent"
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Selected day detail view */}
      {activeDay && (
        <Card className="border-slate-200/90 dark:border-slate-800">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3">
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Selected date
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {formatLogicalDate(activeDay.date, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </h3>
              {!activeDay.saved ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Nothing entered yet
                </p>
              ) : activeDay.counts?.morningTaking === 0 && activeDay.counts?.nightTaking === 0 && (activeDay.counts?.morningSkipping > 0 || activeDay.counts?.nightSkipping > 0) ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  All meals skipped
                </p>
              ) : null}
            </div>

            {isMonthClosed ? (
              <Badge variant="secondary" className="text-xs">
                Month closed
              </Badge>
            ) : (
              activeDay.permissions?.canEdit && (
                <Button variant="outline" size="sm" asChild className="h-8 text-xs">
                  <Link to={`/admin?date=${activeDay.date}`}>Manage meals</Link>
                </Button>
              )
            )}
          </CardHeader>

          <CardContent className="space-y-4">
            <PlateSummary
              meals={activeDay.meals}
              allocations={activeDay.allocations}
              label={`Physical plate count for ${activeDay.date}`}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MealCard
                mealType="morning"
                title="Morning"
                meals={activeDay.meals.morning}
                allocation={activeDay.allocations?.morning}
              />
              <MealCard
                mealType="night"
                title="Night"
                meals={activeDay.meals.night}
                allocation={activeDay.allocations?.night}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
