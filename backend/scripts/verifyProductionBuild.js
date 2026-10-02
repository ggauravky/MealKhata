import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDirectory, '../..');
const frontendIndex = path.resolve(rootDir, 'frontend/dist/index.html');
const testPassword = 'production-routing-test-password';

const TEST_VAPID_PUBLIC = 'BJbDuUOYPV_SKaCeyfH2dlWPLf8kcIHnrTa9o0nysfvVsF4gZ0C1WCGNzkZV0mS_uD--NF2LcpVudwBtaVL5C-k';
const TEST_VAPID_PRIVATE = 'IHQOSikGfyUGgWEhb7GEhykuSmcMz5I_W_k0nCZjgpk';
const TEST_VAPID_SUBJECT = 'mailto:admin@mealkhata.production';

// Common baseline production env
const baseEnv = {
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
};

// 1. Verify Vercel Split Deployment Configuration (Requirement 47)
console.info('--- Verifying Vercel & Split Deployment Configuration ---');
const vercelConfigPath = path.resolve(rootDir, 'vercel.json');
const vercelConfigRaw = await fs.readFile(vercelConfigPath, 'utf8');
const vercelConfig = JSON.parse(vercelConfigRaw);

assert.equal(vercelConfig.framework, 'vite');
assert.equal(vercelConfig.installCommand, 'npm ci');
assert.equal(vercelConfig.buildCommand, 'npm run build --workspace frontend');
assert.equal(vercelConfig.outputDirectory, 'frontend/dist');

assert.ok(Array.isArray(vercelConfig.rewrites), 'vercel.json must define rewrites');
const apiRewriteIdx = vercelConfig.rewrites.findIndex((r) => r.source === '/api/:path*');
const spaFallbackIdx = vercelConfig.rewrites.findIndex((r) => r.source === '/(.*)');

assert.ok(apiRewriteIdx !== -1, 'vercel.json must define /api/:path* rewrite');
assert.ok(spaFallbackIdx !== -1, 'vercel.json must define SPA fallback rewrite');
assert.ok(apiRewriteIdx < spaFallbackIdx, '/api/:path* rewrite must precede /(.*) fallback');

const apiDestination = vercelConfig.rewrites[apiRewriteIdx].destination;
assert.match(
  apiDestination,
  /^https:\/\/[^/]+\.onrender\.com\/api\/:path\*$/,
  'API rewrite destination must target HTTPS Render origin without trailing slash',
);
assert.equal(vercelConfig.rewrites[spaFallbackIdx].destination, '/index.html', 'SPA fallback must route to /index.html');

const apiHeaderRule = vercelConfig.headers?.find((h) => h.source === '/api/:path*');
assert.ok(apiHeaderRule, 'vercel.json must define Cache-Control header for /api/:path*');
const apiCacheHeader = apiHeaderRule.headers?.find((h) => h.key.toLowerCase() === 'cache-control');
assert.equal(apiCacheHeader?.value, 'no-store', 'API header rule must be Cache-Control: no-store');

// Verify Socket client and frontend environment template
const frontendSocketJs = await fs.readFile(path.resolve(rootDir, 'frontend/src/lib/socket.js'), 'utf8');
assert.ok(frontendSocketJs.includes('VITE_SOCKET_URL'), 'frontend socket.js must support VITE_SOCKET_URL');

const frontendEnvEx = await fs.readFile(path.resolve(rootDir, 'frontend/.env.example'), 'utf8');
assert.ok(frontendEnvEx.includes('VITE_SOCKET_URL'), 'frontend/.env.example must document VITE_SOCKET_URL');

// Verify render.yaml for backend-only deployment
const renderYaml = await fs.readFile(path.resolve(rootDir, 'render.yaml'), 'utf8');
assert.ok(renderYaml.includes('name: meal-khata-api'), 'render.yaml must name backend service meal-khata-api');
assert.ok(renderYaml.includes('buildCommand: npm ci --omit=dev'), 'render.yaml must use backend-only buildCommand');
assert.ok(renderYaml.includes('startCommand: npm run start --workspace backend'), 'render.yaml must start backend workspace');
assert.ok(renderYaml.includes('healthCheckPath: /api/ready'), 'render.yaml must probe /api/ready');
assert.ok(!renderYaml.includes('ADMIN_EMAIL'), 'render.yaml must not require legacy admin email');

console.info('Vercel and Render configuration verified.');

console.info('--- Running Production Verification: MODE B (VAPID Configured) ---');
Object.assign(process.env, {
  ...baseEnv,
  VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC,
  VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE,
  VAPID_SUBJECT: TEST_VAPID_SUBJECT,
});

const { createApp } = await import('../src/app.js');
const app = createApp();

// Render Root Route returns minimal JSON (Requirement 60)
const rootRes = await request(app).get('/');
assert.equal(rootRes.status, 200);
assert.match(rootRes.headers['content-type'], /application\/json/);
assert.equal(rootRes.body.service, 'MealKhata API');
assert.equal(rootRes.body.status, 'running');

// Render backend does NOT serve SPA routes (Requirement 13 & 46)
for (const route of ['/calendar', '/reports', '/payments', '/login', '/admin']) {
  const response = await request(app).get(route).set('Accept', 'text/html');
  assert.equal(response.status, 404, `Render backend must not serve SPA route ${route}`);
  assert.match(response.headers['content-type'], /application\/json/);
}

// API 404 boundary returns JSON
const apiNotFound = await request(app).get('/api/not-real').set('Accept', 'text/html');
assert.equal(apiNotFound.status, 404);
assert.match(apiNotFound.headers['content-type'], /application\/json/);

const socketNotFound = await request(app).get('/socket.io/not-real').set('Accept', 'text/html');
assert.equal(socketNotFound.status, 404);
assert.match(socketNotFound.headers['content-type'], /application\/json/);

// Auth login sets secure host-only cookie
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
assert.ok(!cookie.toLowerCase().includes('domain='), 'cookie must be host-only');
assert.ok(login.headers['strict-transport-security']);
assert.ok(login.headers['x-request-id'], 'response must include X-Request-ID');

// Health endpoint
const healthRes = await request(app).get('/api/health').expect(200);
assert.equal(healthRes.body.success, true);
assert.equal(healthRes.body.service, 'MealKhata');
assert.equal(healthRes.body.status, 'ok');
assert.ok(typeof healthRes.body.uptimeSeconds === 'number');
assert.ok(!JSON.stringify(healthRes.body).includes('mongodb'));

// Malformed JSON handling
const badJson = await request(app)
  .post('/api/payments')
  .set('Origin', process.env.APP_ORIGIN)
  .set('Content-Type', 'application/json')
  .send('{invalid-json-payload')
  .expect(400);
assert.equal(badJson.body.message, 'Invalid JSON payload');

// Dotfile protection
const dotEnvRes = await request(app).get('/.env').set('Accept', 'text/html').expect(404);
assert.ok(!dotEnvRes.text.includes('AUTH_JWT_SECRET'));

// Lifecycle draining check
const { LIFECYCLE_STATES, setLifecycleState } = await import('../src/config/lifecycle.js');
setLifecycleState(LIFECYCLE_STATES.DRAINING);
const drainingRes = await request(app).get('/api/ready').expect(503);
assert.equal(drainingRes.body.status, 'draining');
setLifecycleState(LIFECYCLE_STATES.STARTING);

await request(app)
  .post('/api/auth/logout')
  .set('Origin', 'https://foreign.example')
  .expect(403);

// Push endpoint with VAPID configured
const pushPublicKeyRes = await request(app).get('/api/push/public-key').expect(200);
assert.equal(pushPublicKeyRes.body.success, true);
assert.equal(pushPublicKeyRes.body.enabled, true);
assert.equal(pushPublicKeyRes.body.publicKey, TEST_VAPID_PUBLIC);
assert.ok(!JSON.stringify(pushPublicKeyRes.body).includes(TEST_VAPID_PRIVATE), 'private key must never be exposed');

// Push registration authorization checks
await request(app)
  .post('/api/push/subscriptions')
  .set('Origin', process.env.APP_ORIGIN)
  .send({ subscription: { endpoint: 'https://push.example' } })
  .expect(401);

await request(app)
  .post('/api/push/subscriptions')
  .set('Origin', process.env.APP_ORIGIN)
  .set('Cookie', cookie)
  .send({ subscription: { endpoint: 'https://push.example' } })
  .expect(403);

// Settlement endpoint checks
await request(app).get('/api/settlements/invalid-month').expect(400);
await request(app).post('/api/settlements/2026-09/close').expect(403);
await request(app).post('/api/settlements/2026-09/reopen').expect(403);
await request(app).get('/api/settlements/2026-09/statement.pdf').expect(401);
await request(app).get('/api/settlements/2026-09/statement.csv').expect(401);

// Frontend PWA build artifacts verification in frontend/dist (Requirement 44 & 48)
const html = await fs.readFile(frontendIndex, 'utf8');
assert.ok(html.includes('id="root"'), 'built index.html must have root element for SPA mount');
const assetPath = html.match(/\/assets\/[^"]+\.js/)?.[0];
assert.ok(assetPath, 'built JavaScript asset reference was not found in index.html');

const manifestContent = await fs.readFile(path.resolve(rootDir, 'frontend/dist/manifest.webmanifest'), 'utf8');
const manifest = JSON.parse(manifestContent);
assert.equal(manifest.name, 'MealKhata');
assert.equal(manifest.display, 'standalone');

const sw = await fs.readFile(path.resolve(rootDir, 'frontend/dist/sw.js'), 'utf8');
assert.ok(!sw.includes('AUTH_JWT_SECRET'), 'service worker must not contain secrets');
assert.ok(!sw.includes(TEST_VAPID_PRIVATE), 'service worker must not contain VAPID private key');
assert.ok(sw.includes("self.addEventListener('push'"), 'service worker must handle push event');
assert.ok(sw.includes("self.addEventListener('notificationclick'"), 'service worker must handle notificationclick');

const iconStat = await fs.stat(path.resolve(rootDir, 'frontend/dist/icons/icon-192.png'));
assert.ok(iconStat.size > 0, 'icon-192.png must exist');

console.info('MODE B verification passed.');

// MODE A: No VAPID Variables
console.info('--- Running Production Verification: MODE A (No VAPID Configured) ---');
const { createPushRouter } = await import('../src/routes/push.routes.js');
const unconfiguredPushRouter = createPushRouter({ isConfigured: false, publicKey: null });
const appModeA = createApp({ push: unconfiguredPushRouter });

const modeAPushRes = await request(appModeA).get('/api/push/public-key').expect(200);
assert.equal(modeAPushRes.body.success, true);
assert.equal(modeAPushRes.body.enabled, false);
assert.equal(modeAPushRes.body.publicKey, null);

const modeALogin = await request(appModeA)
  .post('/api/auth/login')
  .set('Origin', process.env.APP_ORIGIN)
  .send({ email: process.env.ADMIN_EMAIL, password: testPassword });
assert.equal(modeALogin.status, 200);

await request(appModeA).get('/api/settlements/invalid-month').expect(400);

console.info('MODE A verification passed.');
console.info('All production build checks, security boundaries, statements, and dual-mode push verification passed.');
