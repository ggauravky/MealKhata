import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { LiveIndicator } from '../components/meals/LiveIndicator.jsx';
import { MealCard } from '../components/meals/MealCard.jsx';
import { PlateSummary } from '../components/meals/PlateSummary.jsx';
import { BrowserReminderControl } from '../components/reminders/BrowserReminderControl.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useMealDay } from '../hooks/useMealDay.js';
import { usePwa } from '../hooks/usePwa.js';
import { api } from '../lib/api.js';
import { formatLogicalDate } from '../lib/logicalDate.js';

export function DashboardPage() {
  const auth = useAuth();
  const mealDay = useMealDay('today');
  const { isOnline } = usePwa();
  const [pendingRow, setPendingRow] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  const greeting = useMemo(() => {
    if (auth.role !== 'member' || !auth.displayName) return null;
    const hour = new Date().getHours();
    let timeGreeting = 'Welcome';
    if (hour >= 5 && hour < 12) timeGreeting = 'Good morning';
    else if (hour >= 12 && hour < 17) timeGreeting = 'Good afternoon';
    else if (hour >= 17) timeGreeting = 'Good evening';
    return `${timeGreeting}, ${auth.displayName}`;
  }, [auth.role, auth.displayName]);

  const handleMealChange = async (mealType, memberId, status) => {
    if (!isOnline) {
      setSaveError("You're offline. Meal changes cannot be saved until you reconnect.");
      return;
    }

    const rowId = `${mealType}:${memberId}`;
    const currentStatus = mealDay.data?.meals?.[mealType]?.[memberId];

    if (!mealDay.data?.date || currentStatus === status || pendingRow) {
      return;
    }

    setPendingRow(rowId);
    setSaveMessage('');
    setSaveError('');

    try {
      const response = await api.patch(`/api/meals/${mealDay.data.date}`, {
        mealType,
        memberId,
        status,
      });
      mealDay.applyServerData(response.data);
      const mealLabel = mealType === 'morning' ? 'Morning' : 'Night';
      const statusLabel = status === 'taking' ? 'Taking' : 'Skip';
      setSaveMessage(response.changed ? `${mealLabel} meal changed to ${statusLabel}.` : 'Meal schedule is already up to date.');
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
          eyebrow={mealDay.data ? formatLogicalDate(mealDay.data.date) : 'India time'}
          title={greeting || 'Today'}
          description={
            auth.role === 'member'
              ? "Today's meal schedule. Tap to update your meals."
              : 'Morning and night meals for the MealKhata household.'
          }
        />
        <LiveIndicator connected={mealDay.live} />
      </div>

      {mealDay.loading && !mealDay.data && <LoadingState label="Loading today's meals" />}

      {mealDay.error && (
        <ErrorState
          title="Meals unavailable"
          message={
            !isOnline
              ? "Meal data is unavailable while offline. Connect to the internet to load today's meals."
              : mealDay.error
          }
          actionLabel="Try again"
          onAction={mealDay.refresh}
        />
      )}

      {mealDay.data && (
        <>
          {saveError && <ErrorState compact title="Change not saved" message={saveError} />}
          {saveMessage && <p className="save-feedback" role="status" aria-live="polite">{saveMessage}</p>}

          <section id="today-meals" className="meal-card-grid" aria-label="Today's meal schedule">
            <MealCard
              mealType="morning"
              title="Morning"
              meals={mealDay.data.meals.morning}
              editable={Boolean(mealDay.data.permissions?.canEdit) && isOnline}
              editableMemberIds={mealDay.data.permissions?.editableMemberIds}
              pendingRow={pendingRow}
              onChange={handleMealChange}
            />
            <MealCard
              mealType="night"
              title="Night"
              meals={mealDay.data.meals.night}
              editable={Boolean(mealDay.data.permissions?.canEdit) && isOnline}
              editableMemberIds={mealDay.data.permissions?.editableMemberIds}
              pendingRow={pendingRow}
              onChange={handleMealChange}
            />
          </section>

          <PlateSummary meals={mealDay.data.meals} label="Today's plate count" />

          <div className="meal-page-meta">
            <span>{mealDay.data.saved ? 'Saved meal schedule' : 'Default Taking schedule'}</span>
            {(auth.role === 'admin' || auth.role === 'superadmin') && (
              <Link className="text-link" to="/admin">Manage meals</Link>
            )}
          </div>
          <BrowserReminderControl />
        </>
      )}
    </div>
  );
}
