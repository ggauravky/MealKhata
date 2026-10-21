import { AlertCircle, AlertTriangle, Check, Loader2, Save, Sparkles } from 'lucide-react';
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
import { ExpenseSplitPreview } from './ExpenseSplitPreview.jsx';
import { api } from '../../lib/api.js';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_CONFIG,
  ROOMMATES,
  SPLIT_TYPES,
} from '../../lib/constants.js';
import { formatPaise, paymentRupeesToPaise } from '../../lib/money.js';
import { buildExpenseEditInitialValues } from '../../lib/expenseEditorState.js';

export function EditExpenseDialog({
  open,
  onOpenChange,
  expense,
  onSuccess,
  onViewReimbursements,
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('groceries');
  const [date, setDate] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [paidByMemberId, setPaidByMemberId] = useState('gaurav');
  const [splitType, setSplitType] = useState('equal');
  const [selectedParticipants, setSelectedParticipants] = useState(ROOMMATES.map((m) => m.id));
  const [personalBeneficiary, setPersonalBeneficiary] = useState('gaurav');
  const [customAmounts, setCustomAmounts] = useState({
    gaurav: '',
    nikhil: '',
    devansh: '',
  });
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');

  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const activeReimbursements = (expense?.reimbursements || []).filter((r) => r.status !== 'voided');
  const hasReimbursements = activeReimbursements.length > 0;

  // Initialize form with current expense values
  useEffect(() => {
    if (open && expense) {
      const initialAmounts = buildExpenseEditInitialValues(expense);
      setTitle(expense.title || '');
      setCategory(expense.category || 'groceries');
      setDate(expense.date || '');
      setAmountRupees(initialAmounts.amountRupees);
      setPaidByMemberId(expense.paidByMemberId || 'gaurav');
      setSplitType(expense.splitType || 'equal');

      const allocMembers = (expense.allocations || []).map((a) => a.memberId);
      setSelectedParticipants(allocMembers.length > 0 ? allocMembers : ROOMMATES.map((m) => m.id));

      if (expense.splitType === 'personal' && allocMembers.length === 1) {
        setPersonalBeneficiary(allocMembers[0]);
      } else {
        setPersonalBeneficiary(expense.paidByMemberId || 'gaurav');
      }

      setCustomAmounts(initialAmounts.customAmounts);
      setDescription(expense.description || '');
      setReason('');
      setPreview(null);
      setPreviewError('');
      setSubmitError('');
    }
  }, [open, expense]);

  const totalAmountPaise = paymentRupeesToPaise(amountRupees) || 0;

  // Live split preview recomputation
  useEffect(() => {
    if (!open || totalAmountPaise <= 0 || hasReimbursements) {
      setPreview(null);
      setPreviewError('');
      return undefined;
    }

    let payload = null;
    if (splitType === 'equal') {
      if (selectedParticipants.length === 0) {
        setPreview(null);
        setPreviewError('Select at least one member to share the expense.');
        return undefined;
      }
      payload = {
        amountPaise: totalAmountPaise,
        paidByMemberId,
        splitType: 'equal',
        participants: selectedParticipants,
      };
    } else if (splitType === 'personal') {
      payload = {
        amountPaise: totalAmountPaise,
        paidByMemberId,
        splitType: 'personal',
        participants: [personalBeneficiary],
      };
    } else if (splitType === 'custom') {
      const customAllocations = [];
      for (const m of ROOMMATES) {
        const p = paymentRupeesToPaise(customAmounts[m.id]) || 0;
        if (p > 0) {
          customAllocations.push({ memberId: m.id, amountPaise: p });
        }
      }
      payload = {
        amountPaise: totalAmountPaise,
        paidByMemberId,
        splitType: 'custom',
        customAllocations,
      };
    }

    if (!payload) return undefined;

    const controller = new AbortController();
    setPreviewLoading(true);
    setPreviewError('');

    api.post('/api/expenses/preview', payload, { signal: controller.signal })
      .then((res) => {
        setPreview(res.data);
        setPreviewLoading(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setPreview(null);
          setPreviewError(err?.message || 'Invalid split allocation.');
          setPreviewLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    open,
    totalAmountPaise,
    paidByMemberId,
    splitType,
    selectedParticipants,
    personalBeneficiary,
    customAmounts,
    hasReimbursements,
  ]);

  const handleToggleParticipant = (memberId) => {
    if (hasReimbursements) return;
    setSelectedParticipants((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId],
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!expense) return;
    setSubmitError('');

    if (!reason.trim()) {
      setSubmitError('A mandatory correction reason is required (up to 300 characters).');
      return;
    }

    setSubmitting(true);
    try {
      const changes = {
        title: title.trim(),
        category,
        description: description.trim(),
      };

      if (!hasReimbursements) {
        changes.date = date;
        changes.amountPaise = totalAmountPaise;
        changes.paidByMemberId = paidByMemberId;
        changes.splitType = splitType;

        if (splitType === 'equal') {
          changes.participants = selectedParticipants;
        } else if (splitType === 'personal') {
          changes.participants = [personalBeneficiary];
        } else if (splitType === 'custom') {
          const customAllocations = [];
          for (const m of ROOMMATES) {
            const p = paymentRupeesToPaise(customAmounts[m.id]) || 0;
            if (p > 0) {
              customAllocations.push({ memberId: m.id, amountPaise: p });
            }
          }
          changes.customAllocations = customAllocations;
        }
      }

      const res = await api.post(`/api/expenses/${expense.expenseId}/corrections`, {
        reason: reason.trim(),
        changes,
        expectedRevision: expense.revision,
      });

      onOpenChange(false);
      if (onSuccess) onSuccess(res.data);
    } catch (err) {
      setSubmitError(err?.message || 'Failed to correct expense.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!expense) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>Edit Expense (Super Admin)</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Corrections are immutably audited. Prior snapshots remain preserved in history.
          </DialogDescription>
        </DialogHeader>

        {hasReimbursements && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>Active Reimbursements Recorded</span>
            </div>
            <p>
              This expense has {activeReimbursements.length} recorded reimbursement(s). Financial amounts, payer, date, and split allocations cannot be altered until existing reimbursements are reconciled.
            </p>
            {onViewReimbursements && (
              <button
                type="button"
                onClick={onViewReimbursements}
                className="mt-1 font-semibold text-teal-800 underline hover:text-teal-900"
              >
                View Reimbursements
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {submitError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1">
            <Label htmlFor="edit-exp-title" className="text-xs font-semibold">
              Title *
            </Label>
            <Input
              id="edit-exp-title"
              placeholder="e.g. Evening Samosas & Tea"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-xs h-9"
              required
              maxLength={120}
            />
          </div>

          {/* Category & Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-exp-category" className="text-xs font-semibold">
                Category *
              </Label>
              <select
                id="edit-exp-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              >
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {EXPENSE_CATEGORY_CONFIG[cat]?.label || cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-exp-date" className="text-xs font-semibold">
                Date *
              </Label>
              <Input
                id="edit-exp-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={hasReimbursements}
                className="text-xs h-9"
                required
              />
            </div>
          </div>

          {/* Amount & Paid By */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-exp-amount" className="text-xs font-semibold">
                Amount (₹) *
              </Label>
              <Input
                id="edit-exp-amount"
                type="number"
                min="1"
                step="any"
                placeholder="0"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                disabled={hasReimbursements}
                className="text-xs h-9 font-semibold"
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-exp-payer" className="text-xs font-semibold">
                Paid by *
              </Label>
              <select
                id="edit-exp-payer"
                value={paidByMemberId}
                onChange={(e) => setPaidByMemberId(e.target.value)}
                disabled={hasReimbursements}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              >
                {ROOMMATES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Split Mode (Locked if reimbursements exist) */}
          {!hasReimbursements ? (
            <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
              <Label className="text-xs font-semibold">Split Method *</Label>
              <div className="grid grid-cols-3 gap-2">
                {Object.values(SPLIT_TYPES).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSplitType(type)}
                    className={[
                      'py-2 px-3 rounded-lg border text-xs font-medium text-center transition-all cursor-pointer',
                      splitType === type
                        ? 'bg-teal-50 border-teal-600 text-teal-900 dark:bg-teal-950/60 dark:border-teal-500 dark:text-teal-200 shadow-xs'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
                    ].join(' ')}
                  >
                    {type === 'equal' ? 'Equal' : type === 'personal' ? 'Personal' : 'Custom'}
                  </button>
                ))}
              </div>

              {/* Equal split participants */}
              {splitType === 'equal' && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Shared equally among:
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {ROOMMATES.map((m) => {
                      const isSelected = selectedParticipants.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleToggleParticipant(m.id)}
                          className={[
                            'py-2 px-3 rounded-lg border text-xs flex items-center justify-between cursor-pointer transition-all',
                            isSelected
                              ? 'bg-teal-50 border-teal-600 text-teal-900 dark:bg-teal-950/60 dark:border-teal-500 dark:text-teal-200 font-semibold'
                              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
                          ].join(' ')}
                        >
                          <span>{m.name}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Personal split beneficiary */}
              {splitType === 'personal' && (
                <div className="space-y-1 pt-1">
                  <Label htmlFor="edit-exp-beneficiary" className="text-xs font-semibold">
                    Sole Beneficiary
                  </Label>
                  <select
                    id="edit-exp-beneficiary"
                    value={personalBeneficiary}
                    onChange={(e) => setPersonalBeneficiary(e.target.value)}
                    className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {ROOMMATES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Custom split amounts */}
              {splitType === 'custom' && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Individual amounts (must sum to total):
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {ROOMMATES.map((m) => (
                      <div key={m.id} className="space-y-1">
                        <Label htmlFor={`edit-custom-${m.id}`} className="text-[11px]">
                          {m.name}
                        </Label>
                        <Input
                          id={`edit-custom-${m.id}`}
                          type="number"
                          placeholder="0"
                          value={customAmounts[m.id]}
                          onChange={(e) =>
                            setCustomAmounts((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview Box */}
              {previewLoading && (
                <div className="py-2 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Computing split preview...</span>
                </div>
              )}
              {previewError && (
                <p className="text-xs text-rose-600 dark:text-rose-400">{previewError}</p>
              )}
              {preview && !previewLoading && (
                <ExpenseSplitPreview
                  preview={preview}
                  paidByMemberId={paidByMemberId}
                />
              )}
            </div>
          ) : (
            <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1 border border-slate-200 dark:bg-slate-900/40 dark:border-slate-800">
              <span className="text-slate-500 font-medium">Current Allocations:</span>
              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                {(expense.allocations || []).map((a) => (
                  <span key={a.memberId} className="px-2 py-0.5 bg-white dark:bg-slate-800 border rounded text-[11px] font-mono">
                    {ROOMMATES.find((m) => m.id === a.memberId)?.name || a.memberId}: {formatPaise(a.amountPaise)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1 pt-1">
            <Label htmlFor="edit-exp-desc" className="text-xs font-semibold">
              Note (optional)
            </Label>
            <Input
              id="edit-exp-desc"
              placeholder="e.g. Bought for evening group study session"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-xs h-9"
              maxLength={500}
            />
          </div>

          {/* Mandatory Correction Reason */}
          <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Label htmlFor="edit-exp-reason" className="text-xs font-semibold text-teal-800 dark:text-teal-300">
              Reason for Correction *
            </Label>
            <Input
              id="edit-exp-reason"
              placeholder="e.g. Original amount entered incorrectly, Payer mistakenly swapped"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-xs h-9"
              required
              maxLength={300}
            />
            <span className="text-[10px] text-slate-400 block">
              Required for immutable financial accountability audit log.
            </span>
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
              disabled={submitting || !reason.trim() || previewError}
              className="bg-teal-700 hover:bg-teal-800 text-white text-xs gap-1.5"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
