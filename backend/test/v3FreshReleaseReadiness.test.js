import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { checkV3ReleaseReadiness } from '../src/config/v3ReleaseReadiness.js';
import { checksumValue } from '../src/migrations/sourceInventory.service.js';

const SHA = 'a'.repeat(64);

test('fresh v3 release requires two signatures, exact empty-target initialization and active Super Admin', async () => {
  const owner = generateKeyPairSync('ed25519');
  const operator = generateKeyPairSync('ed25519');
  const clusterIdentity = checksumValue({ setName: 'rs-fresh', hosts: ['127.0.0.1:27017'] });
  const manifest = {
    initializationId: 'mealkhata-v3-fresh', status: 'complete',
    targetDatabase: 'mealkhata_v3_fresh', targetClusterIdentity: clusterIdentity,
    sourceDatabase: 'mealkhata', superAdminUserId: 'admin-1',
    superAdminEmail: 'owner@example.test', financialStartDate: '2026-11-07',
    createdAt: '2026-11-07T00:00:00.000Z',
  };
  const body = {
    format: 'mealkhata-v3-fresh-runtime-attestation-v1', releaseId: 'fresh-release',
    buildSha: SHA, targetDatabase: manifest.targetDatabase,
    targetClusterIdentity: clusterIdentity,
    initializationChecksum: checksumValue(manifest), launchStage: 'serving',
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const signed = () => ({ body, signatures: {
    owner: sign(null, Buffer.from(checksumValue(body)), owner.privateKey).toString('base64'),
    operator: sign(null, Buffer.from(checksumValue(body)), operator.privateKey).toString('base64'),
  } });
  const config = {
    runtimeProfile: 'v3', canonicalOnlyAuth: true, v3BuildSha: SHA,
    observedBuildSha: SHA, v3AttestationPath: 'test-only',
    v3OwnerPublicKey: owner.publicKey.export({ type: 'spki', format: 'pem' }),
    v3OperatorPublicKey: operator.publicKey.export({ type: 'spki', format: 'pem' }),
  };
  let adminActive = true;
  let boundaryDate = manifest.financialStartDate;
  const db = { databaseName: manifest.targetDatabase,
    collection(name) {
      return { findOne: async () => name === 'v3_fresh_initializations' ? manifest
        : name === 'user_accounts' && adminActive ? { userId: 'admin-1' }
          : name === 'system_settings' ? { financialStartDate: boundaryDate } : null };
    } };
  const options = { config, db, probe: async () => true,
    observeHandshake: async () => ({ setName: 'rs-fresh', hosts: ['127.0.0.1:27017'] }),
    inspectIndexes: async () => true, readAttestation: async () => JSON.stringify(signed()) };
  assert.equal(await checkV3ReleaseReadiness(options), true);
  assert.equal(await checkV3ReleaseReadiness({ ...options, requiredLaunchStage: 'serving' }), true);
  body.launchStage = 'read-only';
  assert.equal(await checkV3ReleaseReadiness({ ...options, requiredLaunchStage: 'serving' }), false);
  body.launchStage = 'serving';
  adminActive = false;
  assert.equal(await checkV3ReleaseReadiness(options), false);
  adminActive = true;
  boundaryDate = '2026-11-08';
  assert.equal(await checkV3ReleaseReadiness(options), false);
  boundaryDate = manifest.financialStartDate;
  manifest.superAdminUserId = 'changed';
  assert.equal(await checkV3ReleaseReadiness(options), false);
  manifest.superAdminUserId = 'admin-1';
  assert.equal(await checkV3ReleaseReadiness({ ...options,
    db: { ...db, databaseName: 'mealkhata' } }), false);
  const forged = signed();
  forged.signatures.operator = forged.signatures.owner;
  assert.equal(await checkV3ReleaseReadiness({ ...options,
    readAttestation: async () => JSON.stringify(forged) }), false);
});
