import { HttpError } from '../utils/HttpError.js';
import {
  copyReminders,
  DEFAULT_REMINDERS,
  REMINDER_SETTINGS_KEY,
} from './reminder.constants.js';
import { reminderSettingsRepository } from './reminderSettings.repository.js';
import { serializeReminderSettings } from './reminderSettings.serializer.js';

const MAX_RETRIES = 12;

function sameReminders(left, right) {
  return left.morning.enabled === right.morning.enabled &&
    left.morning.time === right.morning.time &&
    left.night.enabled === right.night.enabled &&
    left.night.time === right.night.time;
}

export function createReminderSettingsService({ repository = reminderSettingsRepository } = {}) {
  return Object.freeze({
    async getSettings() {
      try {
        return serializeReminderSettings(await repository.findPrimary());
      } catch (error) {
        throw new HttpError(503, 'Reminder settings are temporarily unavailable.', { cause: error });
      }
    },

    async updateSettings({ reminders, actorRole, changedAt = new Date() }) {
      const nextReminders = copyReminders(reminders);

      try {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
          const current = await repository.findPrimary();
          const currentReminders = copyReminders(current?.reminders ?? DEFAULT_REMINDERS);

          if (sameReminders(currentReminders, nextReminders)) {
            return { changed: false, data: serializeReminderSettings(current) };
          }

          const change = {
            changedAt,
            actorRole,
            from: currentReminders,
            to: nextReminders,
          };

          if (!current) {
            try {
              const created = await repository.create({
                key: REMINDER_SETTINGS_KEY,
                reminders: nextReminders,
                revision: 1,
                changes: [change],
              });
              return { changed: true, data: serializeReminderSettings(created) };
            } catch (error) {
              if (error?.code === 11000) continue;
              throw error;
            }
          }

          const updated = await repository.updateIfCurrent({
            current,
            reminders: nextReminders,
            change,
          });
          if (updated) return { changed: true, data: serializeReminderSettings(updated) };
        }

        throw new Error('Concurrent reminder settings updates did not settle');
      } catch (error) {
        throw new HttpError(503, 'Unable to save reminder settings. Please try again.', {
          cause: error,
        });
      }
    },
  });
}

export const reminderSettingsService = createReminderSettingsService();
