import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { LiveIndicator } from '../components/meals/LiveIndicator.jsx';
import { MealCard } from '../components/meals/MealCard.jsx';
import { PlateSharingDialog } from '../components/meals/PlateSharingDialog.jsx';
import { PlateSummary } from '../components/meals/PlateSummary.jsx';
import { ReminderSettingsPanel } from '../components/reminders/ReminderSettingsPanel.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useMealDay } from '../hooks/useMealDay.js';
import { useMealHistory } from '../hooks/useMealHistory.js';
import { usePwa } from '../hooks/usePwa.js';
import { useSettlement } from '../hooks/useSettlement.js';
import { api } from '../lib/api.js';
import { getRoleLabel } from '../lib/constants.js';
import { addLogicalDays, formatIndiaTime, formatLogicalDate, isValidLogicalDate } from '../lib/logicalDate.js';
import { formatLogicalMonth } from '../lib/logicalMonth.js';

export function AdminPage() {
  useDocumentTitle('Admin');
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
  const [sharingMealType, setSharingMealType] = useState(null);

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

      if (response.allocationReset) {
        setSaveMessage(
          'Your meal choice was updated. The previous shared-plate plan was reset because the participants changed.',
        );
      } else {
        setSaveMessage(
          response.changed ? 'Meal change saved.' : 'Meal schedule is already up to date.',
        );
      }
      history.refresh();
    } catch {
      setSaveError('Unable to save the meal change. Please try again.');
    } finally {
      setPendingRow('');
    }
  };

  const canConfigureSharing = Boolean(
    mealDay.data?.permissions?.canConfigureAllocation && isOnline && !isMonthClosed,
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header section with Live status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800/80 pb-4">
        <PageHeader
          eyebrow={getRoleLabel(auth.role)}
          title="Meal management"
          description="Review any logical date and update meals and shared physical plates."
        />
        <div className="self-start sm:self-center">
          <LiveIndicator connected={mealDay.live} />
        </div>
      </div>

      {/* Date Selector Card */}
      <Card className="border-slate-200/90 dark:border-slate-800">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4">
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Selected date
            </span>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {displayedDate
                ? formatLogicalDate(displayedDate, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : 'Loading date...'}
            </h2>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => moveDate(-1)}
              disabled={!displayedDate}
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs font-medium"
              onClick={() => setRequestedDate('today')}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => moveDate(1)}
              disabled={!displayedDate}
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <input
              type="date"
              value={displayedDate}
              onChange={(event) => setRequestedDate(event.target.value)}
              className="h-8 rounded-sm border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 ml-1 cursor-pointer"
              aria-label="Choose logical date"
            />
          </div>
        </CardHeader>
      </Card>

      {mealDay.loading && !mealDay.data && (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      )}

      {mealDay.error && (
        <ErrorState
          title="Meals unavailable"
          message={mealDay.error}
          actionLabel="Try again"
          onAction={mealDay.refresh}
        />
      )}

      {mealDay.data && (
        <>
          {!mealDay.data.permissions?.canEdit && auth.role === 'admin' && (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2.5 rounded-lg border border-amber-200/80 dark:border-amber-900/40">
              Admin can edit today&apos;s meals only. Historical dates remain view-only.
            </p>
          )}

          {!mealDay.data.saved && (
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              Using default schedule
            </p>
          )}

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

          {isMonthClosed && (
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <strong>{formatLogicalMonth(month)} is closed.</strong>
              <p>Reopen the month before editing historical meals.</p>
            </div>
          )}

          {/* Morning and Night Meal Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MealCard
              mealType="morning"
              title="Morning"
              meals={mealDay.data.meals.morning}
              allocation={mealDay.data.allocations?.morning}
              allocationDetails={mealDay.data.allocationDetails?.morning}
              editable={Boolean(mealDay.data.permissions.canEdit) && isOnline && !isMonthClosed}
              editableMemberIds={mealDay.data.permissions?.editableMemberIds}
              pendingRow={pendingRow}
              onChange={handleMealChange}
              canConfigureSharing={canConfigureSharing}
              onConfigureSharing={() => setSharingMealType('morning')}
            />
            <MealCard
              mealType="night"
              title="Night"
              meals={mealDay.data.meals.night}
              allocation={mealDay.data.allocations?.night}
              allocationDetails={mealDay.data.allocationDetails?.night}
              editable={Boolean(mealDay.data.permissions.canEdit) && isOnline && !isMonthClosed}
              editableMemberIds={mealDay.data.permissions?.editableMemberIds}
              pendingRow={pendingRow}
              onChange={handleMealChange}
              canConfigureSharing={canConfigureSharing}
              onConfigureSharing={() => setSharingMealType('night')}
            />
          </div>

          {/* Physical Plate Summary */}
          <PlateSummary
            meals={mealDay.data.meals}
            allocations={mealDay.data.allocations}
            allocationDetails={mealDay.data.allocationDetails}
            label={`Plate count for ${displayedDate}`}
          />
        </>
      )}

      {sharingMealType && mealDay.data && (
        <PlateSharingDialog
          date={displayedDate}
          mealType={sharingMealType}
          currentAllocation={mealDay.data.allocations?.[sharingMealType]}
          currentMeals={mealDay.data.meals?.[sharingMealType]}
          onClose={() => setSharingMealType(null)}
          onSaved={(updatedMealDay) => {
            mealDay.applyServerData(updatedMealDay);
            setSaveMessage('Plate sharing allocation saved.');
            history.refresh();
          }}
        />
      )}

      {/* Recent Changes Audit Card */}
      <Card className="border-slate-200/90 dark:border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-500" />
            <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Recent changes
            </CardTitle>
          </div>
          <span className="text-xs text-slate-400">Audit trail</span>
        </CardHeader>

        <CardContent>
          {history.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ) : history.error ? (
            <ErrorState
              compact
              title="History unavailable"
              message={history.error}
              actionLabel="Try again"
              onAction={history.refresh}
            />
          ) : history.allChanges.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 py-3 text-center">
              No changes recorded for this date.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {history.allChanges.map((item, index) => {
                if (item.type === 'allocation') {
                  const mealLabel = item.mealType === 'morning' ? 'Morning' : 'Night';
                  const actorLabel = getRoleLabel(item.actorRole);
                  let title;
                  let subtitle;

                  if (item.changeType === 'reset') {
                    title = `${mealLabel} shared allocation reset`;
                    subtitle =
                      item.reason || 'Reset to individual plates because participants changed.';
                  } else {
                    title = `${actorLabel} updated ${mealLabel} plate sharing`;
                    const fromPlates = item.from?.plates?.length ?? 'default';
                    const toPlates = item.to?.plates?.length ?? 'default';
                    subtitle = `${fromPlates} plates → ${toPlates} plates`;
                  }

                  return (
                    <div
                      key={`${item.changedAt}-alloc-${index}`}
                      className="py-2.5 flex items-start justify-between gap-3"
                    >
                      <div>
                        <strong className="font-semibold text-slate-900 dark:text-slate-100 block">
                          {title}
                        </strong>
                        <span className="text-slate-500 dark:text-slate-400">{subtitle}</span>
                      </div>
                      <time className="text-slate-400 shrink-0 text-[11px]" dateTime={item.changedAt}>
                        {formatIndiaTime(item.changedAt)}
                      </time>
                    </div>
                  );
                }

                // Status change item
                const memberName = item.memberId[0].toUpperCase() + item.memberId.slice(1);
                let actionDescription;
                if (item.actorRole === 'member' && item.actorMemberId) {
                  const actorName =
                    item.actorMemberId[0].toUpperCase() + item.actorMemberId.slice(1);
                  if (item.actorMemberId === item.memberId) {
                    actionDescription = `${actorName} changed their ${item.mealType === 'morning' ? 'Morning' : 'Night'} meal`;
                  } else {
                    actionDescription = `${actorName} changed ${memberName}'s ${item.mealType === 'morning' ? 'Morning' : 'Night'} meal`;
                  }
                } else {
                  actionDescription = `${getRoleLabel(item.actorRole)} changed ${memberName}'s ${item.mealType === 'morning' ? 'Morning' : 'Night'} meal`;
                }

                return (
                  <div
                    key={`${item.changedAt}-${item.revision ?? index}`}
                    className="py-2.5 flex items-start justify-between gap-3"
                  >
                    <div>
                      <strong className="font-semibold text-slate-900 dark:text-slate-100 block">
                        {actionDescription}
                      </strong>
                      <span className="text-slate-500 dark:text-slate-400">
                        {item.from === 'taking' ? 'Taking' : 'Skip'}{' '}
                        <span aria-hidden="true">→</span>{' '}
                        {item.to === 'taking' ? 'Taking' : 'Skip'}
                      </span>
                    </div>
                    <time className="text-slate-400 shrink-0 text-[11px]" dateTime={item.changedAt}>
                      {formatIndiaTime(item.changedAt)}
                    </time>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reminder Settings Panel */}
      <ReminderSettingsPanel editable={auth.role === 'superadmin'} />
    </div>
  );
}
