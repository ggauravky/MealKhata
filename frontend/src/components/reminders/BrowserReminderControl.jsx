import { Bell, BellOff } from 'lucide-react';
import { useReminders } from '../../hooks/useReminders.js';

export function BrowserReminderControl() {
  const reminders = useReminders();
  const unsupported = reminders.permission === 'unsupported';
  const denied = reminders.permission === 'denied';

  return (
    <section className="browser-reminder-control" aria-labelledby="browser-reminders-title">
      <div>
        <strong id="browser-reminders-title">Browser reminders</strong>
        <span>Optional device alerts while MealKhata is open.</span>
      </div>
      {reminders.deviceEnabled ? (
        <button className="button button--quiet" type="button" onClick={reminders.disableBrowserReminders}>
          <BellOff size={17} aria-hidden="true" /> Disable
        </button>
      ) : (
        <button
          className="button button--quiet"
          type="button"
          onClick={reminders.enableBrowserReminders}
          disabled={unsupported || denied}
        >
          <Bell size={17} aria-hidden="true" /> Enable
        </button>
      )}
      {(unsupported || denied || reminders.message) && (
        <p className="save-feedback" role="status" aria-live="polite">
          {unsupported
            ? 'Notifications are unsupported in this browser.'
            : denied
              ? 'Notification permission is blocked in browser settings.'
              : reminders.message}
        </p>
      )}
    </section>
  );
}
