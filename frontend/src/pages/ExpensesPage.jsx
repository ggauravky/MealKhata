import {
  AlertCircle,
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
import { EditExpenseDialog } from '../components/expenses/EditExpenseDialog.jsx';
import { ExpenseCategoryFilter } from '../components/expenses/ExpenseCategoryFilter.jsx';
import { ExpenseDetailsDialog } from '../components/expenses/ExpenseDetailsDialog.jsx';
import { ExpenseList } from '../components/expenses/ExpenseList.jsx';
import { ExpenseOverviewCard } from '../components/expenses/ExpenseOverviewCard.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardHeader } from '../components/ui/card.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.jsx';
import { Input } from '../components/ui/input.jsx';
import { Label } from '../components/ui/label.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useExpenses, useExpenseSummary } from '../hooks/useExpenses.js';
import { usePwa } from '../hooks/usePwa.js';
import { useServerToday } from '../hooks/useServerToday.js';
import { addLogicalMonths, formatLogicalMonth } from '../lib/logicalMonth.js';
import { getIndiaCurrentLogicalMonth } from '../lib/logicalDate.js';
import { formatPaise } from '../lib/money.js';
import { api } from '../lib/api.js';

export function ExpensesPage() {
  useDocumentTitle('Other Expenses');
  const auth = useAuth();
  const { isOnline } = usePwa();
  const serverToday = useServerToday();

  const currentLogicalMonth = serverToday.date ? serverToday.date.slice(0, 7) : getIndiaCurrentLogicalMonth();
  const [selectedMonth, setSelectedMonth] = useState(currentLogicalMonth);
  const [activeCategory, setActiveCategory] = useState('');

  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [selectedExpenseId, setSelectedExpenseId] = useState(null);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editExpenseOpen, setEditExpenseOpen] = useState(false);
  const [targetExpenseForEdit, setTargetExpenseForEdit] = useState(null);
  const [deleteExpenseOpen, setDeleteExpenseOpen] = useState(false);
  const [targetExpenseForDelete, setTargetExpenseForDelete] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

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
  const isSuperAdmin = auth.role === 'superadmin';
  const currentSelectedExpense = expenses?.find((expense) => expense.expenseId === selectedExpenseId)
    || selectedExpense;

  const handleExpenseClick = (exp) => {
    setSelectedExpenseId(exp.expenseId);
    setSelectedExpense(exp);
    setDetailsOpen(true);
  };

  const handleOpenEdit = (expense) => {
    setDetailsOpen(false);
    setTargetExpenseForEdit(expense);
    window.setTimeout(() => setEditExpenseOpen(true), 0);
  };

  const handleOpenDelete = (expense) => {
    setDetailsOpen(false);
    setTargetExpenseForDelete(expense);
    setDeleteReason('');
    setDeleteError('');
    window.setTimeout(() => setDeleteExpenseOpen(true), 0);
  };

  const handleDeleteExpense = async (event) => {
    event.preventDefault();
    if (!targetExpenseForDelete || !deleteReason.trim()) {
      setDeleteError('A mandatory deletion reason is required.');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      const deletedId = targetExpenseForDelete.expenseId;
      await api.post(`/api/expenses/${deletedId}/void`, { reason: deleteReason.trim() });
      setDeleteExpenseOpen(false);
      setTargetExpenseForDelete(null);
      setDeleteReason('');
      if (selectedExpenseId === deletedId) {
        setSelectedExpenseId(null);
        setSelectedExpense(null);
      }
      handleRefreshAll();
    } catch (deleteFailure) {
      setDeleteError(deleteFailure?.message || 'Failed to delete expense.');
    } finally {
      setDeleting(false);
    }
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
          onView={handleExpenseClick}
          onEdit={handleOpenEdit}
          onDelete={handleOpenDelete}
          isSuperAdmin={isSuperAdmin}
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
      {currentSelectedExpense && (
        <ExpenseDetailsDialog
          open={detailsOpen}
          onOpenChange={(isOpen) => {
            setDetailsOpen(isOpen);
            if (!isOpen && !editExpenseOpen && !deleteExpenseOpen) {
              setSelectedExpenseId(null);
              setSelectedExpense(null);
            }
          }}
          expense={currentSelectedExpense}
          expenseId={selectedExpenseId}
          role={auth.role}
          onUpdated={handleRefreshAll}
          onEdit={handleOpenEdit}
        />
      )}

      {targetExpenseForEdit && (
        <EditExpenseDialog
          open={editExpenseOpen}
          onOpenChange={(isOpen) => {
            setEditExpenseOpen(isOpen);
            if (!isOpen) setTargetExpenseForEdit(null);
          }}
          expense={targetExpenseForEdit}
          onSuccess={(updatedExpense) => {
            handleRefreshAll();
            if (updatedExpense?.month && updatedExpense.month !== selectedMonth) {
              setSelectedMonth(updatedExpense.month);
            }
            setSelectedExpense(updatedExpense || null);
            setSelectedExpenseId(updatedExpense?.expenseId || null);
            setTargetExpenseForEdit(null);
          }}
        />
      )}

      <Dialog open={deleteExpenseOpen} onOpenChange={setDeleteExpenseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <AlertCircle className="h-5 w-5 text-rose-600" />
              Delete Expense?
            </DialogTitle>
            <DialogDescription className="text-xs">
              <strong>{targetExpenseForDelete?.title}</strong> · {formatPaise(targetExpenseForDelete?.amountPaise || 0)}
              <br />
              The purchase will leave active totals but remain in immutable audit history.
            </DialogDescription>
          </DialogHeader>

          {targetExpenseForDelete?.reimbursements?.some((reimbursement) => reimbursement.status !== 'voided') ? (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">Deletion blocked</p>
              <p>
                This purchase has recorded reimbursements. Reconcile or void the applicable reimbursement records first.
              </p>
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={() => setDeleteExpenseOpen(false)}>Close</Button>
              </div>
            </div>
          ) : (
          <form onSubmit={handleDeleteExpense} className="space-y-4">
            {deleteError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {deleteError}
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="expense-delete-reason" className="text-xs font-semibold">Reason for deletion *</Label>
              <Input
                id="expense-delete-reason"
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                placeholder="Why should this purchase be voided?"
                required
                maxLength={300}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setDeleteExpenseOpen(false)} disabled={deleting}>Cancel</Button>
              <Button type="submit" variant="destructive" size="sm" disabled={deleting || !deleteReason.trim()}>
                {deleting ? 'Deleting…' : 'Delete Expense'}
              </Button>
            </DialogFooter>
          </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
