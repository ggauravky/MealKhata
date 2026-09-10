export const REMINDER_WINDOW_MINUTES = 60;
export const BROWSER_REMINDER_ENABLED_KEY = 'mk_browser_reminders_enabled';
export const LAST_BROWSER_REMINDER_KEY = 'mk_last_browser_reminder';

export function getIndiaClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function previousLogicalDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1, 12)).toISOString().slice(0, 10);
}

export function getActiveReminder(reminders, now = new Date()) {
  if (!reminders) return null;

  const current = getIndiaClock(now);
  for (const mealType of ['morning', 'night']) {
    const reminder = reminders[mealType];
    if (!reminder?.enabled || !/^\d{2}:\d{2}$/.test(reminder.time)) continue;

    const [hour, minute] = reminder.time.split(':').map(Number);
    const scheduledMinutes = hour * 60 + minute;
    const endMinutes = scheduledMinutes + REMINDER_WINDOW_MINUTES;
    const activeToday = current.minutes >= scheduledMinutes && current.minutes < Math.min(endMinutes, 1440);
    const activeFromYesterday = endMinutes > 1440 && current.minutes < endMinutes - 1440;

    if (activeToday || activeFromYesterday) {
      const date = activeFromYesterday ? previousLogicalDate(current.date) : current.date;
      return {
        mealType,
        date,
        key: `${date}:${mealType}`,
        title: mealType === 'morning' ? 'Morning meal reminder' : 'Night meal reminder',
        message: mealType === 'morning'
          ? "Check today's morning meal plan."
          : "Review tonight's meal status.",
      };
    }
  }

  return null;
}

export function getNotificationSupport(notificationApi = globalThis.Notification) {
  return notificationApi ? notificationApi.permission : 'unsupported';
}
