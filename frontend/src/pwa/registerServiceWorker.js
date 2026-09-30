/**
 * MealKhata Service Worker Registration & Update Lifecycle Manager
 */

let reloadTriggered = false;

export function registerServiceWorker({ onUpdateAvailable } = {}) {
  // Only register service worker in production or when explicitly enabled
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // In development, skip SW registration to avoid caching dev assets
  if (!import.meta.env.PROD) {
    return;
  }

  // Prevent repeated reload loops when service worker activates
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadTriggered) {
      reloadTriggered = true;
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        // Case 1: An updated service worker is already waiting to activate
        if (registration.waiting) {
          if (typeof onUpdateAvailable === 'function') {
            onUpdateAvailable(registration);
          }
          return;
        }

        // Case 2: An update is found during this session
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.addEventListener('statechange', () => {
            if (
              installingWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // A new worker is installed and ready, waiting for skipWaiting
              if (typeof onUpdateAvailable === 'function') {
                onUpdateAvailable(registration);
              }
            }
          });
        });
      })
      .catch((error) => {
        // PWA registration failure should never crash the web application
        if (import.meta.env.DEV) {
          console.warn('MealKhata ServiceWorker registration failed:', error);
        }
      });
  });
}

export function applyUpdate(registration) {
  if (registration?.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  } else if (navigator.serviceWorker?.controller) {
    // If waiting worker wasn't directly accessible, broadcast to all workers
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    });
  }
}
