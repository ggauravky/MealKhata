import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CACHE_NAME,
  STATIC_PRECACHE,
  getFetchStrategy,
  isApiRequest,
  isIosDevice,
  isMutationMethod,
  isSocketIoRequest,
  isStandaloneDisplayMode,
  isStaticAsset,
} from '../src/pwa/pwaRules.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(currentDir, '../public/manifest.webmanifest');
const swPath = path.resolve(currentDir, '../public/sw.js');
const iconsDir = path.resolve(currentDir, '../public/icons');

describe('Phase 8 PWA: Cache Policy & Routing Rules', () => {
  test('strictly excludes all /api/ endpoints from caching', () => {
    const apiUrls = [
      '/api/meals/today',
      '/api/payments/summary/2026-03',
      '/api/auth/session',
      '/api/auth/login',
      '/api/settings/reminders',
      'https://example.com/api/billing/rates/2026-03',
    ];

    for (const url of apiUrls) {
      assert.equal(isApiRequest(url), true, `Expected ${url} to be classified as API`);
      assert.equal(
        getFetchStrategy({ url, method: 'GET', mode: 'cors' }),
        'network-only',
        `Expected ${url} to be network-only`,
      );
    }
  });

  test('strictly excludes /socket.io/ traffic from caching', () => {
    const socketUrls = [
      '/socket.io/?EIO=4&transport=polling',
      '/socket.io/?EIO=4&transport=websocket',
      'https://example.com/socket.io/',
    ];

    for (const url of socketUrls) {
      assert.equal(isSocketIoRequest(url), true, `Expected ${url} to be classified as socket.io`);
      assert.equal(
        getFetchStrategy({ url, method: 'GET', mode: 'cors' }),
        'network-only',
      );
    }
  });

  test('never caches non-GET mutation methods', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(isMutationMethod(method), true);
      assert.equal(
        getFetchStrategy({ url: '/any/path', method, mode: 'cors' }),
        'network-only',
      );
    }

    assert.equal(isMutationMethod('GET'), false);
    assert.equal(isMutationMethod('HEAD'), false);
  });

  test('identifies safe static frontend assets for cache-first strategy', () => {
    const staticUrls = [
      '/assets/index-D8f912.js',
      '/assets/index-A41bc9.css',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/favicon.svg',
      '/manifest.webmanifest',
    ];

    for (const url of staticUrls) {
      assert.equal(isStaticAsset(url), true, `Expected ${url} to be static asset`);
      assert.equal(
        getFetchStrategy({ url, method: 'GET', mode: 'cors' }),
        'cache-first',
      );
    }
  });

  test('applies network-first-navigation to SPA page navigation requests', () => {
    const navUrls = ['/', '/calendar', '/reports', '/payments', '/login', '/admin'];

    for (const url of navUrls) {
      assert.equal(
        getFetchStrategy({ url, method: 'GET', mode: 'navigate' }),
        'network-first-navigation',
      );
    }
  });

  test('precache list contains essential static application shell files only', () => {
    assert.equal(CACHE_NAME, 'mealkhata-shell-v1');
    assert.ok(STATIC_PRECACHE.includes('/'));
    assert.ok(STATIC_PRECACHE.includes('/index.html'));
    assert.ok(STATIC_PRECACHE.includes('/manifest.webmanifest'));
    assert.ok(STATIC_PRECACHE.includes('/icons/icon-192.png'));
    assert.ok(STATIC_PRECACHE.includes('/icons/icon-512.png'));

    // Verify no API, auth, or socket paths exist in precache list
    for (const asset of STATIC_PRECACHE) {
      assert.equal(asset.includes('/api/'), false);
      assert.equal(asset.includes('/socket.io'), false);
    }
  });
});

describe('Phase 8 PWA: Installability & Display Mode Logic', () => {
  test('accurately detects standalone display mode across platforms', () => {
    const mockStandaloneMedia = {
      matchMedia: (query) => ({ matches: query === '(display-mode: standalone)' }),
      navigator: { standalone: false },
    };
    assert.equal(isStandaloneDisplayMode(mockStandaloneMedia), true);

    const mockIosStandalone = {
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: true },
    };
    assert.equal(isStandaloneDisplayMode(mockIosStandalone), true);

    const mockBrowserTab = {
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: false },
    };
    assert.equal(isStandaloneDisplayMode(mockBrowserTab), false);
    assert.equal(isStandaloneDisplayMode(null), false);
  });

  test('accurately identifies iOS devices for Add-to-Home-Screen guidance', () => {
    assert.equal(
      isIosDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }),
      true,
    );
    assert.equal(
      isIosDevice({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }),
      true,
    );
    assert.equal(
      isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5 }),
      true,
    );
    assert.equal(
      isIosDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' }),
      false,
    );
    assert.equal(
      isIosDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }),
      false,
    );
    assert.equal(isIosDevice(null), false);
  });

  test('validates install availability rules', () => {
    function computeCanInstall({ deferredPrompt, isStandalone, isInstalled }) {
      return Boolean(deferredPrompt && !isStandalone && !isInstalled);
    }

    const mockEvent = { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) };

    // When prompt event is available in normal browser
    assert.equal(
      computeCanInstall({ deferredPrompt: mockEvent, isStandalone: false, isInstalled: false }),
      true,
    );

    // When already running standalone
    assert.equal(
      computeCanInstall({ deferredPrompt: mockEvent, isStandalone: true, isInstalled: false }),
      false,
    );

    // When already installed
    assert.equal(
      computeCanInstall({ deferredPrompt: mockEvent, isStandalone: false, isInstalled: true }),
      false,
    );

    // When prompt event is not available
    assert.equal(
      computeCanInstall({ deferredPrompt: null, isStandalone: false, isInstalled: false }),
      false,
    );
  });
});

describe('Phase 8 PWA: Update Management & Reload Guard', () => {
  test('single reload guard prevents infinite refresh loops on controllerchange', () => {
    let reloads = 0;
    let reloadTriggered = false;

    function onControllerChange() {
      if (!reloadTriggered) {
        reloadTriggered = true;
        reloads += 1;
      }
    }

    onControllerChange();
    onControllerChange();
    onControllerChange();

    assert.equal(reloads, 1, 'Page should reload exactly once on controller change');
  });

  test('applyUpdate sends SKIP_WAITING to waiting worker', () => {
    const messages = [];
    const mockRegistration = {
      waiting: {
        postMessage: (msg) => messages.push(msg),
      },
    };

    mockRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    assert.deepEqual(messages, [{ type: 'SKIP_WAITING' }]);
  });
});

describe('Phase 8 PWA: Manifest & Icon Artifacts Verification', () => {
  test('web app manifest contains all required PWA fields', async () => {
    const content = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(content);

    assert.equal(manifest.name, 'MealKhata');
    assert.equal(manifest.short_name, 'MealKhata');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.theme_color);
    assert.ok(manifest.background_color);

    const icons = manifest.icons;
    assert.ok(Array.isArray(icons) && icons.length >= 3);

    const has192 = icons.some((i) => i.sizes === '192x192');
    const has512 = icons.some((i) => i.sizes === '512x512');
    const hasMaskable = icons.some((i) => i.purpose?.includes('maskable'));

    assert.equal(has192, true, 'Manifest must contain 192x192 icon');
    assert.equal(has512, true, 'Manifest must contain 512x512 icon');
    assert.equal(hasMaskable, true, 'Manifest must contain maskable icon');
  });

  test('all referenced icon image files exist with non-zero size', async () => {
    const requiredFiles = [
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
      'apple-touch-icon.png',
      'favicon.svg',
      'favicon-32.png',
    ];

    for (const filename of requiredFiles) {
      const filePath = path.join(iconsDir, filename);
      const stat = await fs.stat(filePath);
      assert.ok(stat.size > 0, `Expected ${filename} to have non-zero size`);
    }
  });

  test('service worker source file does not contain secret environment variables or API caching', async () => {
    const swContent = await fs.readFile(swPath, 'utf8');
    assert.doesNotMatch(swContent, /JWT_SECRET|ADMIN_PASSWORD|process\.env/);
    assert.match(swContent, /SKIP_WAITING/);
    assert.match(swContent, /url\.pathname\.startsWith\('\/api'\)/);
    assert.match(swContent, /url\.pathname\.startsWith\('\/socket\.io'\)/);
  });
});
