import { AlertCircle, BedDouble, CookingPot, Download, ShoppingBag, Users, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { formatPaise } from '../../lib/money.js';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { downloadHouseholdStatementPdf } from '../../lib/financeDownload.js';

export function FinancialHouseholdSummary({ household, showDownload = true }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  if (!household) return null;

  const { month, trackedCosts, managedDues, roommateReimbursements, actionableAttention = [] } = household;
  const monthLabel = formatLogicalMonth(month);

  const handleDownload = async () => {
    if (downloading) return;
    try {
      setDownloading(true);
      setDownloadError(null);
      await downloadHouseholdStatementPdf(month);
    } catch (err) {
      setDownloadError(err?.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-teal-50 p-2 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">
                Household Financial Overview
              </span>
              <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                {monthLabel}
              </CardTitle>
            </div>
          </div>

          {showDownload && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{downloading ? 'Downloading...' : 'Household PDF'}</span>
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {downloadError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
            {downloadError}
          </div>
        )}

        {/* Actionable Attention Banners */}
        {actionableAttention.length > 0 && (
          <div className="space-y-2">
            {actionableAttention.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/60 p-2.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>{item.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* 3 Core Household Metric KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Card 1: Total Tracked Costs */}
          <div className="rounded-xl bg-slate-900 p-3.5 text-white dark:bg-slate-950 border border-slate-800">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Tracked Household Spending
            </div>
            <div className="text-2xl font-bold tracking-tight text-white mt-1">
              {formatPaise(trackedCosts?.totalTrackedCostPaise || 0)}
            </div>
            <div className="text-[11px] text-slate-400 mt-2 space-y-0.5">
              <div className="flex justify-between">
                <span>Mess:</span>
                <span className="text-slate-200 font-medium">{formatPaise(trackedCosts?.messCostPaise || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Room Fees:</span>
                <span className="text-slate-200 font-medium">{formatPaise(trackedCosts?.roomFeesCostPaise || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Purchases:</span>
                <span className="text-slate-200 font-medium">{formatPaise(trackedCosts?.otherExpensesCostPaise || 0)}</span>
              </div>
            </div>
          </div>

          {/* Card 2: Managed Dues */}
          <div className="rounded-xl border border-red-200/80 bg-red-50/50 p-3.5 dark:border-red-900/40 dark:bg-red-950/20">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">
              Managed / External Dues
            </div>
            <div className="text-2xl font-bold tracking-tight text-red-950 dark:text-red-200 mt-1">
              {formatPaise(managedDues?.totalManagedDuesPaise || 0)}
            </div>
            <div className="text-[11px] text-red-700/80 dark:text-red-400/80 mt-2 space-y-0.5">
              <div className="flex justify-between">
                <span>Mess Due:</span>
                <span className="font-semibold text-red-900 dark:text-red-300">{formatPaise(managedDues?.messOutstandingPaise || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Room Due:</span>
                <span className="font-semibold text-red-900 dark:text-red-300">{formatPaise(managedDues?.roomFeesOutstandingPaise || 0)}</span>
              </div>
              <div className="flex justify-between border-t border-red-200 dark:border-red-900/60 pt-0.5">
                <span>Collected:</span>
                <span className="text-slate-700 dark:text-slate-300">
                  {formatPaise((managedDues?.messCollectedPaise || 0) + (managedDues?.roomFeesCollectedPaise || 0))}
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: Roommate Reimbursements */}
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-400">
              Roommate Reimbursements
            </div>
            <div className="text-2xl font-bold tracking-tight text-amber-950 dark:text-amber-200 mt-1">
              {formatPaise(roommateReimbursements?.pendingReimbursementsPaise || 0)}
            </div>
            <div className="text-[11px] text-amber-800/80 dark:text-amber-400/80 mt-2 space-y-0.5">
              <div className="flex justify-between">
                <span>Pending Debts:</span>
                <span className="font-semibold text-amber-900 dark:text-amber-300">
                  {formatPaise(roommateReimbursements?.pendingReimbursementsPaise || 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Settled:</span>
                <span className="text-slate-700 dark:text-slate-300">
                  {formatPaise(roommateReimbursements?.settledReimbursementsPaise || 0)}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 pt-0.5">
                Internal debt settlement only
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
