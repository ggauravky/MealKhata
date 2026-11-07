import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import { createAuthService } from '../src/auth/auth.service.js';
import { createSessionToken, verifySessionToken } from '../src/auth/token.service.js';
import { env, validateEnvironment } from '../src/config/env.js';
import { checksumValue } from '../src/migrations/sourceInventory.service.js';
import { checkV3ReleaseReadiness } from '../src/config/v3ReleaseReadiness.js';
import { createV3MutationGate } from '../src/middleware/v3MutationGate.js';
import { assertRuntimeDatabaseProfile } from '../src/config/runtimeDatabaseProfile.js';

const SHA = 'a'.repeat(64);

test('v3 runtime refuses missing, false and malformed canonical authentication without changing v2', () => {
  for (const canonicalOnlyAuth of [undefined, false, 'true', 'malformed']) {
    assert.throws(() => validateEnvironment({ ...env, runtimeProfile: 'v3', canonicalOnlyAuth }),
      /CANONICAL_ONLY_AUTH=true/);
  }
  assert.doesNotThrow(() => validateEnvironment({ ...env, runtimeProfile: 'v2', canonicalOnlyAuth: false }));
  assert.doesNotThrow(() => validateEnvironment({ ...env, runtimeProfile: 'v3',
    canonicalOnlyAuth: true, v3BuildSha: SHA, v3AttestationPath: 'test-only',
    observedBuildSha: SHA,
    v3OwnerPublicKey: 'test-only', v3OperatorPublicKey: 'test-only' }));
  assert.throws(() => validateEnvironment({ ...env, runtimeProfile: 'unknown' }), /runtime profile/);
  const v3 = { ...env, nodeEnv: 'production', runtimeProfile: 'v3', canonicalOnlyAuth: true,
    authJwtSecret: 'x'.repeat(48), appOrigin: 'https://mealkhata.example.test',
    v3BuildSha: SHA, observedBuildSha: SHA, v3AttestationPath: '/etc/secrets/attestation.json',
    v3OwnerPublicKey: 'test-only', v3OperatorPublicKey: 'test-only' };
  assert.throws(() => validateEnvironment({ ...v3,
    mongoUri: 'mongodb://db.example.test/mealkhata_v3' }), /TLS/);
  assert.doesNotThrow(() => validateEnvironment({ ...v3,
    mongoUri: 'mongodb://db.example.test/mealkhata_v3?tls=true' }));
});

test('v3 auth rejects legacy account, environment principal and legacy token even if a caller requests fallback', async () => {
  const password = 'correct horse battery staple';
  const passwordHash = await bcrypt.hash(password, 12);
  const userAccounts = { findByEmail: async () => null };
  const accounts = { findByEmail: async email => email === 'member@example.test'
    ? { memberId: 'gaurav', active: true, passwordHash } : null };
  const config = { ...env, runtimeProfile: 'v3', canonicalOnlyAuth: false,
    adminEmail: 'admin@example.test', adminPasswordHash: passwordHash };
  const service = createAuthService({ config, userAccounts, accounts });
  await assert.rejects(service.authenticateCredentials({ email: 'member@example.test', password }),
    /Invalid email or password/);
  await assert.rejects(service.authenticateCredentials({ email: config.adminEmail, password }),
    /Invalid email or password/);
  const legacy = await createSessionToken('admin');
  await assert.rejects(verifySessionToken(legacy, { canonicalOnly: false, runtimeProfile: 'v3',
    accounts: { findByUserId: async () => null } }), /Canonical session requires a userId/);
  const v2 = createAuthService({ config: { ...config, runtimeProfile: 'v2' },
    userAccounts, accounts });
  assert.equal((await v2.authenticateCredentials({ email: config.adminEmail, password })).role, 'admin');
});

test('a v3 target cannot boot under the v2 fallback profile', async () => {
  const db = marker => ({ collection: name => ({ findOne: async () =>
    name === 'v3_migration_manifests' ? marker : null }) });
  await assert.rejects(assertRuntimeDatabaseProfile({ config: { runtimeProfile: 'v2' },
    db: db({ migrationId: 'mealkhata-v3-blue-green', status: 'complete' }) }), /v3 target/);
  await assert.rejects(assertRuntimeDatabaseProfile({ config: { runtimeProfile: 'v3' },
    db: db(null) }), /complete v3 migration/);
  await assert.doesNotReject(assertRuntimeDatabaseProfile({ config: { runtimeProfile: 'v2' },
    db: db(null) }));
  await assert.doesNotReject(assertRuntimeDatabaseProfile({ config: { runtimeProfile: 'v3' },
    db: db({ migrationId: 'mealkhata-v3-blue-green', status: 'complete' }) }));
});

test('a separately initialized fresh v3 target boots only in the v3 profile', async () => {
  const db = { collection(name) {
    return { findOne: async () => name === 'v3_fresh_initializations'
      ? { initializationId: 'mealkhata-v3-fresh', status: 'complete' } : null };
  } };
  await assert.rejects(assertRuntimeDatabaseProfile({ config: { runtimeProfile: 'v2' }, db }), /v3 target/);
  await assert.doesNotReject(assertRuntimeDatabaseProfile({ config: { runtimeProfile: 'v3' }, db }));
});

test('v3 readiness requires signed release, exact target and manifest, indexes and live connection', async () => {
  const owner = generateKeyPairSync('ed25519');
  const operator = generateKeyPairSync('ed25519');
  const keys = {
    owner: owner.publicKey.export({ type: 'spki', format: 'pem' }),
    operator: operator.publicKey.export({ type: 'spki', format: 'pem' }),
  };
  const body = {
    format: 'mealkhata-v3-runtime-attestation-v1', releaseId: 'test-release',
    buildSha: SHA, targetDatabase: 'mealkhata_v3_test',
    targetClusterIdentity: checksumValue({ setName: 'rs-test', hosts: ['127.0.0.1:27017'] }),
    sourceChecksum: 'b'.repeat(64), sourceManifestChecksum: '1'.repeat(64),
    finalSourceChecksum: 'c'.repeat(64),
    recoveryEvidenceSha256: 'd'.repeat(64), migrationEvidenceSha256: 'e'.repeat(64),
    stageBPlanDigest: 'f'.repeat(64), launchStage: 'serving',
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const signed = () => ({ body, signatures: {
    owner: sign(null, Buffer.from(checksumValue(body)), owner.privateKey).toString('base64'),
    operator: sign(null, Buffer.from(checksumValue(body)), operator.privateKey).toString('base64'),
  } });
  const config = { ...env, runtimeProfile: 'v3', canonicalOnlyAuth: true,
    v3BuildSha: SHA, observedBuildSha: SHA, v3AttestationPath: 'test-only',
    v3OwnerPublicKey: keys.owner, v3OperatorPublicKey: keys.operator };
  const manifest = { migrationId: 'mealkhata-v3-blue-green', status: 'complete',
    sourceChecksum: body.sourceChecksum, finalSourceChecksum: body.finalSourceChecksum,
    sourceManifestChecksum: body.sourceManifestChecksum, targetClusterIdentity: body.targetClusterIdentity };
  const db = { databaseName: body.targetDatabase,
    collection: () => ({ findOne: async () => manifest }) };
  const options = { config, db, probe: async () => true,
    observeHandshake: async () => ({ setName: 'rs-test', hosts: ['127.0.0.1:27017'] }),
    inspectIndexes: async () => true, readAttestation: async () => JSON.stringify(signed()) };
  assert.equal(await checkV3ReleaseReadiness(options), true);
  assert.equal(await checkV3ReleaseReadiness({ ...options, requiredLaunchStage: 'serving' }), true);
  body.launchStage = 'read-only';
  assert.equal(await checkV3ReleaseReadiness(options), true, 'signed read-only stage may serve health');
  assert.equal(await checkV3ReleaseReadiness({ ...options, requiredLaunchStage: 'serving' }), false,
    'read-only stage must not permit writes');
  body.launchStage = 'serving';
  for (const [change, value] of [
    ['db', { ...db, databaseName: 'old_v2' }],
    ['db', { ...db, collection: () => ({ findOne: async () => null }) }],
    ['db', { ...db, collection: () => ({ findOne: async () => ({ ...manifest, sourceChecksum: SHA }) }) }],
    ['probe', async () => false],
    ['inspectIndexes', async () => false],
    ['config', { ...config, canonicalOnlyAuth: false }],
    ['config', { ...config, v3BuildSha: '0'.repeat(64) }],
    ['config', { ...config, observedBuildSha: '0'.repeat(64) }],
    ['observeHandshake', async () => ({ setName: 'other', hosts: ['127.0.0.1:27017'] })],
  ]) assert.equal(await checkV3ReleaseReadiness({ ...options, [change]: value }), false, change);
  const tampered = signed();
  tampered.body.recoveryEvidenceSha256 = SHA;
  assert.equal(await checkV3ReleaseReadiness({ ...options,
    readAttestation: async () => JSON.stringify(tampered) }), false);
  body.expiresAt = new Date(Date.now() - 1_000).toISOString();
  assert.equal(await checkV3ReleaseReadiness(options), false, 'expired attestation');
});

test('v3 mutation gate blocks writes until serving attestation and leaves v2 behavior intact', async () => {
  const responses = [];
  const res = { status(code) { this.code = code; return this; },
    json(body) { responses.push({ code: this.code, body }); return this; } };
  let passed = 0;
  const next = () => { passed += 1; };
  const v3 = createV3MutationGate({ config: { runtimeProfile: 'v3' },
    readiness: async () => false });
  await v3({ method: 'POST' }, res, next);
  assert.equal(responses[0].code, 503);
  await v3({ method: 'GET' }, res, next);
  assert.equal(passed, 1);
  const v2 = createV3MutationGate({ config: { runtimeProfile: 'v2' },
    readiness: async () => false });
  await v2({ method: 'POST' }, res, next);
  assert.equal(passed, 2);
  const serving = createV3MutationGate({ config: { runtimeProfile: 'v3' },
    readiness: async options => options.requiredLaunchStage === 'serving' });
  await serving({ method: 'POST' }, res, next);
  assert.equal(passed, 3);
  const draining = createV3MutationGate({ config: { runtimeProfile: 'v3' },
    readiness: async () => true, drainingCheck: () => true });
  await draining({ method: 'POST' }, res, next);
  assert.equal(responses.at(-1).code, 503, 'draining must close writes despite valid attestation');
  assert.equal(passed, 3);
});
