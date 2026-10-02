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
import { Skeleton } from '../components/ui/skeleton.jsx';
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

  const isMember = auth.role === 'member';
  const isAdminOrSuper = auth.role === 'admin' || auth.role === 'superadmin';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header section with live status indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800/80 pb-4">
        <PageHeader
          eyebrow={data?.today ? formatLogicalDate(data.today) : 'Today'}
          title={data?.greeting || 'Good day'}
        />
        <div className="self-start sm:self-center">
          <LiveIndicator connected={dashboard.live} />
        </div>
      </div>

      {dashboard.loading && !data && (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-60 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      )}

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
          {saveError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {saveError}
            </div>
          )}

          {saveMessage && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs text-teal-800 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-300"
            >
              {saveMessage}
            </div>
          )}

          {/* Attention items if present */}
          <AttentionSection items={data.attention} />

          {/* Member view: 1. Personal Meals Today */}
          {isMember && data.personalHero && (
            <PersonalMealHero
              hero={data.personalHero}
              isOnline={isOnline}
              pendingRow={pendingRow}
              onChange={handleMealChange}
            />
          )}

          {/* 2. Today's Household Kitchen Plate Summary */}
          <HouseholdTodayCard
            household={data.householdToday}
            today={data.today}
            role={auth.role}
            isDefaultSchedule={!data.meals?.saved}
          />

          {/* Admin / SuperAdmin View: Detailed Meal Management */}
          {isAdminOrSuper && data.meals && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            </div>
          )}

          {/* Monthly financial summary */}
          {data.currentMonth?.personal && (
            <PersonalMonthlyCard personal={data.currentMonth.personal} />
          )}

          {data.currentMonth?.household && (
            <HouseholdMonthlyCard household={data.currentMonth.household} />
          )}

          {/* Reminder widget */}
          {data.reminders && (
            <NextReminderCard reminders={data.reminders} />
          )}

          {/* Quick Shortcuts */}
          <QuickActionsCard actions={data.quickActions} />
        </>
      )}
    </div>
  );
}
