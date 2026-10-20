import { ArrowRight, ChevronRight, Download, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { formatPaise } from '../../lib/money.js';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { FinanceCategoryBreakdown } from './FinanceCategoryBreakdown.jsx';
import { PayablesReceivables } from './PayablesReceivables.jsx';
import { downloadMemberStatementPdf } from '../../lib/financeDownload.js';

export function FinancialOverviewCard({ overview, onRefresh }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  if (!overview) return null;

  const { month, combined, mess, room, expenses } = overview;
  const monthLabel = formatLogicalMonth(month);

  const handleDownload = async () => {
    if (downloading) return;
    try {
      setDownloading(true);
      setDownloadError(null);
      await downloadMemberStatementPdf(month);
    } catch (err) {
      setDownloadError(err?.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="border border-teal-200/80 bg-white shadow-sm dark:border-teal-900/40 dark:bg-slate-900">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-teal-50 p-2 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">
                Hostel Finances
              </span>
              <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                {monthLabel}
              </CardTitle>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{downloading ? 'Downloading...' : 'Statement PDF'}</span>
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {downloadError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
            {downloadError}
          </div>
        )}

        {/* Primary Big Metric: Total to Pay */}
        <div className="rounded-xl bg-slate-900 p-4 text-white dark:bg-slate-950/80 border border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
                Total Remaining to Pay
              </div>
              <div className="text-3xl font-extrabold tracking-tight text-white">
                {formatPaise(combined?.outstandingPayablePaise || 0)}
              </div>
              <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-2">
                <span>Mess: <strong className="text-slate-200">{formatPaise(mess?.remainingPaise || 0)}</strong></span>
                <span>•</span>
                <span>Room: <strong className="text-slate-200">{room?.chargeIssued ? formatPaise(room?.remainingPaise || 0) : 'Not issued'}</strong></span>
                <span>•</span>
                <span>Expenses: <strong className="text-slate-200">{formatPaise(expenses?.owedToOthersPaise || 0)}</strong></span>
              </div>
            </div>

            {combined?.receivablePaise > 0 && (
              <div className="rounded-lg bg-teal-950/60 border border-teal-800/80 px-3 py-2 text-right self-start sm:self-auto">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-400">
                  Owed to you
                </div>
                <div className="text-lg font-bold text-teal-300">
                  {formatPaise(combined.receivablePaise)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3 Domain Category Rows */}
        <FinanceCategoryBreakdown mess={mess} room={room} expenses={expenses} />

        {/* Detailed Itemized Roommate Debts & Receivables */}
        <PayablesReceivables
          debtsOwed={expenses?.debtsOwed || []}
          receivables={expenses?.receivables || []}
        />

        {/* Footer Link to Full Report */}
        <div className="border-t border-slate-200/80 pt-3 dark:border-slate-800/80 flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            Personal tracked consumption: <strong>{formatPaise(combined?.personalTrackedCostPaise || 0)}</strong>
          </span>
          <Link
            to={`/reports?month=${month}&tab=overview`}
            className="inline-flex items-center gap-1 font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400 transition-colors"
          >
            <span>View detailed finances</span>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
