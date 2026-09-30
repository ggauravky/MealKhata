/* MealKhata Production Service Worker - Phase 8 PWA */
const CACHE_NAME = 'mealkhata-shell-v1';

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
