import { Download } from 'lucide-react';
import { useState } from 'react';
import { usePwa } from '../../hooks/usePwa.js';

export function InstallAppButton({ className = '', variant = 'outline' }) {
  const { canInstall, installApp } = usePwa();
  const [installing, setInstalling] = useState(false);

  if (!canInstall) {
    return null;
  }

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      await installApp();
    } finally {
      setInstalling(false);
    }
  };

  const buttonClass =
    variant === 'primary'
      ? `button button--primary install-btn ${className}`
      : `button button--secondary install-btn ${className}`;

  return (
    <button
      type="button"
      className={buttonClass.trim()}
      onClick={handleInstall}
      disabled={installing}
      title="Install MealKhata to your home screen"
      aria-label="Install MealKhata application"
    >
      <Download size={16} strokeWidth={2} aria-hidden="true" />
      <span>{installing ? 'Installing...' : 'Install App'}</span>
    </button>
  );
}
