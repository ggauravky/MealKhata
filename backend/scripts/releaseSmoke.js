import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function exactOrigin(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === value
      && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch { return false; }
}

export function parseSmokeTargets(argv, environment = process.env) {
  const expected = argv.includes('--expect-unready') ? 5 : 4;
  if (argv.length !== expected || argv.filter(value => value === '--backend-url').length !== 1
    || argv.filter(value => value === '--frontend-url').length !== 1
    || argv.filter(value => value === '--expect-unready').length > 1) {
    throw new Error('Provide one --backend-url and one --frontend-url');
  }
  const option = name => {
    const at = argv.indexOf(name);
    return at < 0 ? null : argv[at + 1];
  };
  const backendOrigin = option('--backend-url');
  const frontendOrigin = option('--frontend-url');
  if (!backendOrigin) throw new Error('--backend-url is required');
  if (!frontendOrigin) throw new Error('--frontend-url is required');
  if (!exactOrigin(backendOrigin) || !exactOrigin(frontendOrigin)
    || (environment.NODE_ENV === 'production'
      && (!backendOrigin.startsWith('https://') || !frontendOrigin.startsWith('https://')))) {
    throw new Error('Smoke targets must be exact approved origins without credentials or paths');
  }
  const allowed = new Set(['--backend-url', '--frontend-url', '--expect-unready']);
  if (argv.some(argument => argument.startsWith('--') && !allowed.has(argument))) {
    throw new Error('Unknown release smoke option');
  }
  return { backendOrigin, frontendOrigin, expectUnready: argv.includes('--expect-unready') };
}

export function buildSmokeChecks({ backendOrigin, frontendOrigin, expectUnready = false }) {
  const ready = { name: expectUnready ? 'Negative Readiness' : 'Readiness',
    url: `${backendOrigin}/api/ready`, expectedStatus: expectUnready ? 503 : 200,
    verify: async response => {
      const body = await response.json();
      assert.equal(body.success, !expectUnready);
      if (expectUnready) assert.ok(['unavailable', 'draining'].includes(body.status));
      else assert.equal(body.status, 'ready');
    } };
  if (expectUnready) return [ready];
  const page = route => ({ name: `SPA ${route === '/' ? 'Root' : route}`,
    url: `${frontendOrigin}${route}`, expectedStatus: 200,
    verify: async response => assert.ok((await response.text()).includes('id="root"')) });
  return [
    { name: 'Liveness', url: `${backendOrigin}/api/health`, expectedStatus: 200,
      verify: async response => {
        const body = await response.json();
        assert.equal(body.success, true);
        assert.equal(body.service, 'MealKhata');
        assert.equal(body.status, 'ok');
        assert.ok(body.version);
      } },
    ready,
    { name: 'PWA Manifest', url: `${frontendOrigin}/manifest.webmanifest`, expectedStatus: 200,
      verify: async response => {
        const body = await response.json();
        assert.equal(body.name, 'MealKhata');
        assert.equal(body.display, 'standalone');
        assert.ok(Array.isArray(body.icons) && body.icons.length >= 2);
      } },
    { name: 'Service Worker', url: `${frontendOrigin}/sw.js`, expectedStatus: 200,
      verify: async response => {
        const body = await response.text();
        assert.ok(body.includes('CACHE_NAME') || body.includes('mealkhata-shell-v1'));
        assert.ok(body.includes('SKIP_WAITING'));
      } },
    ...['/', '/calendar', '/reports', '/payments', '/login'].map(page),
    { name: 'API 404 Boundary', url: `${backendOrigin}/api/unknown-endpoint`, expectedStatus: 404,
      verify: async response => assert.equal((await response.json()).success, false) },
    { name: 'Sensitive Dotfile Protection', url: `${frontendOrigin}/.env`, expectedStatus: [200, 403, 404],
      verify: async response => {
        const body = await response.text();
        assert.ok(!body.includes('AUTH_JWT_SECRET') && !body.includes('MONGODB_URI'));
        if (response.status === 200) assert.ok(body.includes('id="root"'));
      } },
  ];
}

export async function runReleaseSmoke(targets, { fetchImpl = fetch, log = console.log } = {}) {
  let failed = 0;
  for (const check of buildSmokeChecks(targets)) {
    try {
      const response = await fetchImpl(check.url);
      assert.ok((Array.isArray(check.expectedStatus) ? check.expectedStatus : [check.expectedStatus])
        .includes(response.status));
      await check.verify(response);
      log(`${check.name}: PASS (${response.status})`);
    } catch {
      failed += 1;
      log(`${check.name}: FAIL`);
    }
  }
  log(`Smoke summary: ${failed} failed`);
  return failed === 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const targets = parseSmokeTargets(process.argv.slice(2));
    if (!await runReleaseSmoke(targets)) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
