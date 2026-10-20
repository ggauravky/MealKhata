import { ArrowDownLeft, ArrowUpRight, ChevronRight, IndianRupee, Receipt, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/button.jsx';
import { Card, CardContent } from '../ui/card.jsx';
import { Skeleton } from '../ui/skeleton.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { useExpenseSummary } from '../../hooks/useExpenses.js';
import { formatLogicalMonth } from '../../lib/logicalMonth.js';
import { formatPaise } from '../../lib/money.js';

export function DashboardExpenseCard({ month }) {
  const auth = useAuth();

  // Viewer check: do not expose private expense data
  if (!auth.authenticated || auth.role === 'viewer') {
    return null;
  }

  const isMember = auth.role === 'member';
  const isAdminOrSuper = auth.role === 'admin' || auth.role === 'superadmin';

  return isMember ? (
    <MemberDashboardExpenseCard month={month} />
  ) : isAdminOrSuper ? (
    <AdminDashboardExpenseCard month={month} />
  ) : null;
}

function MemberDashboardExpenseCard({ month }) {
  const { data, loading } = useExpenseSummary(month);

  if (loading && !data) {
    return <Skeleton className="h-28 w-full rounded-xl" />;
  }

  const spendingShare = data?.spendingSharePaise || 0;
  const iOwe = data?.iOweOthersPaise || 0;
  const owedToMe = data?.owedToMePaise || 0;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs rounded-xl overflow-hidden">
      <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-700 dark:text-teal-400 shrink-0">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Other Expenses & Shared Spending
              </h3>
              <span className="text-[10px] text-slate-400">
                {formatLogicalMonth(month)}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Groceries, snacks, outside food and shared purchases
            </p>

            <div className="flex items-center gap-4 mt-2.5 text-xs flex-wrap">
              <div>
                <span className="text-slate-400 text-[11px] block">My share</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {formatPaise(spendingShare)}
                </span>
              </div>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />
              <div>
                <span className="text-amber-600 dark:text-amber-400 text-[11px] flex items-center gap-0.5">
                  <ArrowDownLeft className="h-3 w-3" />
                  I owe
                </span>
                <span className="font-bold text-amber-800 dark:text-amber-300">
                  {formatPaise(iOwe)}
                </span>
              </div>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />
              <div>
                <span className="text-emerald-600 dark:text-emerald-400 text-[11px] flex items-center gap-0.5">
                  <ArrowUpRight className="h-3 w-3" />
                  Owed to me
                </span>
                <span className="font-bold text-emerald-800 dark:text-emerald-300">
                  {formatPaise(owedToMe)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <Button asChild variant="outline" size="sm" className="text-xs self-start sm:self-center shrink-0 border-slate-200 dark:border-slate-800">
          <Link to="/expenses">
            <span>View Expenses</span>
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function AdminDashboardExpenseCard({ month }) {
  const { data, loading } = useExpenseSummary(month);

  if (loading && !data) {
    return <Skeleton className="h-28 w-full rounded-xl" />;
  }

  const total = data?.totalExpensesPaise || 0;
  const pending = data?.totalOutstandingReimbursementsPaise || 0;
  const count = data?.expenseCount || 0;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs rounded-xl overflow-hidden">
      <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-700 dark:text-teal-400 shrink-0">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Shared Spending & Other Expenses
              </h3>
              <span className="text-[10px] text-slate-400">
                {formatLogicalMonth(month)}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Household groceries, snacks, outside food and roommate reimbursements
            </p>

            <div className="flex items-center gap-4 mt-2.5 text-xs flex-wrap">
              <div>
                <span className="text-slate-400 text-[11px] block">Household purchases</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {formatPaise(total)} ({count} items)
                </span>
              </div>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />
              <div>
                <span className="text-amber-600 dark:text-amber-400 text-[11px] flex items-center gap-0.5">
                  <ArrowDownLeft className="h-3 w-3" />
                  Pending reimbursements
                </span>
                <span className="font-bold text-amber-800 dark:text-amber-300">
                  {formatPaise(pending)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
          <Button asChild variant="outline" size="sm" className="text-xs border-slate-200 dark:border-slate-800">
            <Link to="/expenses">
              <span>View Expenses</span>
            </Link>
          </Button>
          <Button asChild size="sm" className="text-xs bg-teal-700 hover:bg-teal-800 text-white dark:bg-teal-600 dark:hover:bg-teal-700">
            <Link to="/admin/expenses">
              <span>Manage Expenses</span>
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
