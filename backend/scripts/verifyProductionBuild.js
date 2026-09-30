import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendIndex = path.resolve(currentDirectory, '../../frontend/dist/index.html');
const testPassword = 'production-routing-test-password';

const TEST_VAPID_PUBLIC = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9bP0T1gE-A4V-o0lqPj0G0z8bU3rB5Q6P3K2Y1X0Z9W8V7U';
const TEST_VAPID_PRIVATE = 'production-test-vapid-private-key-material-do-not-expose-32b';
const TEST_VAPID_SUBJECT = 'mailto:admin@mealkhata.production';

Object.assign(process.env, {
  NODE_ENV: 'production',
  PORT: '5000',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/production-routing-test',
  APP_TIMEZONE: 'Asia/Kolkata',
  ADMIN_EMAIL: 'admin.routing.test@example.com',
  SUPERADMIN_EMAIL: 'super.routing.test@example.com',
  ADMIN_PASSWORD_HASH: await bcrypt.hash(testPassword, 12),
  SUPERADMIN_PASSWORD_HASH: await bcrypt.hash(testPassword, 12),
  AUTH_JWT_SECRET: 'routing-test-only-secret-material-with-more-than-forty-eight-bytes',
  APP_ORIGIN: 'https://meal-khata.example',
  VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC,
  VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE,
  VAPID_SUBJECT: TEST_VAPID_SUBJECT,
});

const { createApp } = await import('../src/app.js');
const app = createApp();

for (const route of ['/', '/calendar', '/reports', '/payments', '/login', '/admin']) {
  const response = await request(app).get(route).set('Accept', 'text/html');
  assert.equal(response.status, 200, route);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.equal(response.headers['cache-control'], 'no-store');
}

const apiNotFound = await request(app).get('/api/not-real').set('Accept', 'text/html');
assert.equal(apiNotFound.status, 404);
assert.match(apiNotFound.headers['content-type'], /application\/json/);

const socketNotFound = await request(app).get('/socket.io/not-real').set('Accept', 'text/html');
assert.equal(socketNotFound.status, 404);
assert.match(socketNotFound.headers['content-type'], /application\/json/);

const login = await request(app)
  .post('/api/auth/login')
  .set('Origin', process.env.APP_ORIGIN)
  .send({ email: process.env.ADMIN_EMAIL, password: testPassword });
assert.equal(login.status, 200);
const cookie = login.headers['set-cookie']?.[0] ?? '';
assert.match(cookie, /HttpOnly/i);
assert.match(cookie, /Secure/i);
assert.match(cookie, /SameSite=Lax/i);
assert.match(cookie, /Path=\//i);
assert.ok(login.headers['strict-transport-security']);

await request(app)
  .post('/api/auth/logout')
  .set('Origin', 'https://foreign.example')
  .expect(403);

// Phase 9: Push endpoints boundary and VAPID checks
const pushPublicKeyRes = await request(app).get('/api/push/public-key').expect(200);
assert.equal(pushPublicKeyRes.body.success, true);
assert.equal(pushPublicKeyRes.body.publicKey, TEST_VAPID_PUBLIC);
assert.ok(!JSON.stringify(pushPublicKeyRes.body).includes(TEST_VAPID_PRIVATE), 'private key must never be exposed');

// Push registration must reject unauthenticated requests
await request(app)
  .post('/api/push/subscriptions')
  .set('Origin', process.env.APP_ORIGIN)
  .send({ subscription: { endpoint: 'https://push.example' } })
  .expect(401);

// Push registration must reject Admin requests (members only)
await request(app)
  .post('/api/push/subscriptions')
  .set('Origin', process.env.APP_ORIGIN)
  .set('Cookie', cookie)
  .send({ subscription: { endpoint: 'https://push.example' } })
  .expect(403);

const html = await fs.readFile(frontendIndex, 'utf8');
const assetPath = html.match(/\/assets\/[^"]+\.js/)?.[0];
assert.ok(assetPath, 'built JavaScript asset was not found');
const asset = await request(app).get(assetPath).expect(200);
assert.match(asset.headers['cache-control'], /max-age=31536000/);
assert.match(asset.headers['cache-control'], /immutable/);

const manifest = await request(app).get('/manifest.webmanifest').expect(200);
assert.match(manifest.headers['content-type'], /manifest\+json/);

const sw = await request(app).get('/sw.js').expect(200);
assert.match(sw.headers['content-type'], /javascript/);
assert.match(sw.headers['cache-control'], /no-cache/);
assert.ok(!sw.text.includes('AUTH_JWT_SECRET'), 'service worker must not contain secrets');
assert.ok(!sw.text.includes(TEST_VAPID_PRIVATE), 'service worker must not contain VAPID private key');
assert.ok(sw.text.includes("self.addEventListener('push'"), 'service worker must handle push event');
assert.ok(sw.text.includes("self.addEventListener('notificationclick'"), 'service worker must handle notificationclick');

const icon = await request(app).get('/icons/icon-192.png').expect(200);
assert.match(icon.headers['content-type'], /image\/png/);

console.info('Production routing, security, PWA assets, and Web Push verification passed.');
