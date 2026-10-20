import { ArrowRight, BedDouble, ChevronRight, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../ui/badge.jsx';
import { Button } from '../ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Skeleton } from '../ui/skeleton.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { useAdminRoomFeeSummary, useMyRoomFees } from '../../hooks/useRoomFees.js';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { formatPaise } from '../../lib/money.js';

export function DashboardRoomFeeCard({ month }) {
  const auth = useAuth();

  // Viewer check: do not expose private room financial data
  if (!auth.authenticated || auth.role === 'viewer') {
    return null;
  }

  const isMember = auth.role === 'member';
  const isAdminOrSuper = auth.role === 'admin' || auth.role === 'superadmin';

  return isMember ? (
    <MemberDashboardRoomCard month={month} />
  ) : isAdminOrSuper ? (
    <AdminDashboardRoomCard month={month} />
  ) : null;
}

function MemberDashboardRoomCard({ month }) {
  const { data, loading } = useMyRoomFees(month);

  if (loading && !data) {
    return <Skeleton className="h-28 w-full rounded-lg" />;
  }

  if (!data || !data.assignment) {
    return (
      <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-teal-50 dark:bg-teal-950 flex items-center justify-center text-teal-700 dark:text-teal-400">
              <BedDouble className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Hostel Room Stay
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No room assigned yet for {formatLogicalMonth(month)}.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="text-xs">
            <Link to="/room-fees">
              <span>View Stay</span>
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const statement = data.statement;
  const room = data.room;
  const isIssued = Boolean(statement?.charge);
  const remainingPaise = statement?.remainingPaise || 0;
  const paidPaise = statement?.paidPaise || 0;
  const effectiveChargePaise = statement?.effectiveChargePaise || 0;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full bg-teal-50 dark:bg-teal-950 flex items-center justify-center text-teal-700 dark:text-teal-400">
            <BedDouble className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatLogicalMonth(month)} Room Fee
              </CardTitle>
              {room?.roomNumber && (
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  · Room {room.roomNumber}
                </span>
              )}
            </div>
          </div>
        </div>

        <Button asChild variant="outline" size="sm" className="text-xs font-semibold h-8 gap-1">
          <Link to="/room-fees">
            <span>View Room Fees</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="p-4 pt-1">
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3 text-xs border border-slate-100 dark:border-slate-800">
          <div>
            <span className="block text-slate-400 text-[11px]">Monthly Charge</span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {isIssued ? formatPaise(effectiveChargePaise) : 'Not issued'}
            </span>
          </div>
          <div>
            <span className="block text-slate-400 text-[11px]">Paid</span>
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
              {formatPaise(paidPaise)}
            </span>
          </div>
          <div>
            <span className="block text-slate-400 text-[11px]">Remaining</span>
            <span
              className={`text-sm font-bold ${
                remainingPaise > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {isIssued ? formatPaise(remainingPaise) : '—'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminDashboardRoomCard({ month }) {
  const { data } = useAdminRoomFeeSummary(month);
  const household = data?.household;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full bg-teal-50 dark:bg-teal-950 flex items-center justify-center text-teal-700 dark:text-teal-400">
            <BedDouble className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {formatLogicalMonth(month)} Room Fees
            </CardTitle>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Hostel room management & fee ledger
            </span>
          </div>
        </div>

        <Button asChild variant="outline" size="sm" className="text-xs font-semibold h-8 gap-1">
          <Link to="/admin/room-fees">
            <ShieldCheck className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            <span>Manage Room Fees</span>
          </Link>
        </Button>
      </CardHeader>

      {household && (
        <CardContent className="p-4 pt-1">
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3 text-xs border border-slate-100 dark:border-slate-800">
            <div>
              <span className="block text-slate-400 text-[11px]">Total Billed</span>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatPaise(household.billedPaise || 0)}
              </span>
            </div>
            <div>
              <span className="block text-slate-400 text-[11px]">Total Collected</span>
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                {formatPaise(household.collectedPaise || 0)}
              </span>
            </div>
            <div>
              <span className="block text-slate-400 text-[11px]">Outstanding</span>
              <span
                className={`text-sm font-bold ${
                  (household.outstandingPaise || 0) > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {formatPaise(household.outstandingPaise || 0)}
              </span>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
