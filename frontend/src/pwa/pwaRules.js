export const CACHE_NAME = 'mealkhata-shell-v1';

export const STATIC_PRECACHE = Object.freeze([
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.svg',
  '/icons/favicon-32.png',
]);

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutationMethod(method = 'GET') {
  return MUTATION_METHODS.has(String(method).toUpperCase());
}

export function isApiRequest(urlInput) {
  try {
    const url = typeof urlInput === 'string' ? new URL(urlInput, 'http://localhost') : urlInput;
    return url.pathname.startsWith('/api');
  } catch {
    return false;
  }
}

export function isSocketIoRequest(urlInput) {
  try {
    const url = typeof urlInput === 'string' ? new URL(urlInput, 'http://localhost') : urlInput;
    return url.pathname.startsWith('/socket.io');
  } catch {
    return false;
  }
}

export function isStaticAsset(urlInput) {
  try {
    const url = typeof urlInput === 'string' ? new URL(urlInput, 'http://localhost') : urlInput;
    const pathname = url.pathname;
    return (
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/icons/') ||
      pathname.endsWith('.js') ||
      pathname.endsWith('.css') ||
      pathname.endsWith('.svg') ||
      pathname.endsWith('.png') ||
      pathname.endsWith('.webmanifest')
    );
  } catch {
    return false;
  }
}

export function getFetchStrategy({ url, method = 'GET', mode = 'cors' } = {}) {
  if (isMutationMethod(method)) {
    return 'network-only';
  }

  if (isApiRequest(url)) {
    return 'network-only';
  }

  if (isSocketIoRequest(url)) {
    return 'network-only';
  }

  if (mode === 'navigate') {
    return 'network-first-navigation';
  }

  if (isStaticAsset(url)) {
    return 'cache-first';
  }

  return 'network-first';
}

export function isStandaloneDisplayMode(windowObj = typeof window !== 'undefined' ? window : null) {
  if (!windowObj) return false;
  const isMatchMedia = Boolean(windowObj.matchMedia?.('(display-mode: standalone)')?.matches);
  const isNavigatorStandalone = Boolean(windowObj.navigator?.standalone);
  return isMatchMedia || isNavigatorStandalone;
}

export function isIosDevice(navigatorObj = typeof navigator !== 'undefined' ? navigator : null) {
  if (!navigatorObj) return false;
  const ua = navigatorObj.userAgent || '';
  const isIosUa = /iPhone|iPad|iPod/i.test(ua);
  const isIpadOs = navigatorObj.platform === 'MacIntel' && Number(navigatorObj.maxTouchPoints) > 1;
  return isIosUa || isIpadOs;
}
