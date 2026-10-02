import { ArrowRight, CreditCard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatPaise } from '../../lib/money.js';
import { PAYMENT_STATUS_LABELS } from '../../lib/paymentFlow.js';
import { formatPlateFraction } from '../../lib/plates.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Badge } from '../ui/badge.jsx';
import { Button } from '../ui/button.jsx';

export function PersonalMonthlyCard({ personal }) {
  if (!personal) return null;

  const {
    month,
    monthLabel,
    morningCount,
    nightCount,
    totalPlates,
    billAmountPaise,
    paidAmountPaise,
    remainingAmountPaise,
    projectedBillAmountPaise,
    status,
  } = personal;

  const ratesMissing = billAmountPaise === null;
  const hasRemaining = Number.isSafeInteger(remainingAmountPaise) && remainingAmountPaise > 0;
  const plateShareDisplay =
    typeof totalPlates === 'number'
      ? Number.isInteger(totalPlates)
        ? String(totalPlates)
        : formatPlateFraction(Math.round(totalPlates * 6))
      : totalPlates;

  const statusVariant =
    status === 'paid'
      ? 'taking'
      : status === 'partial' || status === 'due'
        ? 'warning'
        : 'secondary';

  return (
    <Card className="border-slate-200/90 dark:border-slate-800">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
            My {monthLabel}
          </span>
          <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Monthly summary
          </CardTitle>
        </div>
        <Badge variant={statusVariant} className="text-xs font-medium">
          {PAYMENT_STATUS_LABELS[status] || status}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Plate counts */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
          <span>
            Morning meals: <strong className="font-semibold text-slate-900 dark:text-slate-200">{morningCount}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          <span>
            Night meals: <strong className="font-semibold text-slate-900 dark:text-slate-200">{nightCount}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          <span>
            Plate share: <strong className="font-semibold text-slate-900 dark:text-slate-200">{plateShareDisplay}</strong>
          </span>
        </div>

        {/* Clean Financial Strip */}
        <div className="grid grid-cols-3 gap-2.5 rounded-lg bg-slate-50 p-3.5 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Bill</span>
            <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {ratesMissing ? 'Rates Pending' : formatPaise(billAmountPaise)}
            </span>
          </div>

          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Paid</span>
            <span className="text-base font-semibold text-emerald-700 dark:text-emerald-400">
              {formatPaise(paidAmountPaise)}
            </span>
          </div>

          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Remaining</span>
            <span
              className={`text-base font-semibold ${
                hasRemaining
                  ? 'text-orange-700 dark:text-orange-400 font-bold'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {formatPaise(remainingAmountPaise)}
            </span>
          </div>
        </div>

        {Number.isSafeInteger(projectedBillAmountPaise) && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Estimated month end: <span className="font-medium text-slate-700 dark:text-slate-300">{formatPaise(projectedBillAmountPaise)}</span>
          </p>
        )}

        <div className="pt-1">
          {hasRemaining ? (
            <Button variant="default" className="w-full gap-2 text-xs font-medium" asChild>
              <Link to={`/payments?month=${month}`}>
                <CreditCard className="h-4 w-4" />
                <span>Go to Payments ({formatPaise(remainingAmountPaise)})</span>
              </Link>
            </Button>
          ) : (
            <Button variant="outline" className="w-full gap-2 text-xs font-medium" asChild>
              <Link to={`/reports?month=${month}`}>
                <span>View {monthLabel} report</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
