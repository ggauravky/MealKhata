import {
  BedDouble,
  CircleDollarSign,
  History,
  LogIn,
  Plus,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../ui/badge.jsx';
import { Button } from '../ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { ErrorState } from '../ui/ErrorState.jsx';
import { Skeleton } from '../ui/skeleton.jsx';
import { RoomFeeEmptyState } from './RoomFeeEmptyState.jsx';
import { RoomFeeOverviewCard } from './RoomFeeOverviewCard.jsx';
import { RoomPaymentInstructionsCard } from './RoomPaymentInstructionsCard.jsx';
import { RoomFeeMonthDetailsDialog } from './RoomFeeMonthDetailsDialog.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { usePwa } from '../../hooks/usePwa.js';
import {
  useAdminRoomFeeSummary,
  useMyRoomFeeHistory,
  useMyRoomFees,
  useRoomPaymentSettings,
} from '../../hooks/useRoomFees.js';
import { ROOMMATES } from '../../lib/constants.js';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { formatPaise } from '../../lib/money.js';

function formatPaymentTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

export function RoomFeesPaymentTab({ month }) {
  const auth = useAuth();
  const { isOnline } = usePwa();
  const canAccessAdmin = auth.role === 'admin' || auth.role === 'superadmin';

  // Member data
  const { loading: memberLoading, error: memberError, data: memberData, refresh: refreshMember } = useMyRoomFees(
    auth.role === 'member' ? month : null,
  );
  const { data: memberHistoryData } = useMyRoomFeeHistory();

  // Admin data
  const { loading: adminLoading, error: adminError, data: adminSummary, refresh: refreshAdmin } = useAdminRoomFeeSummary(
    canAccessAdmin ? month : null,
  );
  const { settings } = useRoomPaymentSettings();

  // Viewer / Unauthenticated
  if (!auth.authenticated || auth.role === 'viewer') {
    return (
      <Card className="border-slate-200 dark:border-slate-800 p-8 text-center bg-white dark:bg-slate-900/40">
        <div className="max-w-md mx-auto space-y-3">
          <div className="h-12 w-12 rounded-full bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-700 dark:text-teal-400 mx-auto">
            <BedDouble className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Sign In to Access Room Fees
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Room fee accounts and payment ledgers are private to household members. Public viewer access applies to mess reports only.
          </p>
          <div className="pt-2">
            <Button asChild size="sm" className="gap-2 text-xs font-semibold">
              <Link to="/login?next=/payments">
                <LogIn className="h-4 w-4" />
                <span>Sign In</span>
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // Admin / SuperAdmin View
  if (canAccessAdmin) {
    const household = adminSummary?.household || {};
    const payments = adminSummary?.payments || [];

    return (
      <div className="space-y-6">
        {/* Admin Header with Manage shortcut */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white dark:bg-slate-900/60 p-4 rounded-lg border border-slate-200/90 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Household Room Fees — {formatLogicalMonth(month)}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Independent hostel fee ledger for the household.
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs font-semibold self-start sm:self-center">
            <Link to="/admin/room-fees">
              <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <span>Room Fee Administration</span>
            </Link>
          </Button>
        </div>

        {/* Household Room Total Card */}
        <Card className="border-slate-200/90 dark:border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-full bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-700 dark:text-teal-400">
                <BedDouble className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Hostel Room Total
                </CardTitle>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {formatLogicalMonth(month)}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2.5 rounded-lg bg-slate-50 p-3.5 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
              <div>
                <span className="block text-slate-500 dark:text-slate-400 text-xs">Total Billed</span>
                <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  {formatPaise(household.billedPaise || 0)}
                </span>
              </div>
              <div>
                <span className="block text-slate-500 dark:text-slate-400 text-xs">Total Collected</span>
                <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                  {formatPaise(household.collectedPaise || 0)}
                </span>
              </div>
              <div>
                <span className="block text-slate-500 dark:text-slate-400 text-xs">Outstanding</span>
                <span
                  className={`text-lg font-bold ${
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
        </Card>

        {/* Room Payments Ledger */}
        <Card className="border-slate-200/90 dark:border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Room Payment History — {formatLogicalMonth(month)}
              </CardTitle>
            </div>
            <span className="text-xs text-slate-400">Dedicated room ledger</span>
          </CardHeader>

          <CardContent>
            {payments.length === 0 ? (
              <div className="p-8 text-center border border-dashed rounded-lg border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
                <CircleDollarSign className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  No room payments recorded
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Room payments for {formatLogicalMonth(month)} will be listed here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {payments.map((p) => {
                  const roommate = ROOMMATES.find((m) => m.id === p.memberId);
                  const isVoided = p.status === 'voided';
                  return (
                    <div key={p.roomPaymentId} className={`flex items-center justify-between py-3 ${isVoided ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-teal-50 dark:bg-teal-950 flex items-center justify-center text-teal-700 dark:text-teal-300">
                          <CircleDollarSign className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {roommate?.name || p.memberId}
                            </span>
                            <Badge variant={isVoided ? 'destructive' : 'taking'} className="text-[10px] py-0 px-1.5">
                              {isVoided ? 'Voided' : 'Recorded'}
                            </Badge>
                            <span className="text-[10px] uppercase font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded text-slate-500">
                              {p.method}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {formatPaymentTime(p.recordedAt)}
                            {p.reference && <span className="ml-2 font-mono">Ref: {p.reference}</span>}
                          </div>
                        </div>
                      </div>
                      <span className={`text-sm font-bold ${isVoided ? 'line-through text-slate-400' : 'text-slate-900 dark:text-slate-100'}`}>
                        {formatPaise(p.amountPaise)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Member View
  const statement = memberData?.statement;
  const room = memberData?.room;
  const hasAssignment = Boolean(memberData?.assignment);

  return (
    <div className="space-y-6">
      {!hasAssignment ? (
        <RoomFeeEmptyState
          type="no_assignment"
          message="No room assigned yet. Contact your hostel administrator to configure your stay."
        />
      ) : (
        <>
          <RoomFeeOverviewCard
            statement={statement}
            room={room}
            month={month}
          />

          <RoomPaymentInstructionsCard
            settings={settings}
            remainingPaise={statement?.remainingPaise || 0}
            monthLabel={formatLogicalMonth(month)}
          />

          <div className="pt-2 text-center">
            <Button asChild variant="outline" size="sm" className="text-xs">
              <Link to="/room-fees">
                <BedDouble className="h-4 w-4 mr-1.5" />
                <span>View Full Room Fee History & Progress</span>
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
