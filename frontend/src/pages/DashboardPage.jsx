import { useState } from 'react';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { AttentionSection } from '../components/dashboard/AttentionSection.jsx';
import { HouseholdMonthlyCard } from '../components/dashboard/HouseholdMonthlyCard.jsx';
import { HouseholdTodayCard } from '../components/dashboard/HouseholdTodayCard.jsx';
import { NextReminderCard } from '../components/dashboard/NextReminderCard.jsx';
import { PersonalMealHero } from '../components/dashboard/PersonalMealHero.jsx';
import { PersonalMonthlyCard } from '../components/dashboard/PersonalMonthlyCard.jsx';
import { QuickActionsCard } from '../components/dashboard/QuickActionsCard.jsx';
import { LiveIndicator } from '../components/meals/LiveIndicator.jsx';
import { MealCard } from '../components/meals/MealCard.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDashboard } from '../hooks/useDashboard.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { usePwa } from '../hooks/usePwa.js';
import { api } from '../lib/api.js';
import { formatLogicalDate } from '../lib/logicalDate.js';

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const auth = useAuth();
  const { isOnline } = usePwa();
  const dashboard = useDashboard();
  const [pendingRow, setPendingRow] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  const data = dashboard.data;

  const handleMealChange = async (mealType, memberId, status) => {
    if (!isOnline) {
      setSaveError("You're offline. Meal changes cannot be saved until you reconnect.");
      return;
    }

    if (!data?.today || pendingRow) return;

    const rowId = `${mealType}:${memberId}`;
    setPendingRow(rowId);
    setSaveMessage('');
    setSaveError('');

    try {
      const response = await api.patch(`/api/meals/${data.today}`, {
        mealType,
        memberId,
        status,
      });

      if (response.data) {
        dashboard.applyMealDayUpdate(response.data);
      }

      if (response.allocationReset) {
        setSaveMessage('Your meal choice was updated. The previous shared-plate plan was reset because participants changed.');
      } else {
        const mealLabel = mealType === 'morning' ? 'Morning' : 'Night';
        const statusLabel = status === 'taking' ? 'Taking' : 'Skip';
        setSaveMessage(
          response.changed
            ? `${mealLabel} meal updated to ${statusLabel}.`
            : 'Meal schedule is already up to date.',
        );
      }
    } catch (err) {
      setSaveError(err?.message || 'Unable to save the meal change. Please try again.');
    } finally {
      setPendingRow('');
    }
  };

  const pageDescription =
    auth.role === 'member'
      ? "Today's personalized meal schedule, monthly spending, and household overview."
      : auth.role === 'admin'
        ? "Today's household plate counts, monthly meal statistics, and kitchen management."
        : auth.role === 'superadmin'
          ? 'System overview, rate configurations, monthly settlement status, and household operations.'
          : 'Public meal schedule and household plate counts.';

  return (
    <div className="page-stack">
      <div className="heading-with-status">
        <PageHeader
          eyebrow={data?.today ? formatLogicalDate(data.today) : 'India time'}
          title={data?.greeting || 'Today'}
          description={pageDescription}
        />
        <LiveIndicator connected={dashboard.live} />
      </div>

      {dashboard.loading && !data && <LoadingState label="Loading personalized dashboard" />}

      {dashboard.error && !data && (
        <ErrorState
          title="Dashboard unavailable"
          message={
            !isOnline
              ? 'Dashboard data is unavailable while offline. Connect to the internet to load current data.'
              : dashboard.error
          }
          actionLabel="Try again"
          onAction={dashboard.refresh}
        />
      )}

      {data && (
        <>
          {saveError && <ErrorState compact title="Change not saved" message={saveError} />}
          {saveMessage && (
            <p className="save-feedback" role="status" aria-live="polite">
              {saveMessage}
            </p>
          )}

          {/* 1. Member Hero: Personal Meals Today */}
          {data.personalHero && (
            <PersonalMealHero
              hero={data.personalHero}
              isOnline={isOnline}
              pendingRow={pendingRow}
              onChange={handleMealChange}
            />
          )}

          {/* 2. Attention Needed */}
          <AttentionSection items={data.attention} />

          {/* 3. Household Plate Summary */}
          <HouseholdTodayCard
            household={data.householdToday}
            today={data.today}
            role={auth.role}
          />

          {/* 4. Monthly Cards: Personal or Household */}
          {data.currentMonth?.personal && (
            <PersonalMonthlyCard personal={data.currentMonth.personal} />
          )}

          {!data.currentMonth?.personal && data.currentMonth?.household && (
            <HouseholdMonthlyCard household={data.currentMonth.household} />
          )}

          {/* 5. Detailed Household Meal Cards for Admin/SuperAdmin/Viewer */}
          {(auth.role === 'admin' || auth.role === 'superadmin') && data.meals && (
            <section id="today-meals" className="meal-card-grid" aria-label="Detailed today meals">
              <MealCard
                mealType="morning"
                title="Morning"
                meals={data.meals.morning}
                allocation={data.meals.allocations?.morning}
                allocationDetails={data.meals.allocationDetails?.morning}
                editable={Boolean(data.meals.permissions?.canEdit) && isOnline}
                editableMemberIds={data.meals.permissions?.editableMemberIds}
                pendingRow={pendingRow}
                onChange={handleMealChange}
              />
              <MealCard
                mealType="night"
                title="Night"
                meals={data.meals.night}
                allocation={data.meals.allocations?.night}
                allocationDetails={data.meals.allocationDetails?.night}
                editable={Boolean(data.meals.permissions?.canEdit) && isOnline}
                editableMemberIds={data.meals.permissions?.editableMemberIds}
                pendingRow={pendingRow}
                onChange={handleMealChange}
              />
            </section>
          )}

          {/* 6. Next Reminder */}
          <NextReminderCard reminders={data.reminders} />

          {/* 7. Quick Actions */}
          <QuickActionsCard actions={data.quickActions} />
        </>
      )}
    </div>
  );
}
