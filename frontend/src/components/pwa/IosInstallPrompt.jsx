import { Share, SquarePlus, X } from 'lucide-react';
import { usePwa } from '../../hooks/usePwa.js';

export function IosInstallPrompt() {
  const { isIos, isStandalone, isDismissed, dismissInstallHelper } = usePwa();

  if (!isIos || isStandalone || isDismissed) {
    return null;
  }

  return (
    <aside className="ios-install-card" role="region" aria-label="Install MealKhata on iOS">
      <div className="ios-install-card__content">
        <p className="ios-install-card__title">
          <strong>Install MealKhata on your iPhone</strong>
        </p>
        <p className="ios-install-card__instructions">
          Tap the Share button <Share size={15} className="inline-icon" aria-label="Share" /> in Safari,
          then choose <strong>Add to Home Screen</strong> <SquarePlus size={15} className="inline-icon" aria-label="Add to Home Screen" />.
        </p>
      </div>
      <button
        type="button"
        className="button button--ghost button--sm ios-install-card__close"
        onClick={dismissInstallHelper}
        aria-label="Dismiss installation instructions"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}
