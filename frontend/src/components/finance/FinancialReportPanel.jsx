import { AlertCircle, Download, FileText, Loader2, Users } from 'lucide-react';
import { useState } from 'react';
import { formatPaise } from '../../lib/money.js';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useHouseholdFinance, useMemberFinance } from '../../hooks/useFinance.js';
import { FinancialHouseholdSummary } from './FinancialHouseholdSummary.jsx';
import { FinancialOverviewCard } from './FinancialOverviewCard.jsx';
import { downloadHouseholdStatementPdf, downloadMemberStatementPdf } from '../../lib/financeDownload.js';

export function FinancialReportPanel({ month }) {
  const { role, authenticated } = useAuth();
  const isAdminOrSuper = role === 'admin' || role === 'superadmin';
  const monthLabel = formatLogicalMonth(month);

  const householdQuery = useHouseholdFinance(month);
  const memberQuery = useMemberFinance(month);

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const handleDownload = async () => {
    if (downloading) return;
    try {
      setDownloading(true);
      setDownloadError(null);
      if (isAdminOrSuper) {
        await downloadHouseholdStatementPdf(month);
      } else {
        await downloadMemberStatementPdf(month);
      }
    } catch (err) {
      setDownloadError(err?.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const loading = isAdminOrSuper ? householdQuery.loading : memberQuery.loading;
  const error = isAdminOrSuper ? householdQuery.error : memberQuery.error;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-500">
        <Loader2 className="h-7 w-7 animate-spin text-teal-600 mb-2" />
        <span className="text-sm">Calculating unified monthly financial report...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4" />
          <span>Financial Report Unavailable</span>
        </div>
        <p className="mt-1 text-xs">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800/80">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {monthLabel} Unified Financial Report
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Authoritative multi-domain accounting across Mess, Room Fees, and Shared Expenses.
          </p>
        </div>

        <button
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3.5 py-2 text-xs font-semibold text-white shadow hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span>{downloading ? 'Generating PDF...' : isAdminOrSuper ? 'Download Household PDF' : 'Download Personal PDF'}</span>
        </button>
      </div>

      {downloadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          {downloadError}
        </div>
      )}

      {/* Admin View: Household Overview + Consolidated Member Table */}
      {isAdminOrSuper && householdQuery.data && (
        <>
          <FinancialHouseholdSummary household={householdQuery.data} showDownload={false} />

          {/* Consolidated Member Table (Desktop) & Cards (Mobile) */}
          <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:border-slate-800/80 dark:bg-slate-900">
            <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-800/80">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Consolidated Member Financial Breakdown
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Independent obligations calculated per resident. Receivables are kept strictly separate from payable dues.
              </p>
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-400 font-semibold">
                    <th className="py-2.5 px-3">Member</th>
                    <th className="py-2.5 px-3 text-right">Mess Bill</th>
                    <th className="py-2.5 px-3 text-right">Mess Paid</th>
                    <th className="py-2.5 px-3 text-right">Mess Due</th>
                    <th className="py-2.5 px-3 text-right">Room Charge</th>
                    <th className="py-2.5 px-3 text-right">Room Paid</th>
                    <th className="py-2.5 px-3 text-right">Room Due</th>
                    <th className="py-2.5 px-3 text-right">Exp Share</th>
                    <th className="py-2.5 px-3 text-right">Exp Owed</th>
                    <th className="py-2.5 px-3 text-right">Receivable</th>
                    <th className="py-2.5 px-3 text-right font-bold text-teal-700 dark:text-teal-400">Total to Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {Object.values(householdQuery.data.memberSummaries || {}).map((ms) => (
                    <tr key={ms.member.memberId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                        {ms.member.displayName}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-400">{formatPaise(ms.mess.billPaise)}</td>
                      <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-400">{formatPaise(ms.mess.paidPaise)}</td>
                      <td className={`py-3 px-3 text-right font-medium ${ms.mess.remainingPaise > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
                        {formatPaise(ms.mess.remainingPaise)}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-400">{formatPaise(ms.room.issuedChargePaise)}</td>
                      <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-400">{formatPaise(ms.room.paidPaise)}</td>
                      <td className={`py-3 px-3 text-right font-medium ${ms.room.remainingPaise > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
                        {formatPaise(ms.room.remainingPaise)}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-400">{formatPaise(ms.expenses.spendingSharePaise)}</td>
                      <td className={`py-3 px-3 text-right font-medium ${ms.expenses.owedToOthersPaise > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>
                        {formatPaise(ms.expenses.owedToOthersPaise)}
                      </td>
                      <td className={`py-3 px-3 text-right font-medium ${ms.expenses.owedToMePaise > 0 ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500'}`}>
                        {formatPaise(ms.expenses.owedToMePaise)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-slate-100">
                        {formatPaise(ms.combined.outstandingPayablePaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Member Cards View */}
            <div className="lg:hidden p-3 space-y-3">
              {Object.values(householdQuery.data.memberSummaries || {}).map((ms) => (
                <div key={ms.member.memberId} className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 space-y-2 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="flex items-center justify-between border-b border-slate-200/60 pb-2 dark:border-slate-800">
                    <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                      {ms.member.displayName}
                    </span>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Total to Pay</span>
                      <span className="font-extrabold text-teal-700 dark:text-teal-300 text-sm">
                        {formatPaise(ms.combined.outstandingPayablePaise)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Mess (Due / Bill)</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {formatPaise(ms.mess.remainingPaise)} / {formatPaise(ms.mess.billPaise)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Room (Due / Charge)</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {formatPaise(ms.room.remainingPaise)} / {formatPaise(ms.room.issuedChargePaise)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Expense Debt Owed</span>
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        {formatPaise(ms.expenses.owedToOthersPaise)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Receivable Owed to Me</span>
                      <span className="font-medium text-teal-600 dark:text-teal-400">
                        {formatPaise(ms.expenses.owedToMePaise)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Reconciliation & Accounting Principles Section */}
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 text-xs space-y-2 dark:border-slate-800/80 dark:bg-slate-900/40">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 dark:text-slate-200">
              Accounting Principles & Financial Isolation
            </span>
            {householdQuery.data?.reconciliation?.reconciled && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                100% Reconciled
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500">
            Three Independent Ledgers (Mess, Room Fees, Other Expenses)
          </span>
        </div>
        <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 space-y-1 text-[11px]">
          <li><strong>Expenses counted once:</strong> Member expense shares allocate the initial purchase; reimbursements are internal roommate transfers, not new spending.</li>
          <li><strong>No auto-netting:</strong> Roommate receivables are tracked separately and are never deducted from official Mess or Room dues.</li>
          <li><strong>Ledger autonomy:</strong> Payments and overpayments stay strictly isolated within their source financial domains.</li>
        </ul>
      </div>

      {/* Member View: Personal Overview Card */}
      {!isAdminOrSuper && memberQuery.data && (
        <FinancialOverviewCard overview={memberQuery.data} onRefresh={memberQuery.refresh} />
      )}
    </div>
  );
}
