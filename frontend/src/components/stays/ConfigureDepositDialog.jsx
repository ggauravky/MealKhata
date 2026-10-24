import { Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { rupeesToPaise } from '../../lib/money.js';
import { Button } from '../ui/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog.jsx';
import { Input } from '../ui/input.jsx';
import { Label } from '../ui/label.jsx';

export function ConfigureDepositDialog({ open, onOpenChange, stay, onConfigured }) {
  const [required, setRequired] = useState(false);
  const [rupees, setRupees] = useState('0');
  const [expectedRevision, setExpectedRevision] = useState(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !stay) return;
    setLoading(true);
    setReason('');
    setError('');
    api.get(`/api/stays/${stay.stayId}/deposit`)
      .then((response) => {
        const account = response.data?.account;
        const isRequired = account?.status !== 'NOT_REQUIRED';
        setRequired(isRequired);
        setRupees(String((account?.expectedDepositPaise || 0) / 100));
        setExpectedRevision(account?.revision ?? 0);
      })
      .catch((requestError) => setError(requestError?.message || 'Unable to load deposit configuration.'))
      .finally(() => setLoading(false));
  }, [open, stay]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const expectedDepositPaise = required ? rupeesToPaise(rupees) : 0;
    if (required && (!expectedDepositPaise || expectedDepositPaise <= 0)) {
      setError('Enter the verified deposit amount in rupees.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.patch(`/api/stays/${stay.stayId}/deposit/configuration`, {
        required,
        expectedDepositPaise,
        expectedRevision,
        reason: reason.trim(),
      });
      onOpenChange(false);
      onConfigured?.();
    } catch (requestError) {
      setError(requestError?.message || 'Unable to update the deposit requirement.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-teal-600" /> Configure deposit requirement</DialogTitle>
          <DialogDescription>Super Admin only. This changes the requirement state and audit history. No deposit transaction will be created.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset className="space-y-2" disabled={loading}>
            <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">Requirement</legend>
            <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
              <input type="radio" name="depositRequired" checked={!required} onChange={() => setRequired(false)} className="mt-0.5" />
              <span><strong>Not required</strong><span className="block text-xs text-slate-500">Use only when no security deposit was expected.</span></span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
              <input type="radio" name="depositRequired" checked={required} onChange={() => setRequired(true)} className="mt-0.5" />
              <span><strong>Required</strong><span className="block text-xs text-slate-500">Track the verified expected amount.</span></span>
            </label>
          </fieldset>
          {required && (
            <div className="space-y-1.5">
              <Label htmlFor="depositExpectedAmount">Expected deposit (₹)</Label>
              <Input id="depositExpectedAmount" type="number" min="1" step="1" value={rupees} onChange={(event) => setRupees(event.target.value)} required />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="depositConfigReason">Audit reason</Label>
            <Input id="depositConfigReason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required />
          </div>
          {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading || expectedRevision === null || reason.trim().length < 3}>{loading ? 'Saving…' : 'Save requirement'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
