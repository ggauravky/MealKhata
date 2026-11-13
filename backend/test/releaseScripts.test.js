import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSmokeChecks, parseSmokeTargets, runReleaseSmoke } from '../scripts/releaseSmoke.js';
import { runReleaseCodeChecks } from '../scripts/releaseCheck.js';

test('release smoke requires explicit safe frontend and backend origins', () => {
  assert.throws(() => parseSmokeTargets([], { NODE_ENV: 'production' }), /backend-url/);
  assert.throws(() => parseSmokeTargets(['--backend-url', 'https://api.example.test'], {}), /frontend-url/);
  assert.throws(() => parseSmokeTargets(['--backend-url', 'https://api.example.test',
    '--backend-url', 'https://other.example.test', '--frontend-url', 'https://web.example.test'], {}), /one/);
  assert.throws(() => parseSmokeTargets(['--backend-url', 'https://secret:token@api.example.test',
    '--frontend-url', 'https://web.example.test'], {}), /origin/);
  const targets = parseSmokeTargets(['--backend-url', 'https://api.example.test',
    '--frontend-url', 'https://web.example.test'], {});
  const checks = buildSmokeChecks(targets);
  assert.equal(checks.find(item => item.name.includes('Readiness')).expectedStatus, 200);
  assert.equal(checks.find(item => item.name.includes('SPA Root')).url, 'https://web.example.test/');
  assert.equal(checks.find(item => item.name.includes('Liveness')).url, 'https://api.example.test/api/health');
  const negative = buildSmokeChecks({ ...targets, expectUnready: true });
  assert.equal(negative.length, 1);
  assert.equal(negative[0].expectedStatus, 503);
});

test('positive smoke fails on 503 readiness and does not log target URLs', async () => {
  const targets = { backendOrigin: 'https://api.example.test', frontendOrigin: 'https://web.example.test',
    expectUnready: false };
  const checks = buildSmokeChecks(targets);
  const lines = [];
  const fetchImpl = async url => {
    if (url.endsWith('/api/ready')) return { status: 503, json: async () => ({ success: false, status: 'unavailable' }) };
    return { status: 200, json: async () => ({ success: true, service: 'MealKhata', status: 'ok', version: '3' }),
      text: async () => '<div id="root"></div>MealKhata' };
  };
  assert.ok(checks.length > 2);
  assert.equal(await runReleaseSmoke(targets, { fetchImpl, log: line => lines.push(line) }), false);
  assert.ok(!lines.join(' ').includes('https://'));
  assert.equal(await runReleaseSmoke({ ...targets, expectUnready: true }, { fetchImpl,
    log: line => lines.push(line) }), true);
});

test('release check runs every local gate and does not claim production approval', () => {
  const commands = [];
  const summary = runReleaseCodeChecks({ run: (_cmd, args) => commands.push(args.join(' ')), log: () => {} });
  assert.deepEqual(commands, ['run lint', 'test', 'run build', 'run verify-production-build',
    'run security:check', 'run perf:check', 'run e2e:browser']);
  assert.equal(summary.codeQuality, 'verified');
  assert.ok(!JSON.stringify(summary).includes('production'));
});
