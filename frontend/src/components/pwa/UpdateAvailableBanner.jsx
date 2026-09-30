import { RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { usePwa } from '../../hooks/usePwa.js';

export function UpdateAvailableBanner() {
  const { updateAvailable, applyUpdate } = usePwa();
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);

  if (!updateAvailable || dismissed) {
    return null;
  }

  const handleUpdate = () => {
    setUpdating(true);
    applyUpdate();
  };

  return (
    <aside className="update-banner" role="alert" aria-live="assertive">
      <div className="update-banner__inner">
        <div className="update-banner__content">
          <RefreshCw
            size={18}
            strokeWidth={2}
            className={`update-banner__icon${updating ? ' is-spinning' : ''}`}
            aria-hidden="true"
          />
          <span className="update-banner__text">
            A new version of MealKhata is ready.
          </span>
        </div>
        <div className="update-banner__actions">
          <button
            type="button"
            className="button button--primary button--sm update-banner__btn"
            onClick={handleUpdate}
            disabled={updating}
          >
            {updating ? 'Updating...' : 'Update now'}
          </button>
          <button
            type="button"
            className="button button--ghost button--sm update-banner__dismiss"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss update for now"
          >
            <X size={16} aria-hidden="true" />
            <span>Later</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
