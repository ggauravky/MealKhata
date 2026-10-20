import { AlertCircle, IndianRupee, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { api } from '../../lib/api.js';
import { ROOMMATES } from '../../lib/constants.js';
import { formatPaise, paymentRupeesToPaise } from '../../lib/money.js';

export function RecordReimbursementDialog({
  open,
  onOpenChange,
  expense,
  initialFromMemberId,
  onSuccess,
}) {
  const [fromMemberId, setFromMemberId] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [method, setMethod] = useState('upi');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const payerId = expense?.paidByMemberId;
  const payerName = payerId
    ? ROOMMATES.find((m) => m.id === payerId)?.name || payerId
    : '';

  // Filter members who owe on this expense
  const owingMembers = (expense?.memberShares || [])
    .filter((s) => !s.isPayer && s.remainingOwedPaise > 0)
    .map((s) => ({
      ...s,
      name: ROOMMATES.find((m) => m.id === s.memberId)?.name || s.memberId,
    }));

  useEffect(() => {
    if (open && owingMembers.length > 0) {
      const defaultMember =
        owingMembers.find((m) => m.memberId === initialFromMemberId) || owingMembers[0];
      setFromMemberId(defaultMember.memberId);
      // Pre-fill full remaining amount
      setAmountRupees((defaultMember.remainingOwedPaise / 100).toFixed(2));
      setMethod('upi');
      setReference('');
      setError('');
    }
  }, [open, initialFromMemberId]);

  // When fromMemberId changes, adjust pre-filled amount to that member's remaining owed
  const handleMemberChange = (id) => {
    setFromMemberId(id);
    const m = owingMembers.find((item) => item.memberId === id);
    if (m) {
      setAmountRupees((m.remainingOwedPaise / 100).toFixed(2));
    }
  };

  const selectedOwingMember = owingMembers.find((m) => m.memberId === fromMemberId);
  const maxAllowedPaise = selectedOwingMember?.remainingOwedPaise || 0;
  const enteredPaise = paymentRupeesToPaise(amountRupees) || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!fromMemberId) {
      setError('Please select the member repaying.');
      return;
    }

    if (enteredPaise <= 0) {
      setError('Please enter a valid positive reimbursement amount.');
      return;
    }

    if (enteredPaise > maxAllowedPaise) {
      setError(
        `Amount cannot exceed outstanding debt of ${formatPaise(maxAllowedPaise)}.`,
      );
      return;
    }

    setSubmitting(true);
    const idempotencyKey = crypto.randomUUID();

    try {
      await api.post(
        `/api/expenses/${expense.expenseId}/reimbursements`,
        {
          fromMemberId,
          amountPaise: enteredPaise,
          method,
          reference: reference.trim() || null,
          idempotencyKey,
        },
        { headers: { 'X-Idempotency-Key': idempotencyKey } },
      );

      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err?.message || 'Failed to record reimbursement.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!expense) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
            Record Reimbursement
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Record a confirmed repayment from a roommate to the merchant payer ({payerName}).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Context Banner */}
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-xs space-y-1">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              Expense: {expense.title}
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              Total purchase: {formatPaise(expense.amountPaise)} · Paid to shopkeeper by <strong className="text-slate-700 dark:text-slate-300">{payerName}</strong>
            </p>
          </div>

          {/* From Member Selector */}
          <div className="space-y-1">
            <Label htmlFor="reimb-from" className="text-xs font-semibold">
              From Member (Roommate repaying) *
            </Label>
            <select
              id="reimb-from"
              value={fromMemberId}
              onChange={(e) => handleMemberChange(e.target.value)}
              className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              required
            >
              {owingMembers.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.name} (Outstanding: {formatPaise(m.remainingOwedPaise)})
                </option>
              ))}
            </select>
          </div>

          {/* To Member (Read-only) */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-500">
              Repaying to (Original Payer)
            </Label>
            <div className="h-9 px-3 py-2 rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center">
              {payerName}
            </div>
          </div>

          {/* Amount & Method */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="reimb-amount" className="text-xs font-semibold">
                  Amount (₹) *
                </Label>
                <span className="text-[10px] text-teal-700 dark:text-teal-400">
                  Max: {formatPaise(maxAllowedPaise)}
                </span>
              </div>
              <Input
                id="reimb-amount"
                type="number"
                step="0.01"
                min="0.01"
                max={(maxAllowedPaise / 100).toFixed(2)}
                placeholder="0.00"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                className="text-xs h-9 bg-white dark:bg-slate-900"
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="reimb-method" className="text-xs font-semibold">
                Payment Method *
              </Label>
              <select
                id="reimb-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {/* Reference Input */}
          <div className="space-y-1">
            <Label htmlFor="reimb-ref" className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Transaction Reference / Note
            </Label>
            <Input
              id="reimb-ref"
              placeholder="e.g. UPI Ref / GPay note (Optional)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="text-xs h-8 bg-white dark:bg-slate-900"
              maxLength={100}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || enteredPaise <= 0 || enteredPaise > maxAllowedPaise}
              className="bg-teal-700 hover:bg-teal-800 text-white dark:bg-teal-600 dark:hover:bg-teal-700 text-xs"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Recording...
                </>
              ) : (
                'Record Reimbursement'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
