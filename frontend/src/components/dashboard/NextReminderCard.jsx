import { Bell, Clock } from 'lucide-react';
import { BrowserReminderControl } from '../reminders/BrowserReminderControl.jsx';

export function NextReminderCard({ reminders }) {
  const next = reminders?.nextReminder;
  const isPushConfigured = reminders?.isPushConfigured;

  return (
    <section className="panel next-reminder-card" aria-labelledby="next-reminder-title">
      <div className="next-reminder-card__header">
        <div>
          <span className="section-eyebrow">NEXT REMINDER</span>
          <h2 id="next-reminder-title">Meal Alert Schedule</h2>
        </div>
        <span className="reminder-badge" aria-hidden="true">
          <Bell size={16} />
        </span>
      </div>

      <div className="next-reminder-info">
        {next ? (
          <div className="next-reminder-schedule">
            <Clock size={18} aria-hidden="true" className="clock-icon" />
            <div>
              <strong>{next.label}</strong>
              <span className="schedule-time">{next.timeFormatted || next.time}</span>
            </div>
          </div>
        ) : (
          <p className="no-reminder-copy">No upcoming reminders scheduled for today.</p>
        )}

        <div className="reminder-status-pill">
          {isPushConfigured ? (
            <span className="pill-dot pill-dot--push">Background push reminders enabled</span>
          ) : (
            <span className="pill-dot pill-dot--inapp">In-app reminders active</span>
          )}
        </div>
      </div>

      <div className="reminder-control-wrapper">
        <BrowserReminderControl />
      </div>
    </section>
  );
}
