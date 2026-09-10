export const REMINDER_SETTINGS_KEY = 'primary';

export const DEFAULT_REMINDERS = Object.freeze({
  morning: Object.freeze({ enabled: true, time: '09:00' }),
  night: Object.freeze({ enabled: true, time: '20:00' }),
});

const LOGICAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidLogicalTime(value) {
  return typeof value === 'string' && LOGICAL_TIME_PATTERN.test(value);
}

export function copyReminders(source = DEFAULT_REMINDERS) {
  return {
    morning: { enabled: source.morning.enabled, time: source.morning.time },
    night: { enabled: source.night.enabled, time: source.night.time },
  };
}
