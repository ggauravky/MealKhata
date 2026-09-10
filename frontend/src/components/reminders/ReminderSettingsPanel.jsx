import { AlarmClock } from 'lucide-react';
import { useState } from 'react';
import { useReminders } from '../../hooks/useReminders.js';
import { api } from '../../lib/api.js';
import { ErrorState } from '../ui/ErrorState.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';

function ReminderSettingsForm({ data, editable, onSaved }) {
  const [form, setForm] = useState(data.reminders);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (mealType, field, value) => {
    setForm((current) => ({
      ...current,
      [mealType]: { ...current[mealType], [field]: value },
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await api.put('/api/settings/reminders', { reminders: form });
      onSaved(response.changed ? 'Reminder schedule saved.' : 'Reminder schedule is already up to date.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="reminder-form" onSubmit={handleSubmit}>
          {['morning', 'night'].map((mealType) => (
            <fieldset key={mealType} disabled={!editable || saving}>
              <legend>{mealType === 'morning' ? 'Morning' : 'Night'}</legend>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={form[mealType].enabled}
                  onChange={(event) => update(mealType, 'enabled', event.target.checked)}
                />
                <span>Enabled</span>
              </label>
              <label>
                <span>Reminder time</span>
                <input
                  type="time"
                  value={form[mealType].time}
                  onChange={(event) => update(mealType, 'time', event.target.value)}
                  step="60"
                  required
                />
              </label>
            </fieldset>
          ))}
          {editable && (
            <button className="button button--primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save reminders'}
            </button>
          )}
          {!editable && <p className="field-hint">Only Super Admin can change this schedule.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
      </form>
  );
}

export function ReminderSettingsPanel({ editable }) {
  const reminders = useReminders();
  const [message, setMessage] = useState('');

  return (
    <section className="panel reminder-settings" aria-labelledby="reminder-settings-title">
      <div className="section-heading section-heading--compact">
        <span className="feature-icon" aria-hidden="true"><AlarmClock size={21} /></span>
        <div>
          <h2 id="reminder-settings-title">Meal reminders</h2>
          <p>Asia/Kolkata schedule. Each banner remains visible for 60 minutes.</p>
        </div>
      </div>

      {reminders.loading && !reminders.data ? <LoadingState compact label="Loading reminder schedule" /> : null}
      {reminders.error && !reminders.data ? (
        <ErrorState compact title="Reminders unavailable" message={reminders.error} actionLabel="Try again" onAction={reminders.refresh} />
      ) : null}

      {reminders.data && (
        <ReminderSettingsForm
          key={reminders.data.revision}
          data={reminders.data}
          editable={editable}
          onSaved={(resultMessage) => {
            setMessage(resultMessage);
            reminders.refresh();
          }}
        />
      )}
      <p className="save-feedback" role="status" aria-live="polite">{message}</p>
    </section>
  );
}
