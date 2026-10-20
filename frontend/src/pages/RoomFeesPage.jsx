import { AlertCircle, BedDouble, ChevronLeft, ChevronRight, LogIn, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { RoomFeeEmptyState } from '../components/roomFees/RoomFeeEmptyState.jsx';
import { RoomFeeMetricsCard } from '../components/roomFees/RoomFeeMetricsCard.jsx';
import { RoomFeeMonthList } from '../components/roomFees/RoomFeeMonthList.jsx';
import { RoomFeeOverviewCard } from '../components/roomFees/RoomFeeOverviewCard.jsx';
import { RoomPaymentInstructionsCard } from '../components/roomFees/RoomPaymentInstructionsCard.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader } from '../components/ui/card.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { usePwa } from '../hooks/usePwa.js';
import { useMyRoomFeeHistory, useMyRoomFees, useRoomPaymentSettings } from '../hooks/useRoomFees.js';
import { useServerToday } from '../hooks/useServerToday.js';
import { addLogicalMonths, formatLogicalMonth, isValidLogicalMonth } from '../lib/logicalMonth.js';

import { getIndiaCurrentLogicalMonth } from '../lib/logicalDate.js';

export function RoomFeesPage() {
  useDocumentTitle('Room Fees');
  const auth = useAuth();
  const { isOnline } = usePwa();
  const serverToday = useServerToday();
  const [searchParams] = useSearchParams();

  const queryMonth = searchParams.get('month');
  const [selectedMonth, setSelectedMonth] = useState('');

  const currentLogicalMonth = serverToday.date ? serverToday.date.slice(0, 7) : getIndiaCurrentLogicalMonth();
  const month =
    selectedMonth ||
    (isValidLogicalMonth(queryMonth) ? queryMonth : currentLogicalMonth);

  const { loading: feeLoading, error: feeError, data: feeData, refresh: refreshFee } = useMyRoomFees(month);
  const { loading: historyLoading, error: historyError, data: historyData, refresh: refreshHistory } = useMyRoomFeeHistory();
  const { settings } = useRoomPaymentSettings();

  const canAccessAdmin = auth.role === 'admin' || auth.role === 'superadmin';

  // Viewer / Unauthenticated Gate
  if (!auth.authenticated || auth.role === 'viewer') {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <PageHeader
          title="Room Fees"
          description="Manage your monthly hostel room charges and payments."
        />
        <Card className="border border-slate-200 dark:border-slate-800 p-8 text-center bg-white dark:bg-slate-900/40">
          <div className="max-w-md mx-auto space-y-3">
            <div className="h-12 w-12 rounded-full bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-700 dark:text-teal-400 mx-auto">
              <BedDouble className="h-6 w-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Private Financial Domain
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Hostel room fees and payment ledgers are confidential to assigned residents and administrators. Please sign in to access your personal room statements.
            </p>
            <div className="pt-2">
              <Button asChild size="sm" className="gap-2 text-xs font-semibold">
                <Link to="/login?next=/room-fees">
                  <LogIn className="h-4 w-4" />
                  <span>Sign In</span>
                </Link>
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const room = feeData?.room || null;
  const statement = feeData?.statement || null;
  const hasAssignment = Boolean(feeData?.assignment);
  const hasPlan = Boolean(feeData?.feePlan);

  const roomDescription = room
    ? `Room ${room.roomNumber} · ${room.capacity === 1 ? 'Single occupancy' : room.capacity === 2 ? 'Double occupancy' : `${room.capacity}-person room`}`
    : 'No room assigned yet';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="Room Fees"
          description={hasAssignment ? roomDescription : 'Manage your monthly hostel room payments.'}
        />
        {canAccessAdmin && (
          <div className="self-start sm:self-center">
            <Button asChild variant="outline" size="sm" className="gap-2 text-xs font-semibold">
              <Link to="/admin/room-fees">
                <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                <span>Manage Room Fees</span>
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Month Selector Card */}
      <Card className="border-slate-200/90 dark:border-slate-800">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatLogicalMonth(month)}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {statement ? `Statement status: ${statement.status}` : 'Room statement'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setSelectedMonth(addLogicalMonths(month, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs font-medium"
              onClick={() => setSelectedMonth(currentLogicalMonth)}
            >
              Current
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setSelectedMonth(addLogicalMonths(month, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <input
              type="month"
              value={month}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-8 rounded-sm border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 ml-1 cursor-pointer"
              aria-label="Select month"
            />
          </div>
        </CardHeader>
      </Card>

      {/* Error state */}
      {feeError && (
        <ErrorState
          title="Room fees unavailable"
          message={!isOnline ? 'Data unavailable while offline.' : feeError}
          actionLabel="Try again"
          onAction={refreshFee}
        />
      )}

      {/* Loading state */}
      {feeLoading && !feeData && (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      )}

      {/* Main Content */}
      {!feeLoading && feeData && (
        <>
          {/* Case 1: No room assigned */}
          {!hasAssignment ? (
            <RoomFeeEmptyState
              type="no_assignment"
              message="No room assigned yet. Contact your hostel administrator to configure your stay."
            />
          ) : !hasPlan ? (
            /* Case 2: Room assigned but no fee plan */
            <RoomFeeEmptyState
              type="no_plan"
              message="You are assigned to a room, but your individual monthly fee plan has not been configured yet."
            />
          ) : (
            /* Case 3: Fully configured room stay */
            <div className="space-y-6">
              {/* Monthly Overview Card */}
              <RoomFeeOverviewCard
                statement={statement}
                room={room}
                month={month}
              />

              {/* Payment Instructions Card */}
              <RoomPaymentInstructionsCard
                settings={settings}
                remainingPaise={statement?.remainingPaise || 0}
                monthLabel={formatLogicalMonth(month)}
              />

              {/* Summary Metrics */}
              {historyData?.history && (
                <RoomFeeMetricsCard historyItems={historyData.history} />
              )}

              {/* Month-Wise Fee History */}
              <RoomFeeMonthList
                historyItems={historyData?.history || []}
                room={room}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
