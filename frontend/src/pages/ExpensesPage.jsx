import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Receipt,
  RotateCcw,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { AddExpenseDialog } from '../components/expenses/AddExpenseDialog.jsx';
import { ExpenseCategoryFilter } from '../components/expenses/ExpenseCategoryFilter.jsx';
import { ExpenseDetailsDialog } from '../components/expenses/ExpenseDetailsDialog.jsx';
import { ExpenseList } from '../components/expenses/ExpenseList.jsx';
import { ExpenseOverviewCard } from '../components/expenses/ExpenseOverviewCard.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardHeader } from '../components/ui/card.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useExpenses, useExpenseSummary } from '../hooks/useExpenses.js';
import { usePwa } from '../hooks/usePwa.js';
import { useServerToday } from '../hooks/useServerToday.js';
import { addLogicalMonths, formatLogicalMonth } from '../lib/logicalMonth.js';

export function ExpensesPage() {
  useDocumentTitle('Other Expenses');
  const auth = useAuth();
  const { isOnline } = usePwa();
  const serverToday = useServerToday();

  const currentLogicalMonth = serverToday.date ? serverToday.date.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentLogicalMonth);
  const [activeCategory, setActiveCategory] = useState('');

  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const month = selectedMonth || currentLogicalMonth;

  const {
    data: expenses,
    loading: expensesLoading,
    error: expensesError,
    refresh: refreshExpenses,
  } = useExpenses(month, { category: activeCategory });

  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
    refresh: refreshSummary,
  } = useExpenseSummary(month);

  const isAdmin = auth.role === 'admin' || auth.role === 'superadmin';

  const handleExpenseClick = (exp) => {
    setSelectedExpense(exp);
    setDetailsOpen(true);
  };

  const handleRefreshAll = () => {
    refreshExpenses();
    refreshSummary();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="Other Expenses"
          description="Shared groceries, snacks, outside food, and roommate reimbursements."
        />

        <div className="flex items-center gap-2 self-start sm:self-center">
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => setAddExpenseOpen(true)}
              disabled={!isOnline}
              className="bg-teal-700 hover:bg-teal-800 text-white dark:bg-teal-600 dark:hover:bg-teal-700 text-xs gap-1.5 shadow-xs cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Add Expense</span>
            </Button>
          )}

          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              asChild
              className="text-xs border-slate-200 dark:border-slate-800"
            >
              <Link to="/admin/expenses">
                <ShieldCheck className="h-3.5 w-3.5 mr-1 text-teal-600" />
                <span>Manage</span>
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Offline Alert */}
      {!isOnline && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300 flex items-center gap-2">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>Connect to the internet to record or modify shared expenses.</span>
        </div>
      )}

      {/* Month Toolbar Card */}
      <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatLogicalMonth(month)}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isAdmin ? 'Household shared spending ledger' : 'My personal consumption & dues'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 cursor-pointer"
              onClick={() => setSelectedMonth(addLogicalMonths(month, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs font-medium cursor-pointer"
              onClick={() => setSelectedMonth(currentLogicalMonth)}
            >
              Current
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 cursor-pointer"
              onClick={() => setSelectedMonth(addLogicalMonths(month, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <input
              type="month"
              value={month}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-8 rounded-sm border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 ml-1 cursor-pointer"
              aria-label="Jump to month"
            />
          </div>
        </CardHeader>
      </Card>

      {/* Role-Aware Overview Card */}
      <ExpenseOverviewCard
        summary={summary}
        role={auth.role}
        month={month}
        activeExpenseCount={expenses?.length || 0}
      />

      {/* Category Filter Pills */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold uppercase tracking-wider text-[11px]">
            Filter by category
          </span>
          {activeCategory && (
            <button
              type="button"
              onClick={() => setActiveCategory('')}
              className="text-teal-700 dark:text-teal-400 font-medium hover:underline text-[11px] cursor-pointer"
            >
              Reset filter
            </button>
          )}
        </div>
        <ExpenseCategoryFilter
          activeCategory={activeCategory}
          onSelectCategory={setActiveCategory}
        />
      </div>

      {/* Expense List Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <Receipt className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Recent Purchases
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {expenses?.length || 0} {expenses?.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        <ExpenseList
          expenses={expenses}
          loading={expensesLoading}
          error={expensesError}
          currentMemberId={auth.memberId}
          canAdd={isAdmin && isOnline}
          onAddClick={() => setAddExpenseOpen(true)}
          onSelectExpense={handleExpenseClick}
        />
      </div>

      {/* Add Expense Dialog */}
      <AddExpenseDialog
        open={addExpenseOpen}
        onOpenChange={setAddExpenseOpen}
        onSuccess={handleRefreshAll}
        initialPayerId={auth.memberId || 'gaurav'}
      />

      {/* Expense Details Dialog */}
      {selectedExpense && (
        <ExpenseDetailsDialog
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          expense={selectedExpense}
          role={auth.role}
          onUpdated={handleRefreshAll}
        />
      )}
    </div>
  );
}
