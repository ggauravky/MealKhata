import {
  AlertCircle,
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock,
  Coffee,
  IndianRupee,
  Loader2,
  Pizza,
  Receipt,
  RotateCcw,
  ShoppingBasket,
  ShoppingCart,
  Trash2,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.jsx';
import { Input } from '../ui/input.jsx';
import { Label } from '../ui/label.jsx';
import { RecordReimbursementDialog } from './RecordReimbursementDialog.jsx';
import { api } from '../../lib/api.js';
import { EXPENSE_CATEGORY_CONFIG, ROOMMATES } from '../../lib/constants.js';
import { formatPaise } from '../../lib/money.js';

const CATEGORY_ICONS = {
  groceries: ShoppingBasket,
  snacks: Coffee,
  outside_food: Pizza,
  household_supplies: ShoppingCart,
  utilities: Receipt,
  other: Wallet,
};

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function getMemberName(id) {
  const found = ROOMMATES.find((m) => m.id === id);
  return found ? found.name : id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Unknown';
}

export function ExpenseDetailsDialog({
  open,
  onOpenChange,
  expense,
  role,
  onUpdated,
}) {
  const [recordReimbursementOpen, setRecordReimbursementOpen] = useState(false);
  const [selectedOwingMemberId, setSelectedOwingMemberId] = useState('');
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');

  // Void reimbursement states
  const [voidingReimbId, setVoidingReimbId] = useState(null);
  const [voidReimbReason, setVoidReimbReason] = useState('');
  const [voidingReimb, setVoidingReimb] = useState(false);
  const [voidReimbError, setVoidReimbError] = useState('');

  if (!expense) return null;

  const isAdmin = role === 'admin' || role === 'superadmin';
  const isSuperAdmin = role === 'superadmin';
  const isVoided = expense.status === 'voided';
  const config = EXPENSE_CATEGORY_CONFIG[expense.category] || EXPENSE_CATEGORY_CONFIG.other;
  const Icon = CATEGORY_ICONS[expense.category] || Wallet;

  const payerName = getMemberName(expense.paidByMemberId);
  const activeReimbursements = (expense.reimbursements || []).filter((r) => r.status !== 'voided');
  const voidedReimbursements = (expense.reimbursements || []).filter((r) => r.status === 'voided');

  const canVoidExpense = isSuperAdmin && !isVoided && activeReimbursements.length === 0;

  const handleVoidExpense = async (e) => {
    e.preventDefault();
    setVoidError('');

    if (!voidReason.trim()) {
      setVoidError('A mandatory void reason is required.');
      return;
    }

    setVoiding(true);
    try {
      await api.post(`/api/expenses/${expense.expenseId}/void`, {
        reason: voidReason.trim(),
      });
      setVoidDialogOpen(false);
      setVoidReason('');
      if (onUpdated) onUpdated();
      onOpenChange(false);
    } catch (err) {
      setVoidError(err?.message || 'Failed to void expense.');
    } finally {
      setVoiding(false);
    }
  };

  const handleVoidReimbursement = async (reimbursementId) => {
    if (!voidReimbReason.trim()) {
      setVoidReimbError('A mandatory reason is required to void this reimbursement.');
      return;
    }

    setVoidingReimb(true);
    setVoidReimbError('');
    try {
      await api.post(`/api/expenses/reimbursements/${reimbursementId}/void`, {
        reason: voidReimbReason.trim(),
      });
      setVoidingReimbId(null);
      setVoidReimbReason('');
      if (onUpdated) onUpdated();
    } catch (err) {
      setVoidReimbError(err?.message || 'Failed to void reimbursement.');
    } finally {
      setVoidingReimb(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div
                className={[
                  'h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border',
                  config.badgeClass,
                ].join(' ')}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {expense.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDisplayDate(expense.date)} · {config.label}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Voided Banner */}
            {isVoided && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400">
                <p className="font-semibold flex items-center gap-1.5">
                  <Ban className="h-4 w-4" />
                  This expense has been voided
                </p>
                <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                  Reason: {expense.voidReason}
                </p>
                {expense.voidedAt && (
                  <p className="text-[10px] text-slate-400 mt-1">
                    Voided on {new Date(expense.voidedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </p>
                )}
              </div>
            )}

            {/* Overview Details */}
            <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 text-xs">
              <div>
                <span className="text-slate-500 dark:text-slate-400">Total Purchase</span>
                <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  {formatPaise(expense.amountPaise)}
                </p>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Paid to Shopkeeper by</span>
                <p className="text-sm font-semibold text-teal-800 dark:text-teal-300 mt-1">
                  {payerName}
                </p>
              </div>
              {expense.description && (
                <div className="col-span-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-slate-500 dark:text-slate-400">Note:</span>
                  <p className="text-slate-700 dark:text-slate-300 italic mt-0.5">
                    "{expense.description}"
                  </p>
                </div>
              )}
            </div>

            {/* Member Split Breakdown */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Member Consumption & Split
              </h4>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {(expense.memberShares || []).map((share) => {
                  const name = getMemberName(share.memberId);
                  const isPayer = share.isPayer;

                  return (
                    <div
                      key={share.memberId}
                      className="p-3 flex items-center justify-between bg-white dark:bg-slate-900/60"
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {name}
                          </span>
                          {isPayer && (
                            <span className="text-[10px] font-semibold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.2 rounded">
                              Merchant Payer
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Share: {formatPaise(share.sharePaise)}
                          {!isPayer && share.reimbursedPaise > 0 && (
                            <span> · Reimbursed: {formatPaise(share.reimbursedPaise)}</span>
                          )}
                        </p>
                      </div>

                      <div className="text-right">
                        {isPayer ? (
                          <span className="text-[11px] text-slate-500">
                            Paid bill
                          </span>
                        ) : share.remainingOwedPaise === 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="h-3 w-3" />
                            Settled
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <span className="text-xs font-bold text-amber-700 dark:text-amber-400 block">
                                {formatPaise(share.remainingOwedPaise)}
                              </span>
                              <span className="text-[10px] text-slate-400">due</span>
                            </div>

                            {isAdmin && !isVoided && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedOwingMemberId(share.memberId);
                                  setRecordReimbursementOpen(true);
                                }}
                                className="h-7 px-2 text-[11px] border-teal-600 text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-400 cursor-pointer"
                              >
                                Record payment
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Reimbursement History */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Reimbursement History
              </h4>

              {(expense.reimbursements || []).length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 text-center">
                  No reimbursements recorded yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {(expense.reimbursements || []).map((r) => {
                    const fromName = getMemberName(r.fromMemberId);
                    const toName = getMemberName(r.toMemberId);
                    const isReimbVoided = r.status === 'voided';

                    return (
                      <div
                        key={r.reimbursementId}
                        className={[
                          'p-3 rounded-lg border text-xs flex items-center justify-between',
                          isReimbVoided
                            ? 'opacity-50 bg-slate-100/60 border-slate-200 dark:bg-slate-900/30'
                            : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800',
                        ].join(' ')}
                      >
                        <div>
                          <div className="flex items-center gap-1.5 font-medium">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {fromName}
                            </span>
                            <ArrowRight className="h-3 w-3 text-slate-400" />
                            <span className="text-slate-700 dark:text-slate-300">
                              {toName}
                            </span>
                            <span className="text-[10px] uppercase font-semibold text-slate-400 px-1 bg-slate-100 dark:bg-slate-800 rounded">
                              {r.method}
                            </span>
                            {isReimbVoided && (
                              <span className="text-[10px] text-rose-600 bg-rose-50 px-1 rounded font-semibold">
                                Voided
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {r.recordedAt ? new Date(r.recordedAt).toLocaleDateString('en-IN') : ''}
                            {r.reference ? ` · Ref: ${r.reference}` : ''}
                            {isReimbVoided && r.voidReason && ` · Void reason: ${r.voidReason}`}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className={isReimbVoided ? 'line-through text-slate-400 font-semibold' : 'font-bold text-slate-900 dark:text-slate-100'}>
                            {formatPaise(r.amountPaise)}
                          </span>

                          {isSuperAdmin && !isReimbVoided && !isVoided && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setVoidingReimbId(r.reimbursementId);
                                setVoidReimbReason('');
                              }}
                              className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 cursor-pointer"
                              title="Void reimbursement"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Void Reimbursement Inline Modal/Prompt */}
            {voidingReimbId && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs space-y-2">
                <p className="font-semibold text-amber-900 dark:text-amber-300">
                  Void Reimbursement
                </p>
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Voiding this reimbursement will restore the member's outstanding debt on this purchase.
                </p>
                {voidReimbError && (
                  <p className="text-rose-600 text-[11px]">{voidReimbError}</p>
                )}
                <Input
                  placeholder="Mandatory reason for voiding repayment..."
                  value={voidReimbReason}
                  onChange={(e) => setVoidReimbReason(e.target.value)}
                  className="h-8 text-xs bg-white dark:bg-slate-900"
                />
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setVoidingReimbId(null)}
                    disabled={voidingReimb}
                    className="h-7 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleVoidReimbursement(voidingReimbId)}
                    disabled={voidingReimb || !voidReimbReason.trim()}
                    className="h-7 text-xs"
                  >
                    {voidingReimb ? 'Voiding...' : 'Confirm Void'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-slate-100 dark:border-slate-800">
            {isSuperAdmin && !isVoided && (
              <div className="flex-1 flex justify-start">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setVoidDialogOpen(true)}
                  disabled={!canVoidExpense}
                  className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  title={
                    !canVoidExpense && activeReimbursements.length > 0
                      ? 'Cannot void expense with active reimbursements. Void reimbursements first.'
                      : ''
                  }
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Void Expense
                </Button>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Reimbursement Dialog */}
      <RecordReimbursementDialog
        open={recordReimbursementOpen}
        onOpenChange={setRecordReimbursementOpen}
        expense={expense}
        initialFromMemberId={selectedOwingMemberId}
        onSuccess={() => {
          if (onUpdated) onUpdated();
        }}
      />

      {/* Void Expense Dialog */}
      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-rose-600" />
              Void Expense
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
              This action cannot be undone. The expense will be permanently marked as voided in the audit history and excluded from monthly totals.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleVoidExpense} className="space-y-4 pt-1">
            {voidError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {voidError}
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="void-exp-reason" className="text-xs font-semibold">
                Reason for voiding *
              </Label>
              <Input
                id="void-exp-reason"
                placeholder="e.g. Duplicate entry, Wrong amount entered by mistake"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="text-xs h-9"
                required
                maxLength={300}
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVoidDialogOpen(false)}
                disabled={voiding}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={voiding || !voidReason.trim()}
                className="text-xs"
              >
                {voiding ? 'Voiding...' : 'Confirm Void Expense'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
