import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildNotificationOptions,
  sanitizeNotificationUrl,
  urlBase64ToUint8Array,
} from '../src/pwa/pushHelpers.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const swPath = path.resolve(currentDir, '../public/sw.js');

describe('Phase 9 Frontend: Web Push Helpers & Service Worker Push Handling', () => {
  describe('urlBase64ToUint8Array', () => {
    test('converts base64url encoded VAPID string to Uint8Array', () => {
      // "hello" in base64url is "aGVsbG8"
      const uint8 = urlBase64ToUint8Array('aGVsbG8');
      assert.ok(uint8 instanceof Uint8Array);
      assert.equal(uint8.length, 5);
      const decoded = String.fromCharCode(...uint8);
      assert.equal(decoded, 'hello');
    });

    test('throws TypeError on invalid or empty input', () => {
      assert.throws(() => urlBase64ToUint8Array(''), /non-empty string/);
      assert.throws(() => urlBase64ToUint8Array(null), /non-empty string/);
      assert.throws(() => urlBase64ToUint8Array(123), /non-empty string/);
    });
  });

  describe('sanitizeNotificationUrl', () => {
    test('allows safe same-origin and relative paths', () => {
      assert.equal(sanitizeNotificationUrl('/'), '/');
      assert.equal(sanitizeNotificationUrl('/?meal=morning'), '/?meal=morning');
      assert.equal(sanitizeNotificationUrl('/calendar#2026-10-01'), '/calendar#2026-10-01');
      assert.equal(sanitizeNotificationUrl('/reports?month=2026-10'), '/reports?month=2026-10');
      assert.equal(
        sanitizeNotificationUrl('https://mealkhata.local/?meal=night', 'https://mealkhata.local'),
        '/?meal=night',
      );
    });

    test('rejects external URLs, protocol-relative URLs, and unsafe schemes', () => {
      assert.equal(sanitizeNotificationUrl('https://evil.example.com'), '/');
      assert.equal(sanitizeNotificationUrl('http://attacker.com/malicious'), '/');
      assert.equal(sanitizeNotificationUrl('//evil.example.com/path'), '/');
      assert.equal(sanitizeNotificationUrl('javascript:alert(1)'), '/');
      assert.equal(sanitizeNotificationUrl('data:text/html,evil'), '/');
      assert.equal(sanitizeNotificationUrl(''), '/');
      assert.equal(sanitizeNotificationUrl(null), '/');
      assert.equal(sanitizeNotificationUrl(undefined), '/');
    });
  });

  describe('buildNotificationOptions', () => {
    test('constructs defensive Morning reminder notification options', () => {
      const { title, options } = buildNotificationOptions({
        mealType: 'morning',
        date: '2026-10-01',
      });

      assert.equal(title, 'Morning meal reminder');
      assert.equal(options.body, 'Your Morning meal is currently Taking. Open MealKhata if you need to change it.');
      assert.equal(options.icon, '/icons/icon-192.png');
      assert.equal(options.badge, '/icons/favicon-32.png');
      assert.equal(options.tag, 'mealkhata:2026-10-01:morning');
      assert.equal(options.renotify, true);
      assert.equal(options.data.url, '/?meal=morning');
      assert.equal(options.data.mealType, 'morning');
      assert.equal(options.data.date, '2026-10-01');
    });

    test('constructs defensive Night reminder notification options', () => {
      const { title, options } = buildNotificationOptions({
        mealType: 'night',
        date: '2026-10-01',
      });

      assert.equal(title, 'Night meal reminder');
      assert.equal(options.body, 'Your Night meal is currently Taking. Open MealKhata if you need to change it.');
      assert.equal(options.tag, 'mealkhata:2026-10-01:night');
      assert.equal(options.data.url, '/?meal=night');
    });

    test('handles empty or malformed payload with safe defaults', () => {
      const { title, options } = buildNotificationOptions({});

      assert.ok(typeof title === 'string' && title.length > 0);
      assert.ok(typeof options.body === 'string' && options.body.length > 0);
      assert.equal(options.data.url, '/');
      assert.equal(options.icon, '/icons/icon-192.png');
    });

    test('sanitizes unsafe url in payload', () => {
      const { options } = buildNotificationOptions({
        mealType: 'morning',
        date: '2026-10-01',
        url: 'https://attacker.com/steal',
      });

      assert.equal(options.data.url, '/');
    });
  });

  describe('Service Worker Push & Click Event Handler Verification', () => {
    test('sw.js registers push event listener', async () => {
      const swCode = await fs.readFile(swPath, 'utf8');
      assert.ok(
        swCode.includes("self.addEventListener('push'"),
        'Service worker must register push event listener',
      );
      assert.ok(
        swCode.includes('showNotification'),
        'Service worker push handler must showNotification',
      );
      assert.ok(
        swCode.includes('payload.mealType'),
        'Service worker must inspect payload mealType',
      );
    });

    test('sw.js registers notificationclick event listener and focuses/opens same-origin window', async () => {
      const swCode = await fs.readFile(swPath, 'utf8');
      assert.ok(
        swCode.includes("self.addEventListener('notificationclick'"),
        'Service worker must register notificationclick event listener',
      );
      assert.ok(
        swCode.includes('event.notification.close()'),
        'Notification click handler must close the notification',
      );
      assert.ok(
        swCode.includes('matchAll'),
        'Notification click handler must inspect open clients via matchAll',
      );
      assert.ok(
        swCode.includes('client.focus()'),
        'Notification click handler must focus existing window if open',
      );
      assert.ok(
        swCode.includes('openWindow'),
        'Notification click handler must fallback to openWindow',
      );
    });

    test('sw.js preserves Phase 8 lifecycle and caching handlers', async () => {
      const swCode = await fs.readFile(swPath, 'utf8');
      assert.ok(swCode.includes("self.addEventListener('install'"));
      assert.ok(swCode.includes("self.addEventListener('activate'"));
      assert.ok(swCode.includes("self.addEventListener('fetch'"));
      assert.ok(swCode.includes("self.addEventListener('message'"));
      assert.ok(swCode.includes('SKIP_WAITING'));
      assert.ok(swCode.includes('clients.claim()'));
    });
  });
});
