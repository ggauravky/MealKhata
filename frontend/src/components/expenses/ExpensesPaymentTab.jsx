import {
  AlertCircle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  History,
  IndianRupee,
  Receipt,
  User,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../ui/badge.jsx';
import { Button } from '../ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.jsx';
import { ExpenseDetailsDialog } from './ExpenseDetailsDialog.jsx';
import { RecordReimbursementDialog } from './RecordReimbursementDialog.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import {
  useExpenseReimbursements,
  useExpenses,
  useExpenseSummary,
} from '../../hooks/useExpenses.js';
import { ROOMMATES } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';

function getMemberName(id) {
  const found = ROOMMATES.find((m) => m.id === id);
  return found ? found.name : id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Unknown';
}

export function ExpensesPaymentTab({ month }) {
  const auth = useAuth();
  const isAdmin = auth.role === 'admin' || auth.role === 'superadmin';
  const memberId = auth.memberId;

  const { data: summary, loading: summaryLoading, refresh: refreshSummary } = useExpenseSummary(month);
  const { data: expenses, loading: expensesLoading, refresh: refreshExpenses } = useExpenses(month);
  const { data: reimbursements, loading: reimbursementsLoading, refresh: refreshReimbursements } = useExpenseReimbursements(month);

  const [selectedExpense, setSelectedExpense] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [recordReimbursementOpen, setRecordReimbursementOpen] = useState(false);
  const [reimbursementTargetExpense, setReimbursementTargetExpense] = useState(null);
  const [reimbursementFromMember, setReimbursementFromMember] = useState('');

  const refreshAll = () => {
    refreshSummary();
    refreshExpenses();
    refreshReimbursements();
  };

  // Derive pending reimbursements across active expenses
  const pendingObligations = [];
  for (const exp of expenses || []) {
    if (exp.status === 'voided') continue;

    for (const share of exp.memberShares || []) {
      if (share.isPayer || share.remainingOwedPaise <= 0) continue;

      // Filter to relevant obligations for Member
      if (!isAdmin && memberId && share.memberId !== memberId && exp.paidByMemberId !== memberId) {
        continue;
      }

      pendingObligations.push({
        expenseId: exp.expenseId,
        expenseTitle: exp.title,
        expenseDate: exp.date,
        fromMemberId: share.memberId,
        toMemberId: exp.paidByMemberId,
        remainingPaise: share.remainingOwedPaise,
        originalSharePaise: share.sharePaise,
        expense: exp,
      });
    }
  }

  // Active / non-voided reimbursements
  const activeReimbursements = (reimbursements || []).filter((r) => r.status !== 'voided');

  return (
    <div className="space-y-6">
      {/* Metrics Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {isAdmin ? (
          <>
            <Card className="p-4 border-amber-200/80 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 shadow-xs">
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <ArrowDownLeft className="h-4 w-4" />
                Total Outstanding Reimbursements
              </span>
              <p className="text-xl font-bold text-amber-950 dark:text-amber-100 mt-1">
                {formatPaise(summary?.totalOutstandingReimbursementsPaise || 0)}
              </p>
              <span className="text-[11px] text-amber-700/80 dark:text-amber-400 mt-0.5 block">
                Across all hostel roommates this month
              </span>
            </Card>

            <Card className="p-4 border-emerald-200/80 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-xs">
              <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                Total Settled Repayments
              </span>
              <p className="text-xl font-bold text-emerald-950 dark:text-emerald-100 mt-1">
                {formatPaise(summary?.totalReimbursementsPaidPaise || 0)}
              </p>
              <span className="text-[11px] text-emerald-700/80 dark:text-emerald-400 mt-0.5 block">
                Confirmed repayments recorded
              </span>
            </Card>
          </>
        ) : (
          <>
            <Card className="p-4 border-amber-200/80 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 shadow-xs">
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <ArrowDownLeft className="h-4 w-4" />
                I Owe Other Members
              </span>
              <p className="text-xl font-bold text-amber-950 dark:text-amber-100 mt-1">
                {formatPaise(summary?.iOweOthersPaise || 0)}
              </p>
              <span className="text-[11px] text-amber-700/80 dark:text-amber-400 mt-0.5 block">
                Pending repayment to roommates
              </span>
            </Card>

            <Card className="p-4 border-emerald-200/80 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-xs">
              <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <ArrowUpRight className="h-4 w-4" />
                Other Members Owe Me
              </span>
              <p className="text-xl font-bold text-emerald-950 dark:text-emerald-100 mt-1">
                {formatPaise(summary?.owedToMePaise || 0)}
              </p>
              <span className="text-[11px] text-emerald-700/80 dark:text-emerald-400 mt-0.5 block">
                For purchases I paid to shopkeepers
              </span>
            </Card>
          </>
        )}
      </div>

      {/* Pending Reimbursements Card */}
      <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
          <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            Pending Reimbursements
          </CardTitle>
          <span className="text-xs text-slate-400 font-medium">
            {pendingObligations.length} pending
          </span>
        </CardHeader>
        <CardContent className="p-4 pt-1">
          {pendingObligations.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 italic">
              All shared expenses for this month are fully settled.
            </div>
          ) : (
            <div className="space-y-2">
              {pendingObligations.map((ob, idx) => {
                const fromName = getMemberName(ob.fromMemberId);
                const toName = getMemberName(ob.toMemberId);
                const isMyDebt = memberId && ob.fromMemberId === memberId;
                const isMyCredit = memberId && ob.toMemberId === memberId;

                return (
                  <div
                    key={idx}
                    className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {fromName}
                        </span>
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {toName}
                        </span>
                        {isMyDebt && (
                          <span className="text-[10px] text-amber-700 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.2 rounded font-semibold">
                            You owe
                          </span>
                        )}
                        {isMyCredit && (
                          <span className="text-[10px] text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.2 rounded font-semibold">
                            Owed to you
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        For <strong className="text-slate-700 dark:text-slate-300">{ob.expenseTitle}</strong> · Total share: {formatPaise(ob.originalSharePaise)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold text-amber-800 dark:text-amber-300 text-sm">
                        {formatPaise(ob.remainingPaise)}
                      </span>

                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setReimbursementTargetExpense(ob.expense);
                            setReimbursementFromMember(ob.fromMemberId);
                            setRecordReimbursementOpen(true);
                          }}
                          className="h-7 px-2 text-[11px] border-teal-600 text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-400 cursor-pointer"
                        >
                          Record payment
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recorded Reimbursements History */}
      <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
          <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <History className="h-4 w-4 text-teal-600" />
            Confirmed Reimbursements
          </CardTitle>
          <span className="text-xs text-slate-400 font-medium">
            {activeReimbursements.length} recorded
          </span>
        </CardHeader>
        <CardContent className="p-4 pt-1">
          {activeReimbursements.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 italic">
              No reimbursements recorded yet for this month.
            </div>
          ) : (
            <div className="space-y-2">
              {activeReimbursements.map((r) => {
                const fromName = getMemberName(r.fromMemberId);
                const toName = getMemberName(r.toMemberId);

                return (
                  <div
                    key={r.reimbursementId}
                    className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {fromName}
                        </span>
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                        <span className="text-slate-700 dark:text-slate-300">
                          {toName}
                        </span>
                        <span className="text-[10px] uppercase font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-1 rounded">
                          {r.method}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {r.recordedAt ? new Date(r.recordedAt).toLocaleDateString('en-IN') : ''}
                        {r.reference && ` · Ref: ${r.reference}`}
                      </p>
                    </div>

                    <span className="font-bold text-emerald-800 dark:text-emerald-300">
                      {formatPaise(r.amountPaise)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Link to full Expenses Page */}
      <div className="flex items-center justify-center pt-2">
        <Button
          variant="outline"
          size="sm"
          asChild
          className="text-xs border-slate-200 dark:border-slate-800 gap-1.5"
        >
          <Link to="/expenses">
            <Receipt className="h-3.5 w-3.5" />
            <span>Open Other Expenses Page</span>
          </Link>
        </Button>
      </div>

      {/* Record Reimbursement Dialog */}
      {reimbursementTargetExpense && (
        <RecordReimbursementDialog
          open={recordReimbursementOpen}
          onOpenChange={setRecordReimbursementOpen}
          expense={reimbursementTargetExpense}
          initialFromMemberId={reimbursementFromMember}
          onSuccess={refreshAll}
        />
      )}
    </div>
  );
}
