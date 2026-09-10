import { BellRing } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { useReminders } from '../../hooks/useReminders.js';

export function ReminderBanner() {
  const auth = useAuth();
  const reminders = useReminders();

  if (!reminders.activeReminder) return null;

  return (
    <aside className="reminder-banner" aria-labelledby="active-reminder-title">
      <BellRing size={20} aria-hidden="true" />
      <div>
        <strong id="active-reminder-title">{reminders.activeReminder.title}</strong>
        <span>{reminders.activeReminder.message}</span>
      </div>
      <Link className="button button--quiet" to={auth.authenticated ? '/admin' : '/'}>
        {auth.authenticated ? 'Manage meals' : "View today's meals"}
      </Link>
    </aside>
  );
}
