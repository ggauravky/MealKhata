import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { MealCard } from '../components/meals/MealCard.jsx';
import { PlateSummary } from '../components/meals/PlateSummary.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { useCalendarMonth } from '../hooks/useCalendarMonth.js';
import { useServerToday } from '../hooks/useServerToday.js';
import { useSettlement } from '../hooks/useSettlement.js';
import { formatLogicalDate } from '../lib/logicalDate.js';
import { addLogicalMonths, formatLogicalMonth, getMondayFirstOffset } from '../lib/logicalMonth.js';

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarPage() {
  const serverToday = useServerToday();
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const month = selectedMonth || serverToday.date.slice(0, 7);
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
    <div className="page-stack">
      <PageHeader
        title="Calendar"
        description="Explore each day's Morning and Night meal schedule. Untouched dates use the default Taking schedule."
      />

      {serverToday.error && <ErrorState title="Calendar unavailable" message={serverToday.error} />}
      {serverToday.loading && !month && <LoadingState label="Loading current month" />}

      {month && (
        <section className="panel month-panel" aria-labelledby="calendar-month">
          <div className="month-toolbar">
            <button className="button button--quiet" type="button" onClick={() => moveMonth(-1)}>
              <ChevronLeft size={17} aria-hidden="true" /> Previous
            </button>
            <div className="month-toolbar__title">
              <h2 id="calendar-month">{formatLogicalMonth(month)}</h2>
              <span>{calendar.loading ? 'Updating calendar' : 'Monthly meal schedule'}</span>
            </div>
            <button className="button button--quiet" type="button" onClick={() => moveMonth(1)}>
              Next <ChevronRight size={17} aria-hidden="true" />
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => {
                setSelectedMonth(serverToday.date.slice(0, 7));
                setSelectedDate(serverToday.date);
              }}
            >
              Today
            </button>
            <label className="month-input">
              <span className="sr-only">Choose month</span>
              <input type="month" value={month} onChange={(event) => setSelectedMonth(event.target.value)} />
            </label>
          </div>

          {calendar.error && (
            <ErrorState title="Unable to load calendar" message={calendar.error} actionLabel="Try again" onAction={calendar.refresh} />
          )}

          {calendar.loading && !calendar.data && <LoadingState label="Loading calendar" />}

          {calendar.data && (
            <div className="month-calendar" aria-label={`${formatLogicalMonth(month)} meal calendar`}>
              {weekdays.map((weekday) => <div className="month-calendar__weekday" key={weekday}>{weekday}</div>)}
              {Array.from({ length: leadingCells }, (_, index) => (
                <div className="month-calendar__outside" aria-hidden="true" key={`leading-${index}`} />
              ))}
              {calendar.data.days.map((day) => {
                const isToday = day.date === calendar.data.today;
                const isSelected = day.date === activeDate;
                const relation = day.date < calendar.data.today ? 'past' : day.date > calendar.data.today ? 'future' : 'today';

                return (
                  <button
                    className={`calendar-day is-${relation}${isSelected ? ' is-selected' : ''}${day.saved ? ' is-saved' : ''}`}
                    type="button"
                    key={day.date}
                    aria-current={isToday ? 'date' : undefined}
                    aria-pressed={isSelected}
                    aria-label={`${formatLogicalDate(day.date, { day: 'numeric', month: 'long', year: 'numeric' })}. Morning: ${day.counts.morningTaking} plates. Night: ${day.counts.nightTaking} plates.`}
                    onClick={() => setSelectedDate(day.date)}
                  >
                    <span className="calendar-day__number">{Number(day.date.slice(-2))}</span>
                    <span><strong>M</strong> {day.counts.morningTaking}</span>
                    <span><strong>N</strong> {day.counts.nightTaking}</span>
                    {day.saved && <i aria-label="Saved changes" />}
                  </button>
                );
              })}
              {Array.from({ length: trailingCells }, (_, index) => (
                <div className="month-calendar__outside" aria-hidden="true" key={`trailing-${index}`} />
              ))}
            </div>
          )}
        </section>
      )}

      {activeDay && (
        <section className="calendar-detail" aria-labelledby="selected-day-title">
          <div className="calendar-detail__heading">
            <div>
              <p>Selected date</p>
              <h2 id="selected-day-title">{formatLogicalDate(activeDay.date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
            </div>
            {isMonthClosed ? (
              <span className="settlement-status settlement-status--closed">Month closed</span>
            ) : (
              activeDay.permissions.canEdit && (
                <Link className="button button--quiet" to={`/admin?date=${activeDay.date}`}>Manage meals</Link>
              )
            )}
          </div>
          {!activeDay.saved && <p className="default-note">Using default schedule</p>}
          <PlateSummary meals={activeDay.meals} label={`Plate count for ${activeDay.date}`} />
          <div className="meal-card-grid">
            <MealCard mealType="morning" title="Morning" meals={activeDay.meals.morning} />
            <MealCard mealType="night" title="Night" meals={activeDay.meals.night} />
          </div>
        </section>
      )}
    </div>
  );
}
