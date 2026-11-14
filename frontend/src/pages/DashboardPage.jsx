import { UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { AttentionSection } from '../components/dashboard/AttentionSection.jsx';
import { DashboardRoomFeeCard } from '../components/dashboard/DashboardRoomFeeCard.jsx';
import { DashboardExpenseCard } from '../components/dashboard/DashboardExpenseCard.jsx';
import { HouseholdMonthlyCard } from '../components/dashboard/HouseholdMonthlyCard.jsx';
import { HouseholdTodayCard } from '../components/dashboard/HouseholdTodayCard.jsx';
import { NextReminderCard } from '../components/dashboard/NextReminderCard.jsx';
import { PersonalMealHero } from '../components/dashboard/PersonalMealHero.jsx';
import { PersonalMonthlyCard } from '../components/dashboard/PersonalMonthlyCard.jsx';
import { QuickActionsCard } from '../components/dashboard/QuickActionsCard.jsx';
import { LiveIndicator } from '../components/meals/LiveIndicator.jsx';
import { MealCard } from '../components/meals/MealCard.jsx';
import { Button } from '../components/ui/button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDashboard } from '../hooks/useDashboard.js';
import { useOperationalStudents } from '../hooks/useOperationalStudents.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useMemberFinance, useHouseholdFinance } from '../hooks/useFinance.js';
import { FinancialOverviewCard } from '../components/finance/FinancialOverviewCard.jsx';
import { FinancialHouseholdSummary } from '../components/finance/FinancialHouseholdSummary.jsx';
import { DashboardStayCard } from '../components/dashboard/DashboardStayCard.jsx';
import { usePwa } from '../hooks/usePwa.js';
import { api } from '../lib/api.js';
import { formatLogicalDate, getIndiaCurrentLogicalMonth } from '../lib/logicalDate.js';
import { resolveDayParticipants } from '../lib/operationalRoster.js';

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const auth = useAuth();
  const { isOnline } = usePwa();
  const dashboard = useDashboard();
  const studentRoster = useOperationalStudents({ includeArchived: true, enabled: auth.authenticated && auth.role !== 'viewer' });
  const [pendingRows, setPendingRows] = useState({});
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  const data = dashboard.data;
  const dayParticipants = resolveDayParticipants(data?.meals, studentRoster.data);

  const handleMealChange = async (mealType, memberId, status) => {
    if (!isOnline) {
      setSaveError("You're offline. Meal changes cannot be saved until you reconnect.");
      return;
    }

    const rowId = `${mealType}:${memberId}`;
    // Rows save independently; only a second tap on the same row waits.
    if (!data?.today || Object.hasOwn(pendingRows, rowId)) return;

    setPendingRows((rows) => ({ ...rows, [rowId]: status }));
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
        // Merges with the socket-triggered refresh so one toggle causes one refetch.
        dashboard.scheduleRefresh();
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
      setPendingRows((rows) => {
        const next = { ...rows };
        delete next[rowId];
        return next;
      });
    }
  };

  const isMember = auth.role === 'member';
  const isAdminOrSuper = auth.role === 'admin' || auth.role === 'superadmin';
  const currentMonth = data?.today ? data.today.slice(0, 7) : getIndiaCurrentLogicalMonth();
  const memberFinance = useMemberFinance(currentMonth);
  const householdFinance = useHouseholdFinance(currentMonth);

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

      {studentRoster.error && (
        <ErrorState compact title="Student names unavailable" message={studentRoster.error}
          actionLabel="Try again" onAction={studentRoster.refresh} />
      )}

      {auth.authenticated && auth.role !== 'member' && !studentRoster.loading && !studentRoster.error
        && studentRoster.data.length === 0 && (
        <EmptyState
          icon={Users}
          title="No students added yet"
          message={auth.role === 'superadmin'
            ? 'MealKhata is ready. Add your first student to start recording meals, rooms, payments and expenses.'
            : 'The Super Admin has not added any students yet.'}
          action={auth.role === 'superadmin' ? (
            <Button asChild size="sm">
              <Link to="/admin/members"><UserPlus className="h-4 w-4" aria-hidden="true" /> Add first student</Link>
            </Button>
          ) : null}
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

          {/* Phase 3 Unified Financial Overview (Member) */}
          {isMember && memberFinance.data && (
            <FinancialOverviewCard
              overview={memberFinance.data}
              onRefresh={memberFinance.refresh}
            />
          )}

          {/* Phase 3 Unified Financial Overview (Admin / SuperAdmin) */}
          {isAdminOrSuper && householdFinance.data && (
            <FinancialHouseholdSummary
              household={householdFinance.data}
            />
          )}

          {/* Phase 4 Hostel Stay Lifecycle Card */}
          <DashboardStayCard />

          {/* Member view: 1. Personal Meals Today */}
          {isMember && data.personalHero && (
            <PersonalMealHero
              hero={data.personalHero}
              isOnline={isOnline}
              pendingRows={pendingRows}
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
                participants={dayParticipants}
                mealType="morning"
                title="Morning"
                meals={data.meals.morning}
                allocation={data.meals.allocations?.morning}
                allocationDetails={data.meals.allocationDetails?.morning}
                pricing={data.meals.pricing?.morning}
                editable={Boolean(data.meals.permissions?.canEdit) && isOnline}
                editableMemberIds={data.meals.permissions?.editableMemberIds}
                pendingRows={pendingRows}
                onChange={handleMealChange}
              />
              <MealCard
                participants={dayParticipants}
                mealType="night"
                title="Night"
                meals={data.meals.night}
                allocation={data.meals.allocations?.night}
                allocationDetails={data.meals.allocationDetails?.night}
                pricing={data.meals.pricing?.night}
                editable={Boolean(data.meals.permissions?.canEdit) && isOnline}
                editableMemberIds={data.meals.permissions?.editableMemberIds}
                pendingRows={pendingRows}
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

          {/* Phase 1 Room Fees Card */}
          <DashboardRoomFeeCard month={data.today ? data.today.slice(0, 7) : getIndiaCurrentLogicalMonth()} />

          {/* Phase 2 Other Expenses Card */}
          <DashboardExpenseCard month={data.today ? data.today.slice(0, 7) : getIndiaCurrentLogicalMonth()} />

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
