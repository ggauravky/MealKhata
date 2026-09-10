import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendIndex = path.resolve(currentDirectory, '../../frontend/dist/index.html');
const testPassword = 'production-routing-test-password';

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

const html = await fs.readFile(frontendIndex, 'utf8');
const assetPath = html.match(/\/assets\/[^"]+\.js/)?.[0];
assert.ok(assetPath, 'built JavaScript asset was not found');
const asset = await request(app).get(assetPath).expect(200);
assert.match(asset.headers['cache-control'], /max-age=31536000/);
assert.match(asset.headers['cache-control'], /immutable/);

console.info('Production routing and security smoke passed.');
