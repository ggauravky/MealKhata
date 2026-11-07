import { BedDouble, Calendar, CreditCard, Sparkles } from 'lucide-react';
import { Badge } from '../ui/badge.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { RoomFeeProgress } from './RoomFeeProgress.jsx';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { formatPaise } from '../../lib/money.js';

const STATUS_LABELS = {
  paid: 'Fully paid',
  partial: 'Partially paid',
  due: 'Due',
  overdue: 'Overdue',
  overpaid: 'Overpaid',
  upcoming: 'Upcoming',
  not_issued: 'Charge not issued',
};

const STATUS_BADGE_VARIANTS = {
  paid: 'taking',
  partial: 'warning',
  due: 'secondary',
  overdue: 'destructive',
  overpaid: 'taking',
  upcoming: 'secondary',
  not_issued: 'outline',
};

export function RoomFeeOverviewCard({ statement, room, month }) {
  if (!statement) return null;

  const { charge, payments = [], effectiveChargePaise = 0, paidPaise = 0, remainingPaise = 0, overpaidPaise = 0, status } = statement;
  const isIssued = Boolean(charge);
  const statusLabel = STATUS_LABELS[status] || status;
  const badgeVariant = STATUS_BADGE_VARIANTS[status] || 'secondary';

  const roomLabel = room?.roomNumber ? `Room ${room.roomNumber}` : 'Room assigned';
  const capacityLabel = room?.capacity === 1 ? 'Single occupancy' : room?.capacity === 2 ? 'Double occupancy' : room?.capacity ? `${room.capacity}-person room` : '';

  return (
    <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-5 pb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-700 dark:text-teal-400">
            <BedDouble className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {formatLogicalMonth(month)}
              </CardTitle>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>{roomLabel}</span>
              {capacityLabel && (
                <>
                  <span>·</span>
                  <span>{capacityLabel}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div>
          <Badge variant={badgeVariant} className="text-xs py-0.5 px-2.5">
            {statusLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-5 pt-2 space-y-4">
        {/* Figures strip */}
        <div className="grid grid-cols-3 gap-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3.5 border border-slate-100 dark:border-slate-800/80">
          <div>
            <span className="block text-slate-400 dark:text-slate-500 text-[11px]">Monthly Fee</span>
            <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              {isIssued ? formatPaise(effectiveChargePaise) : 'Not issued'}
            </span>
          </div>
          <div>
            <span className="block text-slate-400 dark:text-slate-500 text-[11px]">Paid</span>
            <span className="text-base sm:text-lg font-bold text-emerald-700 dark:text-emerald-400">
              {formatPaise(paidPaise)}
            </span>
          </div>
          <div>
            <span className="block text-slate-400 dark:text-slate-500 text-[11px]">Remaining</span>
            <span
              className={`text-base sm:text-lg font-bold ${
                remainingPaise > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {isIssued ? formatPaise(remainingPaise) : '—'}
            </span>
          </div>
        </div>

        {/* Overpaid note */}
        {overpaidPaise > 0 && (
          <p className="text-xs text-purple-700 dark:text-purple-300 font-medium bg-purple-50 dark:bg-purple-950/40 p-2 rounded border border-purple-200 dark:border-purple-900">
            Overpaid balance: {formatPaise(overpaidPaise)} (Credit retained for this charge)
          </p>
        )}

        {/* Progress bar */}
        {isIssued && (
          <div className="pt-1">
            <RoomFeeProgress
              paidPaise={paidPaise}
              billPaise={effectiveChargePaise}
              status={status}
            />
          </div>
        )}

        {/* Due date if charge exists */}
        {charge?.dueDate && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 pt-1">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <span>Due by {charge.dueDate}</span>
          </div>
        )}

        {!isIssued && (
          <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40 p-3 rounded border border-dashed border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-teal-600 shrink-0" />
            <span>
              Your fee plan is scheduled, but this month has not been issued by the administrator yet. Unissued months are not debts.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
