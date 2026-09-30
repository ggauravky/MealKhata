import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { applyUpdate as triggerSwUpdate, registerServiceWorker } from '../pwa/registerServiceWorker.js';
import { isIosDevice, isStandaloneDisplayMode } from '../pwa/pwaRules.js';
import { PwaContext } from './pwaContext.js';

export function PwaProvider({ children }) {
  const isOnline = useOnlineStatus();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(() => isStandaloneDisplayMode());
  const [isInstalled, setIsInstalled] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingRegistration, setWaitingRegistration] = useState(null);
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('mk:install-dismissed') === 'true';
    } catch {
      return false;
    }
  });

  const isIos = useMemo(() => isIosDevice(), []);

  // Monitor standalone display mode changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mql = window.matchMedia('(display-mode: standalone)');
    const handleModeChange = (e) => setIsStandalone(e.matches);

    if (mql.addEventListener) {
      mql.addEventListener('change', handleModeChange);
      return () => mql.removeEventListener('change', handleModeChange);
    }
  }, []);

  // Listen for native beforeinstallprompt and appinstalled events
  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Register service worker and listen for updates
  useEffect(() => {
    registerServiceWorker({
      onUpdateAvailable: (reg) => {
        setWaitingRegistration(reg);
        setUpdateAvailable(true);
      },
    });
  }, []);

  const installApp = useCallback(async () => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      return choice.outcome === 'accepted';
    } catch {
      setDeferredPrompt(null);
      return false;
    }
  }, [deferredPrompt]);

  const applyUpdate = useCallback(() => {
    triggerSwUpdate(waitingRegistration);
  }, [waitingRegistration]);

  const dismissInstallHelper = useCallback(() => {
    setIsDismissed(true);
    try {
      sessionStorage.setItem('mk:install-dismissed', 'true');
    } catch {
      // Ignore sessionStorage errors
    }
  }, []);

  const canInstall = Boolean(deferredPrompt && !isStandalone && !isInstalled);

  const value = useMemo(
    () => ({
      isOnline,
      isStandalone,
      isInstalled,
      canInstall,
      updateAvailable,
      isIos,
      isDismissed,
      installApp,
      applyUpdate,
      dismissInstallHelper,
    }),
    [
      isOnline,
      isStandalone,
      isInstalled,
      canInstall,
      updateAvailable,
      isIos,
      isDismissed,
      installApp,
      applyUpdate,
      dismissInstallHelper,
    ],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}
