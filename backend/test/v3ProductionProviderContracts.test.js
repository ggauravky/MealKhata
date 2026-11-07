import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checksumValue } from '../src/migrations/sourceInventory.service.js';
import { RELEASE_STEP_CONTRACTS } from '../src/migrations/production/releaseStepRegistry.js';

const contractsModule = await import('../src/migrations/production/productionProviderContracts.js').catch(() => ({}));
const digest = letter => letter.repeat(64);
const identities = { source: digest('a'), recovery: digest('b'), target: digest('c'),
  control: digest('d'), 'protected-archive': digest('e'), 'render-writers': digest('f'),
  render: digest('1'), vercel: digest('2') };
const capability = action => ({ action, providerId: `provider-${action}`,
  credentialPrincipal: `principal-${action}`, credentialPrivileges: [...RELEASE_STEP_CONTRACTS[action].operations],
  resourceDigests: Object.fromEntries(RELEASE_STEP_CONTRACTS[action].resources
    .map(resource => [resource, identities[resource]])),
  operations: [...RELEASE_STEP_CONTRACTS[action].operations],
  checkpointVerifierId: `verifier-${action}` });

test('review-only production catalog binds one provider and exact resources to each action', () => {
  assert.equal(typeof contractsModule.createDormantProductionProviderCatalog, 'function');
  const actions = Object.keys(RELEASE_STEP_CONTRACTS).filter(action =>
    !RELEASE_STEP_CONTRACTS[action].approvalOnly);
  const trustedCapabilities = Object.fromEntries(actions.map(action => [action, capability(action)]));
  const descriptors = actions.map(action => ({ kind: 'review-only', ...capability(action) }));
  const catalog = contractsModule.createDormantProductionProviderCatalog({
    trustedResourceDigests: identities, trustedCapabilities, descriptors });
  assert.equal(catalog.runnable, false);
  assert.equal(catalog.actionCount, actions.length);
  assert.match(catalog.reviewSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(catalog).includes('principal-read-source-inventory'), true);
  assert.equal(typeof catalog.execute, 'undefined');
  assert.throws(() => contractsModule.createDormantProductionProviderCatalog({
    trustedResourceDigests: identities, trustedCapabilities,
    descriptors: descriptors.map(item => item.action === 'archive-source'
      ? { ...item, resourceDigests: { ...item.resourceDigests, source: digest('9') } } : item) }),
  /resource|identity|scope/i);
  assert.throws(() => contractsModule.createDormantProductionProviderCatalog({
    trustedResourceDigests: identities, trustedCapabilities,
    descriptors: [...descriptors, descriptors[0]] }), /duplicate|action/i);
  assert.throws(() => contractsModule.createDormantProductionProviderCatalog({
    trustedResourceDigests: identities, trustedCapabilities,
    descriptors: descriptors.map(item => item.action === 'deploy-backend'
      ? { ...item, credentialPrivileges: [...item.credentialPrivileges, 'shell'] } : item) }),
  /privilege|scope|credential/i);
});

test('Render and Vercel observations reject substituted revisions, target and unverified browser flows', () => {
  assert.equal(typeof contractsModule.verifyRenderReleaseObservation, 'function');
  assert.equal(typeof contractsModule.verifyVercelReleaseObservation, 'function');
  const render = { revisionSha256: digest('3'), targetIdentitySha256: digest('c'),
    protectedConfigSha256: digest('4'), jwtKeySha256: digest('5'),
    previousJwtKeySha256: digest('6'), previousReleaseSha256: digest('7'),
    canonicalOnlyAuth: true, cookieSecure: true, corsOriginsSha256: digest('8'),
    websocketOriginsSha256: digest('9'), readinessPassed: true,
    oldWritersDisabled: true, rollbackConfigVerified: true };
  const renderExpected = { revisionSha256: render.revisionSha256,
    targetIdentitySha256: render.targetIdentitySha256,
    protectedConfigSha256: render.protectedConfigSha256,
    previousReleaseSha256: render.previousReleaseSha256,
    corsOriginsSha256: render.corsOriginsSha256,
    websocketOriginsSha256: render.websocketOriginsSha256 };
  assert.equal(contractsModule.verifyRenderReleaseObservation({ expected: renderExpected,
    observed: render }).passed, true);
  assert.throws(() => contractsModule.verifyRenderReleaseObservation({ expected: renderExpected,
    observed: { ...render, targetIdentitySha256: digest('0') } }), /identity|target/i);
  assert.throws(() => contractsModule.verifyRenderReleaseObservation({ expected: renderExpected,
    observed: { ...render, jwtKeySha256: render.previousJwtKeySha256 } }), /jwt|key/i);
  const flows = ['login', 'session', 'students', 'dashboard', 'calendar', 'historicalReports',
    'pdf', 'csv', 'messPayments', 'roomFees', 'expenses', 'mobile'];
  const vercel = { buildSha256: digest('a'), apiRewriteSha256: digest('b'),
    backendOriginSha256: digest('c'), browserFlowResults: Object.fromEntries(flows
      .map(flow => [flow, true])) };
  const vercelExpected = { buildSha256: vercel.buildSha256,
    apiRewriteSha256: vercel.apiRewriteSha256,
    backendOriginSha256: vercel.backendOriginSha256 };
  assert.equal(contractsModule.verifyVercelReleaseObservation({ expected: vercelExpected,
    observed: vercel }).passed, true);
  assert.throws(() => contractsModule.verifyVercelReleaseObservation({ expected: vercelExpected,
    observed: { ...vercel, browserFlowResults: { ...vercel.browserFlowResults, csv: false } } }),
  /browser|csv|flow/i);
  assert.throws(() => contractsModule.verifyVercelReleaseObservation({ expected: vercelExpected,
    observed: { ...vercel, buildSha256: digest('0') } }), /build|immutable/i);
  assert.equal(checksumValue(vercelExpected).length, 64);
});
