import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { useReminderSettings } from '../hooks/useReminderSettings.js';
import {
  deletePushFromServer,
  fetchPushStatus,
  fetchVapidPublicKey,
  getExistingPushSubscription,
  isPushSupported,
  registerPushOnServer,
  subscribeDeviceToPush,
  unsubscribeDeviceFromPush,
  updatePushPreferencesOnServer,
} from '../lib/push.js';
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
    // Best-effort device preferences
  }
}

export function ReminderProvider({ children }) {
  const auth = useAuth();
  const settings = useReminderSettings();
  const [clock, setClock] = useState(() => new Date());

  // Web Push state
  const pushSupported = useMemo(() => isPushSupported(), []);
  const [pushServerAvailable, setPushServerAvailable] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPreferences, setPushPreferences] = useState({ morning: true, night: true });
  const [belongsToAnotherAccount, setBelongsToAnotherAccount] = useState(false);
  const [loadingPush, setLoadingPush] = useState(false);
  const [pushMessage, setPushMessage] = useState('');

  // Legacy local browser notification state
  const [deviceEnabled, setDeviceEnabled] = useState(
    () => readPreference(BROWSER_REMINDER_ENABLED_KEY) === 'true',
  );
  const [permission, setPermission] = useState(() => getNotificationSupport());
  const activeReminder = getActiveReminder(settings.data?.reminders, clock);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Check if push is configured on server
  useEffect(() => {
    let cancelled = false;
    async function checkServerPush() {
      if (!pushSupported) return;
      try {
        const key = await fetchVapidPublicKey();
        if (!cancelled && !key) {
          setPushServerAvailable(false);
        }
      } catch {
        // Leave as default
      }
    }
    checkServerPush();
    return () => {
      cancelled = true;
    };
  }, [pushSupported]);

  // Sync push registration status with server when authenticated member changes
  useEffect(() => {
    let cancelled = false;

    async function checkSubscription() {
      if (!pushSupported || auth.role !== 'member' || !auth.memberId) {
        setPushEnabled(false);
        setBelongsToAnotherAccount(false);
        return;
      }

      try {
        const sub = await getExistingPushSubscription();
        if (!sub) {
          if (!cancelled) {
            setPushEnabled(false);
            setBelongsToAnotherAccount(false);
          }
          return;
        }

        const status = await fetchPushStatus(sub.endpoint);
        if (!cancelled) {
          if (status?.enabled === false) {
            setPushServerAvailable(false);
            setPushEnabled(false);
            return;
          }
          if (status.registered) {
            setPushEnabled(true);
            setBelongsToAnotherAccount(false);
            if (status.preferences) {
              setPushPreferences(status.preferences);
            }
          } else if (status.belongsToAnotherAccount) {
            setPushEnabled(false);
            setBelongsToAnotherAccount(true);
          } else {
            setPushEnabled(false);
            setBelongsToAnotherAccount(false);
          }
        }
      } catch {
        // Network or server temporarily unreachable
      }
    }

    checkSubscription();
    return () => {
      cancelled = true;
    };
  }, [auth.memberId, auth.role, pushSupported]);

  // Legacy local fallback: Only fire if background push is NOT active
  useEffect(() => {
    if (pushEnabled) return;
    if (!deviceEnabled || permission !== 'granted' || !activeReminder) return;
    if (readPreference(LAST_BROWSER_REMINDER_KEY) === activeReminder.key) return;

    try {
      new window.Notification(activeReminder.title, {
        body: activeReminder.message,
        tag: `mealkhata-${activeReminder.key}`,
      });
      writePreference(LAST_BROWSER_REMINDER_KEY, activeReminder.key);
    } catch {
      // Best-effort
    }
  }, [activeReminder, deviceEnabled, permission, pushEnabled]);

  const enableBackgroundReminders = useCallback(async () => {
    if (!pushSupported) {
      setPushMessage('Background reminders are not supported in this browser.');
      return false;
    }

    if (auth.role !== 'member') {
      setPushMessage('Only household members can enable personal reminders.');
      return false;
    }

    setLoadingPush(true);
    setPushMessage('');

    try {
      const notificationApi = window.Notification;
      const nextPermission =
        notificationApi.permission === 'default'
          ? await notificationApi.requestPermission()
          : notificationApi.permission;

      setPermission(nextPermission);

      if (nextPermission !== 'granted') {
        setPushMessage(
          nextPermission === 'denied'
            ? 'Notification permission is blocked in browser settings.'
            : 'Notification permission was not granted.',
        );
        return false;
      }

      const vapidPublicKey = await fetchVapidPublicKey();
      if (!vapidPublicKey) {
        setPushMessage('Push reminder service is temporarily unavailable on server.');
        return false;
      }

      const sub = await subscribeDeviceToPush(vapidPublicKey);
      const initialPrefs = { morning: true, night: true };
      const result = await registerPushOnServer(sub, initialPrefs);

      setPushEnabled(true);
      setBelongsToAnotherAccount(false);
      setPushPreferences(result.preferences || initialPrefs);
      setDeviceEnabled(true);
      writePreference(BROWSER_REMINDER_ENABLED_KEY, 'true');
      setPushMessage('Background reminders enabled on this device.');
      return true;
    } catch (error) {
      setPushMessage(error?.message || 'Failed to enable background reminders.');
      return false;
    } finally {
      setLoadingPush(false);
    }
  }, [auth.role, pushSupported]);

  const disableBackgroundReminders = useCallback(async () => {
    setLoadingPush(true);
    setPushMessage('');

    try {
      const sub = await getExistingPushSubscription();
      if (sub?.endpoint) {
        await deletePushFromServer(sub.endpoint).catch(() => {});
      }
      await unsubscribeDeviceFromPush();

      setPushEnabled(false);
      setBelongsToAnotherAccount(false);
      setDeviceEnabled(false);
      writePreference(BROWSER_REMINDER_ENABLED_KEY, null);
      setPushMessage('Background reminders disabled on this device.');
      return true;
    } catch (error) {
      setPushMessage(error?.message || 'Failed to disable background reminders.');
      return false;
    } finally {
      setLoadingPush(false);
    }
  }, []);

  const togglePushPreference = useCallback(
    async (mealType) => {
      if (!pushEnabled || !['morning', 'night'].includes(mealType)) return;

      const newPrefs = {
        ...pushPreferences,
        [mealType]: !pushPreferences[mealType],
      };

      setPushPreferences(newPrefs);

      try {
        const sub = await getExistingPushSubscription();
        if (sub?.endpoint) {
          const res = await updatePushPreferencesOnServer(sub.endpoint, newPrefs);
          if (res?.preferences) {
            setPushPreferences(res.preferences);
          }
        }
      } catch {
        // Rollback on failure
        setPushPreferences(pushPreferences);
        setPushMessage('Failed to update preference. Please try again.');
      }
    },
    [pushEnabled, pushPreferences],
  );

  // Backward compatibility alias for legacy components/tests
  const enableBrowserReminders = enableBackgroundReminders;
  const disableBrowserReminders = disableBackgroundReminders;

  const value = useMemo(
    () => ({
      ...settings,
      activeReminder,
      permission,
      pushSupported,
      pushServerAvailable,
      pushEnabled,
      pushPreferences,
      belongsToAnotherAccount,
      loadingPush,
      pushMessage,
      enableBackgroundReminders,
      disableBackgroundReminders,
      togglePushPreference,
      // Legacy compatibility
      deviceEnabled: pushEnabled || deviceEnabled,
      message: pushMessage,
      enableBrowserReminders,
      disableBrowserReminders,
    }),
    [
      settings,
      activeReminder,
      permission,
      pushSupported,
      pushServerAvailable,
      pushEnabled,
      pushPreferences,
      belongsToAnotherAccount,
      loadingPush,
      pushMessage,
      enableBackgroundReminders,
      disableBackgroundReminders,
      togglePushPreference,
      deviceEnabled,
      enableBrowserReminders,
      disableBrowserReminders,
    ],
  );

  return <ReminderContext.Provider value={value}>{children}</ReminderContext.Provider>;
}
