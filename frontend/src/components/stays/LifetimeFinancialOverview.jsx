import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  Receipt,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { formatPaise } from '../../lib/money.js';
import { downloadLifetimeStatementPdf } from '../../lib/stayDownload.js';
import { Button } from '../ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';

export function LifetimeFinancialOverview({
  stayId,
  memberId,
  lifetimeSummary,
}) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  if (!lifetimeSummary) {
    return null;
  }

  const {
    stayDurationMonths = 0,
    mess = {},
    roomFees = {},
    expenses = {},
    deposit = {},
    monthlyBreakdown = [],
  } = lifetimeSummary;

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError('');
    try {
      await downloadLifetimeStatementPdf(stayId, memberId);
    } catch (err) {
      setDownloadError(err?.message || 'Failed to download lifetime statement PDF.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <TrendingUp className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Lifetime Financial Journey
          </CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Consolidated totals over {stayDurationMonths} month{stayDurationMonths === 1 ? '' : 's'} in hostel
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={downloading}
          className="h-8 text-xs border-slate-200 dark:border-slate-700"
        >
          <Download className="h-3.5 w-3.5 mr-1 text-teal-600 dark:text-teal-400" />
          {downloading ? 'Generating...' : 'Lifetime PDF'}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {downloadError && (
          <div className="p-2.5 rounded-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs">
            {downloadError}
          </div>
        )}

        {/* 4 Cards: Mess, Room, Expenses, Deposit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* Mess Card */}
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Mess Consumption
            </span>
            <div className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatPaise(mess.totalBilledPaise || 0)}
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
              <span>Paid: {formatPaise(mess.totalPaidPaise || 0)}</span>
              <span className={(mess.outstandingPaise || 0) > 0 ? 'text-rose-600 font-semibold' : ''}>
                Due: {formatPaise(mess.outstandingPaise || 0)}
              </span>
            </div>
          </div>

          {/* Room Fees Card */}
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Room Rent Issued
            </span>
            <div className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatPaise(roomFees.totalIssuedPaise || 0)}
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
              <span>Paid: {formatPaise(roomFees.totalPaidPaise || 0)}</span>
              <span className={(roomFees.outstandingPaise || 0) > 0 ? 'text-rose-600 font-semibold' : ''}>
                Due: {formatPaise(roomFees.outstandingPaise || 0)}
              </span>
            </div>
          </div>

          {/* Expenses Card */}
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Other Expenses
            </span>
            <div className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatPaise(expenses.totalSharePaise || 0)}
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
              <span>Owed: {formatPaise(expenses.reimbursementsOwedPaise || 0)}</span>
              <span className="text-emerald-600">
                Recv: {formatPaise(expenses.reimbursementsReceivablePaise || 0)}
              </span>
            </div>
          </div>

          {/* Deposit Card */}
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Security Deposit
            </span>
            <div className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatPaise(deposit.depositHeldPaise || 0)}
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
              <span>Recv: {formatPaise(deposit.depositReceivedPaise || 0)}</span>
              <span>Ref: {formatPaise(deposit.depositRefundedPaise || 0)}</span>
            </div>
          </div>
        </div>

        {/* Room Fee Progress Tracker (Section 33) */}
        {roomFees.monthsIssuedCount !== undefined && (
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 text-xs space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Room Fee Progress Tracker
              </span>
              <span className="text-slate-500 text-[11px]">
                {roomFees.fullyPaidMonthsCount || 0} of {roomFees.monthsIssuedCount || 0} months fully settled
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div>Issued Months: <strong className="text-slate-900 dark:text-slate-100">{roomFees.monthsIssuedCount || 0}</strong></div>
              <div>Fully Paid: <strong className="text-emerald-600 dark:text-emerald-400">{roomFees.fullyPaidMonthsCount || 0}</strong></div>
              <div>Partially Paid: <strong className="text-amber-600 dark:text-amber-400">{roomFees.partiallyPaidMonthsCount || 0}</strong></div>
              <div>Unpaid Months: <strong className="text-rose-600 dark:text-rose-400">{roomFees.unpaidMonthsCount || 0}</strong></div>
            </div>
          </div>
        )}

        {/* Collapsible Month-by-Month Financial Table (Section 32) */}
        {monthlyBreakdown.length > 0 && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="flex items-center justify-between w-full py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-teal-600 transition-colors"
            >
              <span>Month-by-Month Statement Summary ({monthlyBreakdown.length} months)</span>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {expanded && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 uppercase tracking-wider">
                      <th className="py-2 pr-3">Month</th>
                      <th className="py-2 px-3">Mess Bill</th>
                      <th className="py-2 px-3">Mess Paid</th>
                      <th className="py-2 px-3">Room Fee</th>
                      <th className="py-2 px-3">Room Paid</th>
                      <th className="py-2 px-3">Expense Share</th>
                      <th className="py-2 pl-3 text-right">Net Payable</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                    {monthlyBreakdown.map((m) => (
                      <tr key={m.month} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2 pr-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {m.month}
                        </td>
                        <td className="py-2 px-3">{formatPaise(m.messBilledPaise || 0)}</td>
                        <td className="py-2 px-3">{formatPaise(m.messPaidPaise || 0)}</td>
                        <td className="py-2 px-3">{formatPaise(m.roomIssuedPaise || 0)}</td>
                        <td className="py-2 px-3">{formatPaise(m.roomPaidPaise || 0)}</td>
                        <td className="py-2 px-3">{formatPaise(m.expenseSharePaise || 0)}</td>
                        <td className="py-2 pl-3 text-right font-medium text-slate-900 dark:text-slate-100">
                          {formatPaise((m.messDuePaise || 0) + (m.roomDuePaise || 0) + (m.expenseOwedPaise || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
