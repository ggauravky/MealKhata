import { AlertCircle, CalendarDays, LogOut } from 'lucide-react';
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

export function CheckoutRequestDialog({
  open,
  onOpenChange,
  onSubmitRequest,
}) {
  const [leavingDate, setLeavingDate] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!leavingDate) {
      setError('Please select your preferred departure date.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await onSubmitRequest({
        checkoutRequestedFor: leavingDate,
        checkoutRequestNote: note.trim() || undefined,
      });
      setLeavingDate('');
      setNote('');
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Failed to submit departure request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <LogOut className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            Request Hostel Checkout
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Submit your intended leaving date to initiate the checkout and financial settlement review with the hostel admin.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-2.5 rounded-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 py-1">
          <div className="space-y-1">
            <Label htmlFor="checkoutDate" className="text-xs">
              Preferred Leaving Date (YYYY-MM-DD)
            </Label>
            <Input
              id="checkoutDate"
              type="date"
              value={leavingDate}
              onChange={(e) => setLeavingDate(e.target.value)}
              required
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="checkoutReason" className="text-xs">
              Reason / Note (Optional)
            </Label>
            <Input
              id="checkoutReason"
              placeholder="e.g. Completed college semester, relocating"
              value={note}
              onChange={(e) => setNote(e.target.value)}
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
              disabled={submitting || !leavingDate}
              className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
