import { AlertCircle, RotateCcw, Tag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatLogicalDate } from '../../lib/logicalDate.js';
import { formatPaise, paiseToRupeeInput, rupeesToPaise } from '../../lib/money.js';
import { Button } from '../ui/button.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.jsx';

export function MealPriceDialog({
  open,
  onOpenChange,
  date,
  mealType,
  pricing,
  onSavePrice,
  onResetPrice,
}) {
  const isMorning = mealType === 'morning';
  const mealTitle = isMorning ? 'Morning' : 'Night';
  const defaultPricePaise = pricing?.defaultPricePaise ?? (isMorning ? 5000 : 7000);
  const isOverridden = Boolean(pricing?.isOverridden);

  const [priceInput, setPriceInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  useEffect(() => {
    if (open) {
      if (isOverridden && pricing?.overridePricePaise !== undefined) {
        setPriceInput(paiseToRupeeInput(pricing.overridePricePaise));
        setReasonInput(pricing.reason ?? '');
      } else {
        setPriceInput(paiseToRupeeInput(defaultPricePaise));
        setReasonInput('');
      }
      setError('');
    }
  }, [open, isOverridden, pricing, defaultPricePaise]);

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!isOnline) {
      setError('Connect to the internet to adjust meal price.');
      return;
    }

    const pricePaise = rupeesToPaise(priceInput);
    if (pricePaise === null || pricePaise < 0) {
      setError('Enter a valid non-negative price in rupees (e.g. 40 or 42.50).');
      return;
    }

    const trimmedReason = reasonInput.trim();
    if (trimmedReason.length > 200) {
      setError('Reason must be at most 200 characters.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await onSavePrice({
        date,
        mealType,
        pricePaise,
        reason: trimmedReason || null,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Failed to update meal price.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async () => {
    if (!isOnline) {
      setError('Connect to the internet to adjust meal price.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await onResetPrice({
        date,
        mealType,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Failed to reset meal price.');
    } finally {
      setSubmitting(false);
    }
  };

  const formattedDate = date
    ? formatLogicalDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden="true" />
            <DialogTitle>Adjust {mealTitle} Price</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            {formattedDate}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 py-1">
          {/* Status and default price preview */}
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3 border border-slate-200/80 dark:border-slate-800 text-xs space-y-1.5">
            <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
              <span>Standard price:</span>
              <span className="font-semibold text-slate-900 dark:text-slate-200">
                {formatPaise(defaultPricePaise)} / plate
              </span>
            </div>
            {isOverridden && (
              <div className="flex justify-between items-center text-amber-700 dark:text-amber-400 font-medium">
                <span>Current price:</span>
                <span>{formatPaise(pricing.effectivePricePaise)} / plate (Adjusted)</span>
              </div>
            )}
          </div>

          {!isOnline && (
            <div
              className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-md border border-amber-200 dark:border-amber-800"
              role="alert"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Connect to the internet to adjust meal price.</span>
            </div>
          )}

          {error && (
            <div
              className="flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-md border border-rose-200 dark:border-rose-800"
              role="alert"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor="price-per-plate-input"
              className="text-xs font-semibold text-slate-800 dark:text-slate-200 block"
            >
              Price per physical plate (₹)
            </label>
            <div className="relative">
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 dark:text-slate-500 font-medium select-none"
                aria-hidden="true"
              >
                ₹
              </span>
              <input
                id="price-per-plate-input"
                type="text"
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => {
                  setPriceInput(e.target.value);
                  setError('');
                }}
                disabled={submitting || !isOnline}
                placeholder="40"
                className="flex h-9 w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 pl-7 pr-3 py-1 text-sm font-medium shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-50 text-slate-900 dark:text-slate-100"
                autoComplete="off"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label
                htmlFor="price-override-reason"
                className="text-xs font-semibold text-slate-800 dark:text-slate-200 block"
              >
                Reason (optional)
              </label>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {reasonInput.length}/200
              </span>
            </div>
            <input
              id="price-override-reason"
              type="text"
              value={reasonInput}
              onChange={(e) => {
                setReasonInput(e.target.value);
                setError('');
              }}
              disabled={submitting || !isOnline}
              placeholder="e.g. Missing sabzi, special reduced rate"
              maxLength={200}
              className="flex h-9 w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-50 text-slate-900 dark:text-slate-100"
              autoComplete="off"
            />
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
            This price applies only to this meal on this date.
          </p>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-2 pt-2">
            {isOverridden ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={submitting || !isOnline}
                className="w-full sm:w-auto text-xs text-rose-700 dark:text-rose-400 hover:text-rose-800 border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/30 gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset to {formatPaise(defaultPricePaise)}</span>
              </Button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                className="w-full sm:w-auto text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting || !isOnline}
                className="w-full sm:w-auto text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white"
              >
                {submitting ? 'Saving...' : 'Save price'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
