import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { LiveIndicator } from '../components/meals/LiveIndicator.jsx';
import { MealCard } from '../components/meals/MealCard.jsx';
import { PlateSummary } from '../components/meals/PlateSummary.jsx';
import { ReminderSettingsPanel } from '../components/reminders/ReminderSettingsPanel.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useMealDay } from '../hooks/useMealDay.js';
import { useMealHistory } from '../hooks/useMealHistory.js';
import { usePwa } from '../hooks/usePwa.js';
import { useSettlement } from '../hooks/useSettlement.js';
import { api } from '../lib/api.js';
import { getRoleLabel } from '../lib/constants.js';
import { addLogicalDays, formatIndiaTime, formatLogicalDate, isValidLogicalDate } from '../lib/logicalDate.js';
import { formatLogicalMonth } from '../lib/logicalMonth.js';

export function AdminPage() {
  const auth = useAuth();
  const { isOnline } = usePwa();
  const [searchParams] = useSearchParams();
  const [requestedDate, setRequestedDate] = useState(() => {
    const date = searchParams.get('date');
    return isValidLogicalDate(date) ? date : 'today';
  });
  const [pendingRow, setPendingRow] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const mealDay = useMealDay(requestedDate);
  const displayedDate = mealDay.data?.date ?? '';
  const month = displayedDate ? displayedDate.slice(0, 7) : '';
  const settlement = useSettlement(month);
  const isMonthClosed = settlement.isClosed;
  const history = useMealHistory(displayedDate);

  const moveDate = (amount) => {
    if (displayedDate) {
      setRequestedDate(addLogicalDays(displayedDate, amount));
    }
  };

  const handleMealChange = async (mealType, memberId, status) => {
    if (isMonthClosed) {
      setSaveError('This month is closed. Reopen the month before editing meals.');
      return;
    }

    if (!isOnline) {
      setSaveError("You're offline. Meal changes cannot be saved until you reconnect.");
      return;
    }

    const rowId = `${mealType}:${memberId}`;
    const currentStatus = mealDay.data?.meals?.[mealType]?.[memberId];

    if (!displayedDate || currentStatus === status || pendingRow) {
      return;
    }

    setPendingRow(rowId);
    setSaveMessage('');
    setSaveError('');

    try {
      const response = await api.patch(`/api/meals/${displayedDate}`, {
        mealType,
        memberId,
        status,
      });
      mealDay.applyServerData(response.data);
      setSaveMessage(response.changed ? 'Meal change saved.' : 'Meal schedule is already up to date.');
      history.refresh();
    } catch {
      setSaveError('Unable to save the meal change. Please try again.');
    } finally {
      setPendingRow('');
    }
  };

  return (
    <div className="page-stack">
      <div className="heading-with-status">
        <PageHeader
          eyebrow={getRoleLabel(auth.role)}
          title="Meal Management"
          description="Review any logical date and update meals allowed by your role."
        />
        <LiveIndicator connected={mealDay.live} />
      </div>

      <section className="panel date-navigator" aria-labelledby="selected-date-title">
        <div>
          <p className="date-navigator__label">Selected date</p>
          <h2 id="selected-date-title">{displayedDate ? formatLogicalDate(displayedDate, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Loading date'}</h2>
        </div>
        <div className="date-navigator__controls">
          <button className="button button--quiet" type="button" onClick={() => moveDate(-1)} disabled={!displayedDate}>
            <ChevronLeft size={17} aria-hidden="true" /> Previous day
          </button>
          <button className="button button--quiet" type="button" onClick={() => setRequestedDate('today')}>Today</button>
          <button className="button button--quiet" type="button" onClick={() => moveDate(1)} disabled={!displayedDate}>
            Next day <ChevronRight size={17} aria-hidden="true" />
          </button>
          <label className="date-input">
            <span className="sr-only">Choose logical date</span>
            <input type="date" value={displayedDate} onChange={(event) => setRequestedDate(event.target.value)} />
          </label>
        </div>
      </section>

      {mealDay.loading && !mealDay.data && <LoadingState label="Loading meal schedule" />}
      {mealDay.error && <ErrorState title="Meals unavailable" message={mealDay.error} actionLabel="Try again" onAction={mealDay.refresh} />}

      {mealDay.data && (
        <>
          {!mealDay.data.permissions.canEdit && auth.role === 'admin' && (
            <p className="permission-note">Admin can edit today&apos;s meals only. This date remains view-only.</p>
          )}
          {!mealDay.data.saved && <p className="default-note">Using default schedule</p>}
          {saveError && <ErrorState compact title="Change not saved" message={saveError} />}
          <p className="save-feedback" role="status" aria-live="polite">{saveMessage}</p>

          {isMonthClosed && (
            <div className="panel settlement-banner" role="status">
              <strong>{formatLogicalMonth(month)} is closed.</strong>
              <p>Reopen the month before editing historical meals.</p>
            </div>
          )}

          <section className="meal-card-grid" aria-label={`Meal editor for ${displayedDate}`}>
            <MealCard
              mealType="morning"
              title="Morning"
              meals={mealDay.data.meals.morning}
              editable={Boolean(mealDay.data.permissions.canEdit) && isOnline && !isMonthClosed}
              editableMemberIds={mealDay.data.permissions?.editableMemberIds}
              pendingRow={pendingRow}
              onChange={handleMealChange}
            />
            <MealCard
              mealType="night"
              title="Night"
              meals={mealDay.data.meals.night}
              editable={Boolean(mealDay.data.permissions.canEdit) && isOnline && !isMonthClosed}
              editableMemberIds={mealDay.data.permissions?.editableMemberIds}
              pendingRow={pendingRow}
              onChange={handleMealChange}
            />
          </section>
          <PlateSummary meals={mealDay.data.meals} label={`Plate count for ${displayedDate}`} />
        </>
      )}

      <section className="panel history-panel" aria-labelledby="recent-changes-title">
        <div className="section-heading section-heading--compact">
          <div>
            <h2 id="recent-changes-title">Recent Changes</h2>
            <p>Newest updates for the selected date.</p>
          </div>
        </div>
        {history.loading ? (
          <LoadingState compact label="Loading recent changes" />
        ) : history.error ? (
          <ErrorState compact title="History unavailable" message={history.error} actionLabel="Try again" onAction={history.refresh} />
        ) : history.items.length === 0 ? (
          <p className="history-empty">No changes recorded for this date.</p>
        ) : (
          <ol className="history-list">
            {history.items.map((item, index) => {
              const memberName = item.memberId[0].toUpperCase() + item.memberId.slice(1);
              let actionDescription;
              if (item.actorRole === 'member' && item.actorMemberId) {
                const actorName = item.actorMemberId[0].toUpperCase() + item.actorMemberId.slice(1);
                if (item.actorMemberId === item.memberId) {
                  actionDescription = `${actorName} changed their ${item.mealType === 'morning' ? 'Morning' : 'Night'} meal`;
                } else {
                  actionDescription = `${actorName} changed ${memberName}'s ${item.mealType === 'morning' ? 'Morning' : 'Night'} meal`;
                }
              } else {
                actionDescription = `${getRoleLabel(item.actorRole)} changed ${memberName}'s ${item.mealType === 'morning' ? 'Morning' : 'Night'} meal`;
              }

              return (
                <li key={`${item.changedAt}-${item.revision ?? index}`}>
                  <time dateTime={item.changedAt}>{formatIndiaTime(item.changedAt)}</time>
                  <div>
                    <strong>{actionDescription}</strong>
                    <span>{item.from === 'taking' ? 'Taking' : 'Skip'} <span aria-hidden="true">→</span> {item.to === 'taking' ? 'Taking' : 'Skip'}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <ReminderSettingsPanel editable={auth.role === 'superadmin'} />
    </div>
  );
}
