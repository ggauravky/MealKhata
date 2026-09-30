import { useContext } from 'react';
import { PwaContext } from '../context/pwaContext.js';

export function usePwa() {
  const context = useContext(PwaContext);
  if (!context) {
    return {
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      isStandalone: false,
      isInstalled: false,
      canInstall: false,
      updateAvailable: false,
      isIos: false,
      isDismissed: false,
      installApp: async () => false,
      applyUpdate: () => {},
      dismissInstallHelper: () => {},
    };
  }
  return context;
}
