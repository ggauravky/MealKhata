import { copyReminders, DEFAULT_REMINDERS } from './reminder.constants.js';

export function serializeReminderSettings(document) {
  return {
    configured: Boolean(document),
    reminders: copyReminders(document?.reminders ?? DEFAULT_REMINDERS),
    revision: document?.revision ?? 0,
    updatedAt: document?.updatedAt ? new Date(document.updatedAt).toISOString() : null,
  };
}
