import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Layers,
  Plus,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { AddExpenseDialog } from '../components/expenses/AddExpenseDialog.jsx';
import { AdminExpenseHistory } from '../components/expenses/AdminExpenseHistory.jsx';
import { AdminExpenseOverview } from '../components/expenses/AdminExpenseOverview.jsx';
import { ExpenseCategoryFilter } from '../components/expenses/ExpenseCategoryFilter.jsx';
import { ExpenseDetailsDialog } from '../components/expenses/ExpenseDetailsDialog.jsx';
import { ExpenseList } from '../components/expenses/ExpenseList.jsx';
import { RecordReimbursementDialog } from '../components/expenses/RecordReimbursementDialog.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import {
  useExpenseReimbursements,
  useExpenses,
  useExpenseSummary,
} from '../hooks/useExpenses.js';
import { useServerToday } from '../hooks/useServerToday.js';
import { ROOMMATES } from '../lib/constants.js';
import { addLogicalMonths, formatLogicalMonth } from '../lib/logicalMonth.js';
import { formatPaise } from '../lib/money.js';

export function AdminExpensesPage() {
  useDocumentTitle('Admin · Expenses Management');
  const auth = useAuth();
  const navigate = useNavigate();
  const serverToday = useServerToday();

  const currentLogicalMonth = serverToday.date ? serverToday.date.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentLogicalMonth);
  const [activeTab, setActiveTab] = useState('overview');

  const [activeCategory, setActiveCategory] = useState('');
  const [memberFilter, setMemberFilter] = useState('');
  const [includeVoided, setIncludeVoided] = useState(true);

  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Reimbursement flow
  const [recordReimbursementOpen, setRecordReimbursementOpen] = useState(false);
  const [reimbTargetExpense, setReimbTargetExpense] = useState(null);
  const [reimbFromMemberId, setReimbFromMemberId] = useState('');

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

  const {
    data: reimbursements,
    loading: reimbursementsLoading,
    refresh: refreshReimbursements,
  } = useExpenseReimbursements(month, { includeVoided: true });

  const refreshAll = () => {
    refreshExpenses();
    refreshSummary();
    refreshReimbursements();
  };

  // Filter expenses by member or voided
  const filteredExpenses = (expenses || []).filter((exp) => {
    if (!includeVoided && exp.status === 'voided') return false;
    if (memberFilter) {
      const isPayer = exp.paidByMemberId === memberFilter;
      const isBeneficiary = exp.allocations?.some((a) => a.memberId === memberFilter);
      if (!isPayer && !isBeneficiary) return false;
    }
    return true;
  });

  // Extract all pending reimbursement obligations across all expenses
  const allPendingObligations = [];
  for (const exp of expenses || []) {
    if (exp.status === 'voided') continue;
    for (const share of exp.memberShares || []) {
      if (!share.isPayer && share.remainingOwedPaise > 0) {
        allPendingObligations.push({
          expense: exp,
          fromMemberId: share.memberId,
          toMemberId: exp.paidByMemberId,
          remainingPaise: share.remainingOwedPaise,
          originalSharePaise: share.sharePaise,
        });
      }
    }
  }

  const getMemberName = (id) => {
    const found = ROOMMATES.find((m) => m.id === id);
    return found ? found.name : id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Unknown';
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      {/* Header with Navigation Back */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-7 px-2 text-xs text-slate-500 hover:text-slate-900"
            >
              <Link to="/expenses">
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                <span>Expenses</span>
              </Link>
            </Button>
            <span className="text-xs text-slate-300">/</span>
            <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">
              Admin
            </span>
          </div>
          <PageHeader
            title="Expense Management"
            description="Manage hostel groceries, snacks, outside food purchases, and roommate repayments."
          />
        </div>

        <Button
          size="sm"
          onClick={() => setAddExpenseOpen(true)}
          className="bg-teal-700 hover:bg-teal-800 text-white dark:bg-teal-600 dark:hover:bg-teal-700 text-xs gap-1.5 self-start sm:self-center shadow-xs cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Add Expense</span>
        </Button>
      </div>

      {/* Month Toolbar Card */}
      <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatLogicalMonth(month)}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Administrative Control & Audit History
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

      {/* Tabs: Overview | Expenses | Reimbursements | History */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="overview" className="text-xs">
            Overview
          </TabsTrigger>
          <TabsTrigger value="expenses" className="text-xs">
            Expenses ({expenses?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="reimbursements" className="text-xs">
            Reimbursements ({allPendingObligations.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs">
            History
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Overview */}
        <TabsContent value="overview" className="space-y-4 pt-4">
          <AdminExpenseOverview summary={summary} />
        </TabsContent>

        {/* Tab 2: Expenses List & Filters */}
        <TabsContent value="expenses" className="space-y-4 pt-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Member:</span>
              <select
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                <option value="">All Roommates</option>
                {ROOMMATES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={includeVoided}
                  onChange={(e) => setIncludeVoided(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span>Include voided</span>
              </label>
            </div>

            <span className="text-slate-400">
              Showing {filteredExpenses.length} of {expenses?.length || 0}
            </span>
          </div>

          <ExpenseCategoryFilter
            activeCategory={activeCategory}
            onSelectCategory={setActiveCategory}
          />

          <ExpenseList
            expenses={filteredExpenses}
            loading={expensesLoading}
            error={expensesError}
            currentMemberId={auth.memberId}
            canAdd={true}
            onAddClick={() => setAddExpenseOpen(true)}
            onSelectExpense={(exp) => {
              setSelectedExpense(exp);
              setDetailsOpen(true);
            }}
          />
        </TabsContent>

        {/* Tab 3: Reimbursements Recording */}
        <TabsContent value="reimbursements" className="space-y-4 pt-4">
          <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center justify-between">
                <span>Pending Reimbursements</span>
                <span className="text-xs font-normal text-slate-400">
                  {allPendingObligations.length} outstanding
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-1">
              {allPendingObligations.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 italic">
                  All recorded shared purchases are completely reimbursed.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {allPendingObligations.map((ob, idx) => {
                    const fromName = getMemberName(ob.fromMemberId);
                    const toName = getMemberName(ob.toMemberId);

                    return (
                      <div
                        key={idx}
                        className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-1.5 font-medium">
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              {fromName}
                            </span>
                            <span className="text-slate-400">owes</span>
                            <span className="font-bold text-teal-800 dark:text-teal-300">
                              {toName}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Expense: <strong className="text-slate-700 dark:text-slate-300">{ob.expense.title}</strong> · Date: {ob.expense.date}
                          </p>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm font-bold text-amber-800 dark:text-amber-300">
                            {formatPaise(ob.remainingPaise)}
                          </span>

                          <Button
                            size="sm"
                            onClick={() => {
                              setReimbTargetExpense(ob.expense);
                              setReimbFromMemberId(ob.fromMemberId);
                              setRecordReimbursementOpen(true);
                            }}
                            className="h-8 px-3 text-xs bg-teal-700 hover:bg-teal-800 text-white dark:bg-teal-600 dark:hover:bg-teal-700 cursor-pointer"
                          >
                            Record Payment
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Audit History */}
        <TabsContent value="history" className="space-y-4 pt-4">
          <AdminExpenseHistory
            expenses={expenses}
            reimbursements={reimbursements}
          />
        </TabsContent>
      </Tabs>

      {/* Add Expense Dialog */}
      <AddExpenseDialog
        open={addExpenseOpen}
        onOpenChange={setAddExpenseOpen}
        onSuccess={refreshAll}
        initialPayerId={auth.memberId || 'gaurav'}
      />

      {/* Expense Details Dialog */}
      {selectedExpense && (
        <ExpenseDetailsDialog
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          expense={selectedExpense}
          role={auth.role}
          onUpdated={refreshAll}
        />
      )}

      {/* Record Reimbursement Dialog */}
      {reimbTargetExpense && (
        <RecordReimbursementDialog
          open={recordReimbursementOpen}
          onOpenChange={setRecordReimbursementOpen}
          expense={reimbTargetExpense}
          initialFromMemberId={reimbFromMemberId}
          onSuccess={refreshAll}
        />
      )}
    </div>
  );
}
