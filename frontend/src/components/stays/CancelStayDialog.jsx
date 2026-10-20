import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { buildStayCancellationPayload } from '../../lib/memberContracts.js';
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

export function CancelStayDialog({ open, onOpenChange, stay, onConfirm }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setError('');
    }
  }, [open]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError('Enter a clear reason for cancelling this incorrect Stay.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onConfirm(buildStayCancellationPayload({ reason, revision: stay.revision }));
      onOpenChange(false);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to cancel this Stay.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-600" />
            Cancel Hostel Stay?
          </DialogTitle>
          <DialogDescription className="text-xs">
            This is only allowed when no financial or clearance activity exists. The audit record is preserved.
          </DialogDescription>
        </DialogHeader>
        {stay && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-md bg-slate-50 p-3 text-xs dark:bg-slate-900">
              <div><strong>Member:</strong> {stay.memberId}</div>
              <div><strong>Joined:</strong> {stay.joinedOn}</div>
              <div><strong>Room:</strong> {stay.currentRoomId || stay.initialRoomId || '—'}</div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cancelStayReason">Reason</Label>
              <Input id="cancelStayReason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required />
            </div>
            {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={submitting || reason.trim().length < 3}>
                {submitting ? 'Cancelling…' : 'Confirm Cancellation'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
