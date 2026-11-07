import { AlertCircle, ArrowDownLeft, ArrowUpRight, ShieldCheck, Wallet } from 'lucide-react';
import { useState } from 'react';
import { formatPaise, rupeesToPaise } from '../../lib/money.js';
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
import { Select } from '../ui/select.jsx';

export function DepositTransactionDialog({
  open,
  onOpenChange,
  stayId,
  type = 'RECEIVED',
  depositHeldPaise = 0,
  onSubmitTransaction,
}) {
  const [rupees, setRupees] = useState('');
  const [method, setMethod] = useState('upi');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isDeduction = type === 'DEDUCTED';
  const isRefund = type === 'REFUNDED';
  const isReceipt = type === 'RECEIVED';

  const title = isReceipt
    ? 'Record Deposit Receipt'
    : isRefund
    ? 'Record Deposit Refund'
    : 'Record Deposit Deduction';

  const description = isReceipt
    ? 'Record security deposit funds received from the resident.'
    : isRefund
    ? 'Record refund of security deposit returned to the resident.'
    : 'Record approved damage or repair deduction retained from the security deposit.';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const amountPaise = rupeesToPaise(rupees);
    if (!amountPaise || amountPaise <= 0) {
      setError('Please enter a valid amount greater than zero.');
      return;
    }

    if ((isRefund || isDeduction) && amountPaise > depositHeldPaise) {
      setError(
        `Amount cannot exceed currently held deposit of ${formatPaise(depositHeldPaise)}.`
      );
      return;
    }

    if (isDeduction && !reason.trim()) {
      setError('Please provide an approved reason for the deduction (e.g. Room damage repair).');
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      await onSubmitTransaction(stayId, {
        type,
        amountPaise,
        method,
        reference: reference.trim() || undefined,
        reason: reason.trim() || undefined,
        idempotencyKey,
      });

      // Reset and close
      setRupees('');
      setReference('');
      setReason('');
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Failed to record deposit transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
            {isReceipt ? (
              <ArrowDownLeft className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            ) : isRefund ? (
              <ArrowUpRight className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            ) : (
              <Wallet className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            )}
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            {description}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-2.5 rounded-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {(isRefund || isDeduction) && (
          <div className="p-2.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs flex justify-between items-center text-slate-700 dark:text-slate-300">
            <span>Available Held Balance:</span>
            <span className="font-bold">{formatPaise(depositHeldPaise)}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 py-1">
          <div className="space-y-1">
            <Label htmlFor="depAmount" className="text-xs">
              Amount (₹)
            </Label>
            <Input
              id="depAmount"
              type="number"
              step="any"
              placeholder="e.g. 5000"
              value={rupees}
              onChange={(e) => setRupees(e.target.value)}
              required
              className="text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="depMethod" className="text-xs">
                Payment Method
              </Label>
              <select
                id="depMethod"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-500"
              >
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="depRef" className="text-xs">
                Reference / UTR (Optional)
              </Label>
              <Input
                id="depRef"
                placeholder="e.g. UPI Ref / Receipt #"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="text-xs font-mono"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="depReason" className="text-xs">
              {isDeduction ? 'Deduction Reason (Mandatory)' : 'Reason / Note (Optional)'}
            </Label>
            <Input
              id="depReason"
              placeholder={
                isDeduction
                  ? 'e.g. Room 204 door lock damage repair'
                  : isRefund
                  ? 'e.g. Deposit refunded on departure'
                  : 'e.g. Initial security deposit'
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required={isDeduction}
              className="text-xs"
            />
          </div>

          <DialogFooter className="pt-2 gap-2 sm:gap-0">
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
              disabled={submitting}
              className="text-xs bg-teal-600 hover:bg-teal-700 text-white"
            >
              {submitting ? 'Recording...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
