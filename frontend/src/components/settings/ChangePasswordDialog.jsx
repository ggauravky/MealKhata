import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
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

/** Self-service password change for any signed-in role. Other devices are signed out. */
export function ChangePasswordDialog({ open, onOpenChange }) {
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setError('');
      setDone(false);
    }
  }, [open]);

  const setField = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (values.newPassword !== values.confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/api/auth/password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }, { preserveSessionOnUnauthorized: true });
      setDone(true);
    } catch (requestError) {
      setError(requestError?.message || 'Your password could not be changed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>You stay signed in here; every other device is signed out.</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-4">
            <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">Your password was changed.</p>
            <DialogFooter><Button onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="selfCurrentPassword">Current password</Label>
              <Input id="selfCurrentPassword" type="password" value={values.currentPassword} onChange={setField('currentPassword')} maxLength={256} required autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="selfNewPassword">New password</Label>
              <Input id="selfNewPassword" type="password" value={values.newPassword} onChange={setField('newPassword')} minLength={12} maxLength={256} required autoComplete="new-password" />
              <p className="text-[11px] text-slate-500">At least 12 characters with uppercase, lowercase, number, and symbol.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="selfConfirmPassword">Repeat new password</Label>
              <Input id="selfConfirmPassword" type="password" value={values.confirmPassword} onChange={setField('confirmPassword')} minLength={12} maxLength={256} required autoComplete="new-password" />
            </div>
            {error && <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Change password'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
