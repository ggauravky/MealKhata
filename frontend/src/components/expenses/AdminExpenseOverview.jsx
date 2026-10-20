import { ArrowDownLeft, ArrowUpRight, CheckCircle2, IndianRupee, Layers, ShoppingBag, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_CONFIG, ROOMMATES } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';

export function AdminExpenseOverview({ summary }) {
  if (!summary) return null;

  const {
    totalExpensesPaise = 0,
    totalOutstandingReimbursementsPaise = 0,
    totalReimbursedPaidPaise = 0,
    expenseCount = 0,
    categoryBreakdown = {},
    members = {},
  } = summary;

  return (
    <div className="space-y-4">
      {/* 3 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <ShoppingBag className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Total Purchases
          </span>
          <p className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
            {formatPaise(totalExpensesPaise)}
          </p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            Across {expenseCount} active purchases
          </span>
        </Card>

        <Card className="p-4 border-amber-200/80 dark:border-amber-900/40 bg-amber-50/30 dark:bg-amber-950/20 shadow-xs">
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <ArrowDownLeft className="h-4 w-4" />
            Outstanding Reimbursements
          </span>
          <p className="text-xl font-bold text-amber-900 dark:text-amber-200 mt-1">
            {formatPaise(totalOutstandingReimbursementsPaise)}
          </p>
          <span className="text-[11px] text-amber-600/80 dark:text-amber-400 mt-0.5 block">
            Repayments due between roommates
          </span>
        </Card>

        <Card className="p-4 border-emerald-200/80 dark:border-emerald-900/40 bg-emerald-50/30 dark:bg-emerald-950/20 shadow-xs">
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            Settled Repayments
          </span>
          <p className="text-xl font-bold text-emerald-900 dark:text-emerald-200 mt-1">
            {formatPaise(totalReimbursedPaidPaise)}
          </p>
          <span className="text-[11px] text-emerald-600/80 dark:text-emerald-400 mt-0.5 block">
            Transferred and confirmed
          </span>
        </Card>
      </div>

      {/* Member Shares Breakdown */}
      <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Users className="h-4 w-4 text-teal-600" />
            Member Spending & Obligations
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {ROOMMATES.map((m) => {
              const memData = members[m.id] || {};
              const share = memData.spendingSharePaise || 0;
              const paidMerchants = memData.paidMerchantsPaise || 0;
              const iOwe = memData.iOweOthersPaise || 0;
              const owedToMe = memData.owedToMePaise || 0;

              return (
                <div
                  key={m.id}
                  className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-2.5 text-xs"
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60 dark:border-slate-800">
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      {m.name}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Share: <strong>{formatPaise(share)}</strong>
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 flex items-center gap-1">
                        <IndianRupee className="h-3 w-3 text-teal-600" />
                        Paid shopkeeper
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {formatPaise(paidMerchants)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-amber-700 dark:text-amber-400 flex items-center gap-1">
                        <ArrowDownLeft className="h-3 w-3" />
                        Owes others
                      </span>
                      <span className="font-bold text-amber-800 dark:text-amber-300">
                        {formatPaise(iOwe)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <ArrowUpRight className="h-3 w-3" />
                        Owed to them
                      </span>
                      <span className="font-bold text-emerald-800 dark:text-emerald-300">
                        {formatPaise(owedToMe)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Category Breakdown */}
      <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Layers className="h-4 w-4 text-teal-600" />
            Spending by Category
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-1">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {EXPENSE_CATEGORIES.map((cat) => {
              const info = categoryBreakdown[cat] || { count: 0, totalPaise: 0 };
              const cfg = EXPENSE_CATEGORY_CONFIG[cat] || EXPENSE_CATEGORY_CONFIG.other;

              return (
                <div
                  key={cat}
                  className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 flex items-center justify-between"
                >
                  <div>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                      {cfg.label}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {info.count} items
                    </span>
                  </div>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {formatPaise(info.totalPaise)}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
