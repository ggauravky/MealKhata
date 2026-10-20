import { AlertCircle, Check, Loader2, Plus, Sparkles } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
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

function getTodayKolkata() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

export function AddExpenseDialog({ open, onOpenChange, onSuccess, initialPayerId = 'gaurav' }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('groceries');
  const [date, setDate] = useState(getTodayKolkata());
  const [amountRupees, setAmountRupees] = useState('');
  const [paidByMemberId, setPaidByMemberId] = useState(initialPayerId);
  const [splitType, setSplitType] = useState('equal');
  const [selectedParticipants, setSelectedParticipants] = useState(ROOMMATES.map((m) => m.id));
  const [personalBeneficiary, setPersonalBeneficiary] = useState('gaurav');
  const [customAmounts, setCustomAmounts] = useState({
    gaurav: '',
    nikhil: '',
    devansh: '',
  });
  const [description, setDescription] = useState('');

  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setTitle('');
      setCategory('groceries');
      setDate(getTodayKolkata());
      setAmountRupees('');
      setPaidByMemberId(initialPayerId || 'gaurav');
      setSplitType('equal');
      setSelectedParticipants(ROOMMATES.map((m) => m.id));
      setPersonalBeneficiary(initialPayerId || 'gaurav');
      setCustomAmounts({ gaurav: '', nikhil: '', devansh: '' });
      setDescription('');
      setPreview(null);
      setPreviewError('');
      setSubmitError('');
    }
  }, [open, initialPayerId]);

  // Compute total paise from amount input
  const totalAmountPaise = paymentRupeesToPaise(amountRupees) || 0;

  // Custom split sum validation
  let customSumPaise = 0;
  if (splitType === 'custom') {
    for (const m of ROOMMATES) {
      const p = paymentRupeesToPaise(customAmounts[m.id]) || 0;
      customSumPaise += p;
    }
  }

  // Trigger live split preview when inputs change
  useEffect(() => {
    if (totalAmountPaise <= 0) {
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

      if (customSumPaise !== totalAmountPaise) {
        const diff = Math.abs(totalAmountPaise - customSumPaise);
        setPreview(null);
        if (customSumPaise < totalAmountPaise) {
          setPreviewError(`Allocated amounts must total ${formatPaise(totalAmountPaise)}. ${formatPaise(diff)} remains unallocated.`);
        } else {
          setPreviewError(`Allocated amounts total ${formatPaise(customSumPaise)}, exceeding total by ${formatPaise(diff)}.`);
        }
        return undefined;
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
        setPreviewError('');
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setPreview(null);
          setPreviewError(err?.message || 'Unable to calculate split.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPreviewLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    totalAmountPaise,
    paidByMemberId,
    splitType,
    selectedParticipants,
    personalBeneficiary,
    customAmounts,
    customSumPaise,
  ]);

  const toggleParticipant = (memberId) => {
    setSelectedParticipants((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId],
    );
  };

  const handleCustomAmountChange = (memberId, val) => {
    setCustomAmounts((prev) => ({ ...prev, [memberId]: val }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    if (!title.trim()) {
      setSubmitError('What was purchased? Title is required.');
      return;
    }

    if (totalAmountPaise <= 0) {
      setSubmitError('Please enter a valid expense amount.');
      return;
    }

    if (splitType === 'equal' && selectedParticipants.length === 0) {
      setSubmitError('Select at least one member to share.');
      return;
    }

    if (splitType === 'custom' && customSumPaise !== totalAmountPaise) {
      setSubmitError(previewError || 'Custom allocations must equal total amount.');
      return;
    }

    setSubmitting(true);
    const idempotencyKey = crypto.randomUUID();

    const payload = {
      date,
      title: title.trim(),
      category,
      description: description.trim(),
      amountPaise: totalAmountPaise,
      paidByMemberId,
      splitType,
      idempotencyKey,
    };

    if (splitType === 'equal') {
      payload.participants = selectedParticipants;
    } else if (splitType === 'personal') {
      payload.participants = [personalBeneficiary];
    } else if (splitType === 'custom') {
      payload.customAllocations = ROOMMATES.map((m) => ({
        memberId: m.id,
        amountPaise: paymentRupeesToPaise(customAmounts[m.id]) || 0,
      })).filter((a) => a.amountPaise > 0);
    }

    try {
      await api.post('/api/expenses', payload, {
        headers: { 'X-Idempotency-Key': idempotencyKey },
      });
      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (err) {
      setSubmitError(err?.message || 'Failed to record expense. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
            Record Shared Expense
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Record groceries, snacks, outside food or household supplies. Mess and Room fees remain untouched.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {submitError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1">
            <Label htmlFor="expense-title" className="text-xs font-semibold">
              What was purchased? *
            </Label>
            <Input
              id="expense-title"
              placeholder="e.g. Evening Samosas, Milk & Eggs"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-xs h-9 bg-white dark:bg-slate-900"
              required
            />
          </div>

          {/* Category & Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="expense-category" className="text-xs font-semibold">
                Category *
              </Label>
              <select
                id="expense-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              >
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {EXPENSE_CATEGORY_CONFIG[cat]?.label || cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="expense-date" className="text-xs font-semibold">
                Purchase Date *
              </Label>
              <Input
                id="expense-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="text-xs h-9 bg-white dark:bg-slate-900"
                required
              />
            </div>
          </div>

          {/* Total Amount & Paid By */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="expense-amount" className="text-xs font-semibold">
                Total Amount (₹) *
              </Label>
              <Input
                id="expense-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                className="text-xs h-9 bg-white dark:bg-slate-900"
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="expense-payer" className="text-xs font-semibold">
                Who paid merchant? *
              </Label>
              <select
                id="expense-payer"
                value={paidByMemberId}
                onChange={(e) => setPaidByMemberId(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              >
                {ROOMMATES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Split Method Tabs */}
          <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
            <Label className="text-xs font-semibold">Split Method</Label>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg text-xs">
              {[
                { id: 'equal', label: 'Equal Split' },
                { id: 'personal', label: 'Personal' },
                { id: 'custom', label: 'Custom' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSplitType(tab.id)}
                  className={[
                    'py-1.5 font-medium rounded-md transition-all cursor-pointer text-center',
                    splitType === tab.id
                      ? 'bg-white text-slate-900 shadow-xs font-semibold dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200',
                  ].join(' ')}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Split Configurations */}
          {splitType === 'equal' && (
            <div className="space-y-1.5">
              <Label className="text-[11px] text-slate-500 dark:text-slate-400">
                Share equally between:
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {ROOMMATES.map((m) => {
                  const isChecked = selectedParticipants.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleParticipant(m.id)}
                      className={[
                        'flex items-center justify-between p-2 rounded-lg border text-xs font-medium cursor-pointer transition-all',
                        isChecked
                          ? 'border-teal-600 bg-teal-50/50 text-teal-800 dark:bg-teal-950/40 dark:border-teal-700 dark:text-teal-300'
                          : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
                      ].join(' ')}
                    >
                      <span>{m.name}</span>
                      {isChecked && <Check className="h-3.5 w-3.5 text-teal-600" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {splitType === 'personal' && (
            <div className="space-y-1">
              <Label htmlFor="personal-beneficiary" className="text-[11px] text-slate-500 dark:text-slate-400">
                Purchased entirely for:
              </Label>
              <select
                id="personal-beneficiary"
                value={personalBeneficiary}
                onChange={(e) => setPersonalBeneficiary(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              >
                {ROOMMATES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.id === paidByMemberId ? '(Paid for self)' : `(Owes ${ROOMMATES.find((r) => r.id === paidByMemberId)?.name})`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {splitType === 'custom' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 dark:text-slate-400">Enter custom member shares:</span>
                <span className={customSumPaise === totalAmountPaise ? 'text-teal-700 font-semibold' : 'text-amber-600 font-semibold'}>
                  Total: {formatPaise(customSumPaise)} / {formatPaise(totalAmountPaise)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {ROOMMATES.map((m) => (
                  <div key={m.id} className="space-y-1">
                    <Label htmlFor={`custom-${m.id}`} className="text-[10px] text-slate-600 dark:text-slate-400">
                      {m.name}
                    </Label>
                    <Input
                      id={`custom-${m.id}`}
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={customAmounts[m.id]}
                      onChange={(e) => handleCustomAmountChange(m.id, e.target.value)}
                      className="text-xs h-8 bg-white dark:bg-slate-900"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Optional Note */}
          <div className="space-y-1">
            <Label htmlFor="expense-desc" className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Optional Note
            </Label>
            <Input
              id="expense-desc"
              placeholder="e.g. For Sunday evening get-together"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-xs h-8 bg-white dark:bg-slate-900"
              maxLength={300}
            />
          </div>

          {/* Realtime Preview Card */}
          {previewLoading && (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Calculating split...</span>
            </div>
          )}

          {previewError && !previewLoading && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300">
              {previewError}
            </div>
          )}

          {preview && !previewLoading && (
            <ExpenseSplitPreview
              preview={preview}
              paidByMemberId={paidByMemberId}
            />
          )}

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
              disabled={submitting || !preview || Boolean(previewError)}
              className="bg-teal-700 hover:bg-teal-800 text-white dark:bg-teal-600 dark:hover:bg-teal-700 text-xs"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Recording...
                </>
              ) : (
                'Record Expense'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
