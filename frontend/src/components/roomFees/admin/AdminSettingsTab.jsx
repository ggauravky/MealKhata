import { AlertCircle, CheckCircle2, Save, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.jsx';
import { Input } from '../../ui/input.jsx';
import { Label } from '../../ui/label.jsx';
import { Select } from '../../ui/select.jsx';
import { api } from '../../../lib/api.js';

export function AdminSettingsTab({ settings, onRefresh, loading = false, error = '' }) {
  const [recipientMode, setRecipientMode] = useState(settings?.recipientMode || 'hostel_owner');
  const [recipientName, setRecipientName] = useState(settings?.recipientName || 'Hostel Owner');
  const [upiId, setUpiId] = useState(settings?.upiId || '');
  const [paymentInstructions, setPaymentInstructions] = useState(settings?.paymentInstructions || '');
  const [defaultDueDay, setDefaultDueDay] = useState(String(settings?.defaultDueDay || 5));
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (settings) {
      setRecipientMode(settings.recipientMode || 'hostel_owner');
      setRecipientName(settings.recipientName || 'Hostel Owner');
      setUpiId(settings.upiId || '');
      setPaymentInstructions(settings.paymentInstructions || '');
      setDefaultDueDay(String(settings.defaultDueDay || 5));
    }
  }, [settings]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaveError('');
    setSaveSuccess('');
    setSaving(true);
    try {
      const payload = {
        recipientMode,
        recipientName: recipientName.trim(),
        upiId: upiId.trim() ? upiId.trim() : null,
        paymentInstructions: paymentInstructions.trim() ? paymentInstructions.trim() : null,
        defaultDueDay: Number(defaultDueDay) || 5,
      };
      await api.put('/api/room-fees/settings', payload);
      setSaveSuccess('Room fee payment instructions and recipient settings saved successfully.');
      onRefresh();
    } catch (err) {
      setSaveError(err.message || 'Failed to update settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-slate-200 dark:border-slate-800 p-8 text-center max-w-2xl">
        <p className="text-xs text-slate-500 dark:text-slate-400">Loading payment recipient settings...</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20 p-6 text-center max-w-2xl">
        <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</p>
        {onRefresh && (
          <Button onClick={onRefresh} size="sm" variant="outline" className="mt-3 text-xs">
            Retry
          </Button>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
          Room Fee Payment Recipient & Defaults
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Configure who receives monthly room payments and the payment instructions displayed to residents.
        </p>
      </div>

      {saveSuccess && (
        <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-teal-600 shrink-0" />
          <span>{saveSuccess}</span>
        </div>
      )}

      {saveError && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs">
        <CardContent className="p-5">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="recipientModeSelect">Recipient Mode *</Label>
              <Select
                id="recipientModeSelect"
                value={recipientMode}
                onChange={(e) => {
                  const mode = e.target.value;
                  setRecipientMode(mode);
                  if (mode === 'hostel_owner' && recipientName === 'Admin Collector') {
                    setRecipientName('Hostel Owner');
                  } else if (mode === 'admin_collector' && recipientName === 'Hostel Owner') {
                    setRecipientName('Admin Collector');
                  }
                }}
              >
                <option value="hostel_owner">Pay Hostel Owner Directly</option>
                <option value="admin_collector">Pay Admin Collector</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recipientNameInput">Recipient Display Name *</Label>
              <Input
                id="recipientNameInput"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="e.g. Ramesh Chandra (Landlord) or Gaurav (Collector)"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="upiIdInput">Official UPI ID (optional)</Label>
              <Input
                id="upiIdInput"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="e.g. landlord@okhdfcbank or 9876543210@upi"
              />
              <span className="text-[11px] text-slate-400 block">
                Residents will see a direct UPI payment launch link if a valid UPI ID is configured. Leave empty to clear.
              </span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="defaultDueDaySelect">Default Due Day of Month *</Label>
              <Select
                id="defaultDueDaySelect"
                value={defaultDueDay}
                onChange={(e) => setDefaultDueDay(e.target.value)}
              >
                <option value="1">1st of month</option>
                <option value="5">5th of month (Standard)</option>
                <option value="7">7th of month</option>
                <option value="10">10th of month</option>
                <option value="15">15th of month</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="instructionsInput">Payment Instructions / Bank Details</Label>
              <textarea
                id="instructionsInput"
                rows={3}
                className="w-full rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-900 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                value={paymentInstructions}
                onChange={(e) => setPaymentInstructions(e.target.value)}
                placeholder="e.g. Please transfer via UPI or bank transfer. Mention your Room Number in the transfer notes."
              />
            </div>

            <div className="pt-2 flex justify-end">
              <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
                <Save className="h-4 w-4" />
                <span>{saving ? 'Saving...' : 'Save Settings'}</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
