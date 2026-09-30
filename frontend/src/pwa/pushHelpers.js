/**
 * Helper utilities for Web Push notifications, URL sanitization, and VAPID key conversion.
 */

export function sanitizeNotificationUrl(targetUrl, baseOrigin = 'http://localhost') {
  if (!targetUrl || typeof targetUrl !== 'string') {
    return '/';
  }

  // Reject javascript:, data:, and protocol-relative // URLs
  const trimmed = targetUrl.trim();
  if (
    trimmed.startsWith('//') ||
    trimmed.toLowerCase().startsWith('javascript:') ||
    trimmed.toLowerCase().startsWith('data:')
  ) {
    return '/';
  }

  try {
    const parsed = new URL(trimmed, baseOrigin);
    // If an external origin was specified, reject it
    if (parsed.origin !== baseOrigin && !trimmed.startsWith('/')) {
      return '/';
    }

    const safePath = parsed.pathname + parsed.search + parsed.hash;
    return safePath.startsWith('/') ? safePath : '/';
  } catch {
    return '/';
  }
}

export function buildNotificationOptions(payload = {}) {
  const isMorning = payload.mealType === 'morning';
  const defaultTitle = isMorning ? 'Morning meal reminder' : 'Night meal reminder';
  const defaultBody = isMorning
    ? 'Your Morning meal is currently Taking. Open MealKhata if you need to change it.'
    : 'Your Night meal is currently Taking. Open MealKhata if you need to change it.';

  const title = payload.title || defaultTitle;
  const safeUrl = sanitizeNotificationUrl(payload.url || (payload.mealType ? `/?meal=${payload.mealType}` : '/'));

  return {
    title,
    options: {
      body: payload.body || defaultBody,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      tag: payload.tag || (payload.date && payload.mealType ? `mealkhata:${payload.date}:${payload.mealType}` : 'mealkhata-reminder'),
      renotify: true,
      data: {
        url: safeUrl,
        mealType: payload.mealType || null,
        date: payload.date || null,
        ...(payload.data || {}),
      },
    },
  };
}

export function urlBase64ToUint8Array(base64String) {
  if (!base64String || typeof base64String !== 'string') {
    throw new TypeError('base64String must be a non-empty string');
  }

  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
