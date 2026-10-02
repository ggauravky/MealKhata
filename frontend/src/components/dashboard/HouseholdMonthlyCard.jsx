import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatPaise } from '../../lib/money.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Button } from '../ui/button.jsx';

export function HouseholdMonthlyCard({ household }) {
  if (!household) return null;

  const {
    month,
    monthLabel,
    morningCount,
    nightCount,
    totalPlates,
    billAmountPaise,
    projectedBillAmountPaise,
    paidAmountPaise,
    remainingAmountPaise,
  } = household;

  const remaining = remainingAmountPaise || 0;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Household overview
          </span>
          <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {monthLabel}
          </CardTitle>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" asChild className="h-8 gap-1 text-xs text-teal-700 dark:text-teal-400 hover:text-teal-800">
            <Link to={`/reports?month=${month}`}>
              <span>Full Report</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild className="h-8 gap-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900">
            <Link to={`/payments?month=${month}`}>
              <span>Payment Ledger</span>
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Compact plain typography summary */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
          <span>
            Morning plates: <strong className="font-semibold text-slate-900 dark:text-slate-200">{morningCount}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          <span>
            Night plates: <strong className="font-semibold text-slate-900 dark:text-slate-200">{nightCount}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          <span>
            Total physical: <strong className="font-semibold text-slate-900 dark:text-slate-200">{totalPlates}</strong>
          </span>
        </div>

        {/* Clean Financial Stats Row */}
        <div className="grid grid-cols-3 gap-2.5 rounded-lg bg-slate-50 p-3.5 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Room bill</span>
            <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {billAmountPaise !== null ? formatPaise(billAmountPaise) : '—'}
            </span>
          </div>

          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Collected</span>
            <span className="text-base font-semibold text-emerald-700 dark:text-emerald-400">
              {formatPaise(paidAmountPaise)}
            </span>
          </div>

          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Remaining</span>
            <span
              className={`text-base font-semibold ${
                remaining > 0
                  ? 'text-orange-700 dark:text-orange-400 font-bold'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {remainingAmountPaise !== null ? formatPaise(remainingAmountPaise) : '—'}
            </span>
          </div>
        </div>

        {Number.isSafeInteger(projectedBillAmountPaise) && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Projected full-month room bill: <span className="font-medium text-slate-700 dark:text-slate-300">{formatPaise(projectedBillAmountPaise)}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
