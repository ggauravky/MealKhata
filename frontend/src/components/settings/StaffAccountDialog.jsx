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

const COPY = {
  create: ['Add administrator', 'Admins manage daily meals, rooms, stays, payments and expenses. Only you can manage students and accounts.'],
  password: ['Reset administrator password', 'The old password and every open session for this admin stop working.'],
  activate: ['Enable administrator', 'This admin will be able to sign in again.'],
  deactivate: ['Disable administrator', 'This admin is signed out everywhere and cannot sign in. History is kept.'],
  settings: ['Change financial start date', 'Allowed only while no meals, payments, rooms, stays or expenses have been recorded.'],
};

/** One dialog for every Super Admin account/settings action; each requires the current password. */
export function StaffAccountDialog({ open, onOpenChange, action, account, settings, onSubmit }) {
  const [values, setValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [title, description] = COPY[action] || COPY.create;

  useEffect(() => {
    if (open) {
      setValues({ email: '', displayName: '', newPassword: '', currentPassword: '',
        financialStartDate: settings?.financialStartDate ?? '' });
      setError('');
    }
  }, [open, action, settings]);

  const setField = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (requestError) {
      setError(requestError?.message || 'The change could not be saved.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{account ? `${account.displayName}: ` : ''}{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {action === 'create' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="staffDisplayName">Name</Label>
                <Input id="staffDisplayName" value={values.displayName ?? ''} onChange={setField('displayName')} maxLength={100} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staffEmail">Email</Label>
                <Input id="staffEmail" type="email" value={values.email ?? ''} onChange={setField('email')} maxLength={254} required autoComplete="off" />
              </div>
            </>
          )}
          {(action === 'create' || action === 'password') && (
            <div className="space-y-1.5">
              <Label htmlFor="staffNewPassword">{action === 'create' ? 'Initial password' : 'New password'}</Label>
              <Input id="staffNewPassword" type="password" value={values.newPassword ?? ''} onChange={setField('newPassword')} minLength={12} maxLength={256} required autoComplete="new-password" />
              <p className="text-[11px] text-slate-500">At least 12 characters with uppercase, lowercase, number, and symbol. Share it with the admin privately.</p>
            </div>
          )}
          {action === 'settings' && (
            <div className="space-y-1.5">
              <Label htmlFor="financialStartDate">Financial start date</Label>
              <Input id="financialStartDate" type="date" value={values.financialStartDate ?? ''} onChange={setField('financialStartDate')} required />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="staffCurrentPassword">Your current password</Label>
            <Input id="staffCurrentPassword" type="password" value={values.currentPassword ?? ''} onChange={setField('currentPassword')} maxLength={256} required autoComplete="current-password" />
          </div>
          {error && <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting} variant={action === 'deactivate' ? 'destructive' : 'default'}>
              {submitting ? 'Saving…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
