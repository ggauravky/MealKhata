import { Bell, BellOff, Check } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';
import { usePwa } from '../../hooks/usePwa.js';
import { useReminders } from '../../hooks/useReminders.js';

export function BrowserReminderControl() {
  const auth = useAuth();
  const reminders = useReminders();
  const { isOnline, isIos, isStandalone } = usePwa();

  const isMember = auth.role === 'member';
  const unsupported = reminders.permission === 'unsupported' || !reminders.pushSupported;
  const denied = reminders.permission === 'denied';

  // Viewer / Admin / Super Admin informational display
  if (!isMember) {
    return (
      <section className="browser-reminder-control" aria-labelledby="browser-reminders-title">
        <div className="browser-reminder-control__info">
          <strong id="browser-reminders-title">Background reminders on this device</strong>
          <span>
            {auth.role === 'admin' || auth.role === 'superadmin'
              ? 'Personal background meal reminders are available when logged in as an individual household member.'
              : 'Log in as a household member to enable personal background reminders on this device.'}
          </span>
        </div>
      </section>
    );
  }

  const renderFeedbackMessage = () => {
    if (!isOnline) {
      return 'Connect to the internet to change background reminder settings.';
    }
    if (unsupported) {
      if (isIos && !isStandalone) {
        return 'Install MealKhata to your Home Screen, open the installed app, then enable background reminders.';
      }
      return 'Background reminders are not supported in this browser.';
    }
    if (denied) {
      return 'Notifications are blocked in your browser/device settings.';
    }
    if (reminders.pushMessage) {
      return reminders.pushMessage;
    }
    if (reminders.message) {
      return reminders.message;
    }
    return null;
  };

  const feedbackMessage = renderFeedbackMessage();

  return (
    <section className="browser-reminder-control" aria-labelledby="browser-reminders-title">
      <div className="browser-reminder-control__info">
        <strong id="browser-reminders-title">Background reminders on this device</strong>
        <span>
          {reminders.pushEnabled
            ? 'Notifications are enabled on this device.'
            : reminders.belongsToAnotherAccount
              ? `Background reminders are currently configured for another account on this device. Enable reminders for ${auth.displayName || auth.memberId}?`
              : "Receive Morning and Night meal reminders even when MealKhata isn't open."}
        </span>
      </div>

      <div className="browser-reminder-control__actions">
        {reminders.pushEnabled ? (
          <>
            <div className="browser-reminder-control__toggles" role="group" aria-label="Reminder periods">
              <button
                type="button"
                className={`button--toggle ${reminders.pushPreferences?.morning ? 'is-active' : ''}`}
                onClick={() => reminders.togglePushPreference('morning')}
                disabled={!isOnline || reminders.loadingPush}
                aria-pressed={Boolean(reminders.pushPreferences?.morning)}
              >
                Morning {reminders.pushPreferences?.morning ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                className={`button--toggle ${reminders.pushPreferences?.night ? 'is-active' : ''}`}
                onClick={() => reminders.togglePushPreference('night')}
                disabled={!isOnline || reminders.loadingPush}
                aria-pressed={Boolean(reminders.pushPreferences?.night)}
              >
                Night {reminders.pushPreferences?.night ? 'ON' : 'OFF'}
              </button>
            </div>
            <button
              className="button button--quiet button--compact"
              type="button"
              onClick={reminders.disableBackgroundReminders}
              disabled={!isOnline || reminders.loadingPush}
            >
              <BellOff size={16} aria-hidden="true" /> Disable on this device
            </button>
          </>
        ) : (
          <button
            className="button button--quiet"
            type="button"
            onClick={reminders.enableBackgroundReminders}
            disabled={!isOnline || unsupported || denied || reminders.loadingPush}
          >
            {reminders.belongsToAnotherAccount ? (
              <>
                <Check size={16} aria-hidden="true" /> Enable for {auth.displayName || auth.memberId}
              </>
            ) : (
              <>
                <Bell size={16} aria-hidden="true" />{' '}
                {reminders.loadingPush ? 'Enabling...' : 'Enable reminders'}
              </>
            )}
          </button>
        )}
      </div>

      {feedbackMessage && (
        <p className="save-feedback" role="status" aria-live="polite">
          {feedbackMessage}
        </p>
      )}
    </section>
  );
}
