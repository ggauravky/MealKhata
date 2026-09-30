import { WifiOff } from 'lucide-react';
import { usePwa } from '../../hooks/usePwa.js';

export function OfflineBanner() {
  const { isOnline } = usePwa();

  if (isOnline) {
    return null;
  }

  return (
    <aside className="offline-banner" role="status" aria-live="polite">
      <div className="offline-banner__inner">
        <WifiOff size={18} strokeWidth={2.2} className="offline-banner__icon" aria-hidden="true" />
        <div className="offline-banner__text">
          <strong>You&apos;re offline.</strong> Meal changes and payments are unavailable until you reconnect.
        </div>
      </div>
    </aside>
  );
}
