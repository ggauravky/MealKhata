import { useEffect, useState } from 'react';
import { buildMemberAccountPayload } from '../../lib/memberContracts.js';
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

const ACTION_COPY = {
  provision: ['Provision login account', 'Create a canonical login without changing this member\'s financial identity.'],
  email: ['Change email', 'The member ID and all financial ownership remain unchanged. Existing sessions will be revoked.'],
  password: ['Reset password', 'The old password and all existing member sessions will stop working.'],
  activate: ['Enable login account', 'This restores login access but does not change the Hostel Stay.'],
  deactivate: ['Disable login account', 'This revokes login sessions but preserves the Stay and all financial history.'],
};

export function MemberAccountDialog({ open, onOpenChange, member, action, onSubmit }) {
  const [values, setValues] = useState({ email: '', newPassword: '', currentPassword: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [title, description] = ACTION_COPY[action] || ACTION_COPY.email;

  useEffect(() => {
    if (open) {
      setValues({ email: action === 'email' ? member?.account?.email || '' : '', newPassword: '', currentPassword: '' });
      setError('');
    }
  }, [action, member, open]);

  const setField = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }));
  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payloadAction = action === 'activate' || action === 'deactivate' ? 'status' : action;
      await onSubmit(buildMemberAccountPayload(payloadAction, values));
      onOpenChange(false);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to update this account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{member?.name}: {description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {(action === 'provision' || action === 'email') && (
            <div className="space-y-1.5">
              <Label htmlFor="memberAccountEmail">Email</Label>
              <Input id="memberAccountEmail" type="email" value={values.email} onChange={setField('email')} maxLength={254} required autoComplete="email" />
            </div>
          )}
          {(action === 'provision' || action === 'password') && (
            <div className="space-y-1.5">
              <Label htmlFor="memberNewPassword">New password</Label>
              <Input id="memberNewPassword" type="password" value={values.newPassword} onChange={setField('newPassword')} minLength={12} maxLength={256} required autoComplete="new-password" />
              <p className="text-[11px] text-slate-500">At least 12 characters with uppercase, lowercase, number, and symbol.</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="superAdminPassword">Your current Super Admin password</Label>
            <Input id="superAdminPassword" type="password" value={values.currentPassword} onChange={setField('currentPassword')} maxLength={256} required autoComplete="current-password" />
          </div>
          {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" variant={action === 'deactivate' ? 'destructive' : 'default'} disabled={submitting}>
              {submitting ? 'Savingâ€¦' : title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
