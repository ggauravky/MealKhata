import { REMINDER_SETTINGS_KEY } from './reminder.constants.js';
import { ReminderSettings } from './reminderSettings.model.js';

function toPlainObject(document) {
  return document?.toObject ? document.toObject() : document;
}

export const reminderSettingsRepository = Object.freeze({
  async findPrimary() {
    return ReminderSettings.findOne({ key: REMINDER_SETTINGS_KEY }).lean().exec();
  },

  async create(settings) {
    const document = await ReminderSettings.create(settings);
    return toPlainObject(document);
  },

  async updateIfCurrent({ current, reminders, change }) {
    return ReminderSettings.findOneAndUpdate(
      { key: REMINDER_SETTINGS_KEY, revision: current.revision },
      {
        $set: { reminders },
        $inc: { revision: 1 },
        $push: { changes: change },
      },
      { new: true, runValidators: true },
    )
      .lean()
      .exec();
  },
});
