import { useEffect, useState } from 'react';
import { buildStudentLifecyclePayload, getStudentErrorMessage } from '../../lib/studentContracts.js';
import { Button } from '../ui/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog.jsx';
import { Input } from '../ui/input.jsx';
import { Label } from '../ui/label.jsx';

export function StudentLifecycleDialog({ open, onOpenChange, student, action, onSubmit }) {
  const archive = action === 'archive';
  const [values, setValues] = useState({ reason: '', disableAccount: false });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValues({ reason: '', disableAccount: false });
      setError('');
    }
  }, [open, student]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(buildStudentLifecyclePayload(student, values, { archive }));
      onOpenChange(false);
    } catch (requestError) {
      setError(getStudentErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };
  const title = archive ? 'Archive student' : 'Reactivate student';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{archive ? 'Archiving removes this identity from the active roster but keeps every historical reference.' : 'Reactivation returns this identity to the active roster without enabling login or creating a Hostel Stay.'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="studentLifecycleReason">Reason</Label>
            <Input id="studentLifecycleReason" value={values.reason} onChange={(event) => setValues((current) => ({ ...current, reason: event.target.value }))} maxLength={300} required />
          </div>
          {archive && student?.account?.exists && (
            <label className="flex items-start gap-3 rounded-md border border-slate-200 p-3 text-xs dark:border-slate-800">
              <input type="checkbox" checked={values.disableAccount} onChange={(event) => setValues((current) => ({ ...current, disableAccount: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-teal-600" />
              <span><strong className="block text-slate-900 dark:text-slate-100">Disable login and revoke sessions</strong>Leave unchecked to keep account access independent from roster status.</span>
            </label>
          )}
          {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" variant={archive ? 'destructive' : 'default'} disabled={submitting}>{submitting ? 'Saving...' : title}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
