import { ArrowDownLeft, ArrowUpRight, CheckCircle2, IndianRupee, Receipt, ShoppingBag, Users } from 'lucide-react';
import { Card, CardContent } from '../ui/card.jsx';
import { formatPaise } from '../../lib/money.js';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';

export function ExpenseOverviewCard({ summary, role, month, activeExpenseCount = 0 }) {
  if (!summary) return null;

  const isAdmin = role === 'admin' || role === 'superadmin';

  if (isAdmin) {
    const totalExpenses = summary.totalExpensesPaise || 0;
    const totalOutstanding = summary.totalOutstandingReimbursementsPaise || 0;
    const totalReimbursed = summary.totalReimbursementsPaidPaise || 0;

    return (
      <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs overflow-hidden">
        <div className="bg-gradient-to-r from-teal-700 to-teal-800 dark:from-teal-900/60 dark:to-slate-900 px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold tracking-wider uppercase text-teal-200 dark:text-teal-300">
                Hostel Shared Spending
              </span>
              <h2 className="text-xl font-bold mt-0.5">
                {formatLogicalMonth(month)}
              </h2>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-teal-200 dark:text-teal-300">Total Purchases</span>
              <p className="text-2xl font-bold tracking-tight">
                {formatPaise(totalExpenses)}
              </p>
            </div>
          </div>
        </div>

        <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <ShoppingBag className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              Recorded Purchases
            </span>
            <p className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-1">
              {summary.expenseCount ?? activeExpenseCount} items
            </p>
          </div>

          <div className="p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30">
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
              <ArrowDownLeft className="h-3.5 w-3.5" />
              Pending Reimbursements
            </span>
            <p className="text-base font-semibold text-amber-900 dark:text-amber-300 mt-1">
              {formatPaise(totalOutstanding)}
            </p>
          </div>

          <div className="col-span-2 sm:col-span-1 p-3 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Settled Repayments
            </span>
            <p className="text-base font-semibold text-emerald-900 dark:text-emerald-300 mt-1">
              {formatPaise(totalReimbursed)}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Member Perspective
  const spendingShare = summary.spendingSharePaise || 0;
  const paidMerchants = summary.paidMerchantsPaise || 0;
  const iOweOthers = summary.iOweOthersPaise || 0;
  const owedToMe = summary.owedToMePaise || 0;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs overflow-hidden">
      <div className="bg-gradient-to-r from-teal-700 to-teal-800 dark:from-teal-900/60 dark:to-slate-900 px-5 py-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold tracking-wider uppercase text-teal-200 dark:text-teal-300">
              My Other Expenses
            </span>
            <h2 className="text-xl font-bold mt-0.5">
              {formatLogicalMonth(month)}
            </h2>
          </div>
          <div className="text-right">
            <span className="text-[11px] text-teal-200 dark:text-teal-300">My Spending Share</span>
            <p className="text-2xl font-bold tracking-tight">
              {formatPaise(spendingShare)}
            </p>
          </div>
        </div>
      </div>

      <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <IndianRupee className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            Paid to Shopkeepers
          </span>
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-1">
            {formatPaise(paidMerchants)}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30">
          <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <ArrowDownLeft className="h-3.5 w-3.5" />
            I Owe Others
          </span>
          <p className="text-base font-semibold text-amber-900 dark:text-amber-300 mt-1">
            {formatPaise(iOweOthers)}
          </p>
        </div>

        <div className="col-span-2 sm:col-span-1 p-3 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <ArrowUpRight className="h-3.5 w-3.5" />
            Owed to Me
          </span>
          <p className="text-base font-semibold text-emerald-900 dark:text-emerald-300 mt-1">
            {formatPaise(owedToMe)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
