import { CheckCircle2, Clock, DollarSign, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { formatPaise } from '../../lib/money.js';

export function RoomFeeMetricsCard({ historyItems = [] }) {
  if (!historyItems || historyItems.length === 0) return null;

  // Compute metrics across issued months only
  let issuedMonths = 0;
  let fullyPaidMonths = 0;
  let partiallyPaidMonths = 0;
  let outstandingMonths = 0;
  let totalBilledPaise = 0;
  let totalPaidPaise = 0;
  let totalOutstandingPaise = 0;

  for (const item of historyItems) {
    if (item.charge) {
      issuedMonths += 1;
      totalBilledPaise += item.effectiveChargePaise || 0;
      totalPaidPaise += item.paidPaise || 0;
      totalOutstandingPaise += item.remainingPaise || 0;

      if (item.status === 'paid' || item.status === 'overpaid') {
        fullyPaidMonths += 1;
      } else if (item.status === 'partial') {
        partiallyPaidMonths += 1;
        outstandingMonths += 1;
      } else if (item.remainingPaise > 0) {
        outstandingMonths += 1;
      }
    }
  }

  if (issuedMonths === 0) return null;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <FileText className="h-4 w-4 text-teal-600" />
          <span>Room Stay Summary</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-1 space-y-3">
        {/* Money stats */}
        <div className="grid grid-cols-3 gap-2 text-center rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3 border border-slate-100 dark:border-slate-800/80">
          <div>
            <span className="block text-[11px] text-slate-400">Total Billed</span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {formatPaise(totalBilledPaise)}
            </span>
          </div>
          <div>
            <span className="block text-[11px] text-slate-400">Total Paid</span>
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
              {formatPaise(totalPaidPaise)}
            </span>
          </div>
          <div>
            <span className="block text-[11px] text-slate-400">Total Dues</span>
            <span
              className={`text-sm font-bold ${
                totalOutstandingPaise > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {formatPaise(totalOutstandingPaise)}
            </span>
          </div>
        </div>

        {/* Count stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
          <div className="rounded border border-slate-200/80 dark:border-slate-800 p-2.5 bg-white dark:bg-slate-950">
            <span className="block text-slate-500 dark:text-slate-400 text-[11px]">Issued Months</span>
            <span className="text-base font-semibold text-slate-800 dark:text-slate-200">
              {issuedMonths}
            </span>
          </div>
          <div className="rounded border border-slate-200/80 dark:border-slate-800 p-2.5 bg-white dark:bg-slate-950">
            <span className="block text-slate-500 dark:text-slate-400 text-[11px]">Fully Paid</span>
            <span className="text-base font-semibold text-emerald-700 dark:text-emerald-400">
              {fullyPaidMonths}
            </span>
          </div>
          <div className="rounded border border-slate-200/80 dark:border-slate-800 p-2.5 bg-white dark:bg-slate-950">
            <span className="block text-slate-500 dark:text-slate-400 text-[11px]">Partially Paid</span>
            <span className="text-base font-semibold text-amber-600 dark:text-amber-400">
              {partiallyPaidMonths}
            </span>
          </div>
          <div className="rounded border border-slate-200/80 dark:border-slate-800 p-2.5 bg-white dark:bg-slate-950">
            <span className="block text-slate-500 dark:text-slate-400 text-[11px]">With Balance</span>
            <span
              className={`text-base font-semibold ${
                outstandingMonths > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-800 dark:text-slate-200'
              }`}
            >
              {outstandingMonths}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
