import { AlertCircle, ArrowDownLeft, ArrowUpRight, CheckCircle2, DollarSign, Shield, Wallet } from 'lucide-react';
import { formatPaise } from '../../lib/money.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { Button } from '../ui/button.jsx';

export function DepositOverviewCard({
  depositSummary,
  onOpenRecordDialog = null,
  canManage = false,
  isSuperAdmin = false,
}) {
  if (!depositSummary) {
    return (
      <Card className="border-slate-200 dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <Shield className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Security Deposit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No security deposit account configured for this stay.
          </p>
        </CardContent>
      </Card>
    );
  }

  const {
    expectedDepositPaise = 0,
    depositReceivedPaise = 0,
    depositDeductedPaise = 0,
    depositRefundedPaise = 0,
    depositHeldPaise = 0,
  } = depositSummary;

  const pendingCollectionPaise = Math.max(0, expectedDepositPaise - depositReceivedPaise);

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
          <Shield className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          Security Deposit
        </CardTitle>

        {canManage && onOpenRecordDialog && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenRecordDialog('RECEIVED')}
              className="h-7 text-xs border-slate-200 dark:border-slate-700"
            >
              <ArrowDownLeft className="h-3 w-3 mr-1 text-teal-600 dark:text-teal-400" />
              Receive
            </Button>
            {isSuperAdmin && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenRecordDialog('DEDUCTED')}
                  disabled={depositHeldPaise <= 0}
                  className="h-7 text-xs border-slate-200 dark:border-slate-700 text-amber-700 dark:text-amber-400"
                >
                  Deduct
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenRecordDialog('REFUNDED')}
                  disabled={depositHeldPaise <= 0}
                  className="h-7 text-xs border-slate-200 dark:border-slate-700 text-indigo-700 dark:text-indigo-400"
                >
                  <ArrowUpRight className="h-3 w-3 mr-1 text-indigo-600 dark:text-indigo-400" />
                  Refund
                </Button>
              </>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Held Balance Highlight */}
        <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Current Held Balance
            </span>
            <div className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {formatPaise(depositHeldPaise)}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Refundable funds held in custody during stay
            </p>
          </div>
          <div className="h-10 w-10 rounded-full bg-teal-100/70 dark:bg-teal-950/70 flex items-center justify-center text-teal-700 dark:text-teal-300">
            <Wallet className="h-5 w-5" />
          </div>
        </div>

        {/* 4-Column Breakdown Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Expected Deposit</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm mt-0.5 block">
              {formatPaise(expectedDepositPaise)}
            </span>
          </div>

          <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Total Received</span>
            <span className="font-semibold text-teal-700 dark:text-teal-400 text-sm mt-0.5 block">
              {formatPaise(depositReceivedPaise)}
            </span>
          </div>

          <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Deducted (Damages)</span>
            <span className="font-semibold text-amber-700 dark:text-amber-400 text-sm mt-0.5 block">
              {formatPaise(depositDeductedPaise)}
            </span>
          </div>

          <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Refunded</span>
            <span className="font-semibold text-indigo-700 dark:text-indigo-400 text-sm mt-0.5 block">
              {formatPaise(depositRefundedPaise)}
            </span>
          </div>
        </div>

        {/* Informational banner if expected is not yet fully collected */}
        {pendingCollectionPaise > 0 && (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-300 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Expected deposit is pending collection of {formatPaise(pendingCollectionPaise)}.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
