import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSmokeChecks, parseSmokeTargets, runReleaseSmoke } from '../scripts/releaseSmoke.js';
import { releaseGateSummary } from '../scripts/releaseCheck.js';

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

test('release check reports code checks without claiming production approval', () => {
  const summary = releaseGateSummary({ codeQualityPassed: true, isolatedMigrationPassed: true });
  assert.equal(summary.codeQuality, 'verified');
  assert.equal(summary.isolatedMigration, 'verified');
  assert.equal(summary.productionSourceEvidence, 'pending');
  assert.equal(summary.ownerApproval, 'pending');
  assert.equal(summary.cutoverAuthorized, false);
  assert.ok(!JSON.stringify(summary).includes('ready for production'));
});
