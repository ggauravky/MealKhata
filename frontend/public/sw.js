/* MealKhata Production Service Worker - Redesign v2 */
const CACHE_NAME = 'mealkhata-shell-v2';

const STATIC_PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.svg',
  '/icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_PRECACHE))
      .catch((error) => {
        console.warn('MealKhata SW precache failed:', error);
      }),
  );
  // Do NOT skipWaiting automatically.
  // Wait for user confirmation in UpdateAvailable banner.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
            return Promise.resolve();
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Never cache non-GET requests (mutations: POST, PUT, PATCH, DELETE)
  if (request.method !== 'GET') {
    return;
  }

  // 2. Never cache or intercept /api/* requests (auth, meals, payments, financial data)
  if (url.pathname.startsWith('/api')) {
    return;
  }

  // 3. Never cache or intercept /socket.io/* (realtime WebSocket/polling)
  if (url.pathname.startsWith('/socket.io')) {
    return;
  }

  // 4. Navigation requests (SPA page routes: /calendar, /payments, /reports, /admin, etc.)
  // Strategy: Network First, fallback to cached static app shell (/index.html)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((cached) => cached || caches.match('/')),
      ),
    );
    return;
  }

  // 5. Static assets (Vite hashed bundles, icons, svg): Cache First, fallback to Network
  const isStatic =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webmanifest');

  if (isStatic && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        });
      }),
    );
    return;
  }

  // 6. Same-origin fallback: Network First with cache fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request)),
    );
  }
});

// 7. Web Push Notification Event (Phase 9)
self.addEventListener('push', (event) => {
  let payload = {};

  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch {
    payload = {
      title: 'Meal reminder',
      body: event.data ? event.data.text() : 'Check your meal status in MealKhata.',
    };
  }

  const isMorning = payload.mealType === 'morning';
  const defaultTitle = isMorning ? 'Morning meal reminder' : 'Night meal reminder';
  const defaultBody = isMorning
    ? 'Your Morning meal is currently Taking. Open MealKhata if you need to change it.'
    : 'Your Night meal is currently Taking. Open MealKhata if you need to change it.';

  const title = payload.title || defaultTitle;
  const rawUrl = payload.url || (payload.mealType ? `/?meal=${payload.mealType}` : '/');

  // Sanitize notification URL to ensure same-origin only
  let safeUrl = '/';
  if (typeof rawUrl === 'string' && !rawUrl.startsWith('//') && !rawUrl.startsWith('javascript:')) {
    try {
      const parsed = new URL(rawUrl, self.location.origin);
      if (parsed.origin === self.location.origin) {
        safeUrl = parsed.pathname + parsed.search + parsed.hash;
      }
    } catch {
      safeUrl = '/';
    }
  }

  const options = {
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
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 8. Notification Click Event (Phase 9)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // If a window is already open, focus it
        for (const client of windowClients) {
          if (client.url && 'focus' in client) {
            return client.focus();
          }
        }

        // Otherwise open a new window to the target URL
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
