import { useCallback, useEffect, useMemo, useState } from 'react';
import { useReminderSettings } from '../hooks/useReminderSettings.js';
import {
  BROWSER_REMINDER_ENABLED_KEY,
  getActiveReminder,
  getNotificationSupport,
  LAST_BROWSER_REMINDER_KEY,
} from '../lib/reminders.js';
import { ReminderContext } from './reminderContext.js';

function readPreference(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Device preferences are best-effort and never affect meal data.
  }
}

export function ReminderProvider({ children }) {
  const settings = useReminderSettings();
  const [clock, setClock] = useState(() => new Date());
  const [deviceEnabled, setDeviceEnabled] = useState(
    () => readPreference(BROWSER_REMINDER_ENABLED_KEY) === 'true',
  );
  const [permission, setPermission] = useState(() => getNotificationSupport());
  const [message, setMessage] = useState('');
  const activeReminder = getActiveReminder(settings.data?.reminders, clock);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!deviceEnabled || permission !== 'granted' || !activeReminder) return;
    if (readPreference(LAST_BROWSER_REMINDER_KEY) === activeReminder.key) return;

    try {
      new window.Notification(activeReminder.title, {
        body: activeReminder.message,
        tag: `mealkhata-${activeReminder.key}`,
      });
      writePreference(LAST_BROWSER_REMINDER_KEY, activeReminder.key);
    } catch {
      // Permission and browser support can change outside this tab; the next interval may retry.
    }
  }, [activeReminder, deviceEnabled, permission]);

  const enableBrowserReminders = useCallback(async () => {
    const notificationApi = window.Notification;
    if (!notificationApi) {
      setPermission('unsupported');
      setMessage('Browser notifications are not supported on this device.');
      return;
    }

    const nextPermission = notificationApi.permission === 'default'
      ? await notificationApi.requestPermission()
      : notificationApi.permission;
    setPermission(nextPermission);

    if (nextPermission === 'granted') {
      setDeviceEnabled(true);
      writePreference(BROWSER_REMINDER_ENABLED_KEY, 'true');
      setMessage('Browser reminders enabled on this device.');
    } else if (nextPermission === 'denied') {
      setDeviceEnabled(false);
      writePreference(BROWSER_REMINDER_ENABLED_KEY, null);
      setMessage('Browser notification permission is blocked.');
    }
  }, []);

  const disableBrowserReminders = useCallback(() => {
    setDeviceEnabled(false);
    writePreference(BROWSER_REMINDER_ENABLED_KEY, null);
    setMessage('Browser reminders disabled on this device.');
  }, []);

  const value = useMemo(() => ({
    ...settings,
    activeReminder,
    deviceEnabled,
    permission,
    message,
    enableBrowserReminders,
    disableBrowserReminders,
  }), [
    activeReminder,
    deviceEnabled,
    disableBrowserReminders,
    enableBrowserReminders,
    message,
    permission,
    settings,
  ]);

  return <ReminderContext.Provider value={value}>{children}</ReminderContext.Provider>;
}
