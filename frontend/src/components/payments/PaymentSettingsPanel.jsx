import { Settings2 } from 'lucide-react';
import { useState } from 'react';
import { usePaymentSettings } from '../../hooks/usePaymentSettings.js';
import { api } from '../../lib/api.js';
import { ErrorState } from '../ui/ErrorState.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';

function PaymentSettingsForm({ data, onSaved }) {
  const [form, setForm] = useState({
    receiverName: data?.receiverName ?? '',
    upiId: data?.upiId ?? '',
    receiverMobile: data?.receiverMobile ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateField = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!form.upiId.trim() && !form.receiverMobile.trim()) {
      setError('Enter either a UPI ID or an Indian mobile number.');
      return;
    }
    setSaving(true);
    try {
      const response = await api.put('/api/payment-settings', form);
      const resultMessage = response.changed ? 'Payment receiver settings saved.' : 'Receiver settings are already up to date.';
      onSaved(resultMessage);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
          <label><span>Receiver name</span><input name="receiverName" value={form.receiverName} onChange={updateField} maxLength={100} required /></label>
          <label><span>UPI ID (optional)</span><input name="upiId" value={form.upiId} onChange={updateField} maxLength={100} autoCapitalize="none" autoCorrect="off" /></label>
          <label><span>Mobile number</span><input name="receiverMobile" value={form.receiverMobile} onChange={updateField} inputMode="tel" autoComplete="tel" /></label>
          <button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save receiver'}</button>
      <p className="settings-form__hint">A verified UPI ID enables recipient prefill. With mobile only, MealKhata shows safe copy-and-pay instructions.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}

export function PaymentSettingsPanel() {
  const settings = usePaymentSettings(true);
  const [message, setMessage] = useState('');

  return (
    <details className="panel payment-settings">
      <summary><Settings2 size={18} aria-hidden="true" /> Payment receiver settings</summary>
      {settings.loading && !settings.data ? <LoadingState compact label="Loading receiver settings" /> : (
        <PaymentSettingsForm
          key={settings.data?.revision ?? 'missing'}
          data={settings.data}
          onSaved={(resultMessage) => {
            setMessage(resultMessage);
            settings.refresh();
          }}
        />
      )}
      {settings.error && <ErrorState compact title="Settings unavailable" message={settings.error} actionLabel="Try again" onAction={settings.refresh} />}
      <p className="save-feedback" role="status" aria-live="polite">{message}</p>
    </details>
  );
}
