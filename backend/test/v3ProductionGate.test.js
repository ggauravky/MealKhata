import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { validateProductionCutoverPlan, verifyProductionActionApproval } from '../src/migrations/v3ProductionGate.service.js';

const identity = (clusterId, databaseName, replicaSet) => ({ clusterId, databaseName, replicaSet });
const allowlist = {
  source: identity('atlas-cluster-source', 'mealkhata_v2', 'source-rs'),
  recovery: identity('atlas-cluster-recovery', 'mealkhata_v2_recovery', 'recovery-rs'),
  target: identity('atlas-cluster-target', 'mealkhata_v3', 'target-rs'),
};
const plan = {
  format: 'mealkhata-v3-production-cutover-plan-v1',
  source: allowlist.source, recovery: allowlist.recovery, target: allowlist.target,
  sourceArchiveSha256: 'a'.repeat(64), frozenArchiveSha256: 'b'.repeat(64),
  financialStartDate: '2026-12-01',
};

test('offline production gate binds three exact independent database identities', () => {
  const result = validateProductionCutoverPlan({ plan, trustedAllowlist: allowlist,
    observedIdentities: structuredClone(allowlist) });
  assert.match(result.planDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.source.databaseName, 'mealkhata_v2');
  assert.equal(JSON.stringify(result).includes('mongodb'), false);
});

test('offline production gate rejects swapped clusters, overlapping identities and URI material', () => {
  assert.throws(() => validateProductionCutoverPlan({ plan, trustedAllowlist: allowlist,
    observedIdentities: { ...allowlist, target: allowlist.source } }), /target.*identity/i);
  assert.throws(() => validateProductionCutoverPlan({ plan: { ...plan, target: allowlist.source },
    trustedAllowlist: { ...allowlist, target: allowlist.source },
    observedIdentities: { ...allowlist, target: allowlist.source } }), /distinct/i);
  assert.throws(() => validateProductionCutoverPlan({ plan: { ...plan, mongoUri: 'mongodb+srv://private.example/db' },
    trustedAllowlist: allowlist, observedIdentities: allowlist }), /unexpected|secret|URI/i);
  assert.throws(() => validateProductionCutoverPlan({ plan, observedIdentities: allowlist }), /allowlist/i);
});

test('each production action requires distinct valid owner and operator signatures', () => {
  const approved = validateProductionCutoverPlan({ plan, trustedAllowlist: allowlist,
    observedIdentities: allowlist });
  const owner = generateKeyPairSync('ed25519');
  const operator = generateKeyPairSync('ed25519');
  const expiresAt = '2026-12-01T12:00:00.000Z';
  const action = 'create-target';
  const payload = `${approved.planDigest}\n${action}\n${expiresAt}\nnonce-1`;
  const approval = { planDigest: approved.planDigest, action, expiresAt, nonce: 'nonce-1',
    signatures: [
      { role: 'owner', signerId: 'owner-one', signature: sign(null, Buffer.from(payload), owner.privateKey).toString('base64') },
      { role: 'operator', signerId: 'operator-two', signature: sign(null, Buffer.from(payload), operator.privateKey).toString('base64') },
    ] };
  const trustedSigners = { owner: { 'owner-one': owner.publicKey },
    operator: { 'operator-two': operator.publicKey } };
  assert.equal(verifyProductionActionApproval({ approval, planDigest: approved.planDigest,
    action, trustedSigners, now: new Date('2026-11-30T12:00:00.000Z') }), true);
  assert.throws(() => verifyProductionActionApproval({ approval, planDigest: approved.planDigest,
    action: 'switch-connection', trustedSigners, now: new Date('2026-11-30T12:00:00.000Z') }), /action/i);
  assert.throws(() => verifyProductionActionApproval({ approval, planDigest: approved.planDigest,
    action, trustedSigners, now: new Date('2026-12-02T12:00:00.000Z') }), /expired/i);
  assert.throws(() => verifyProductionActionApproval({ approval: { ...approval, signatures: [approval.signatures[0]] },
    planDigest: approved.planDigest, action, trustedSigners,
    now: new Date('2026-11-30T12:00:00.000Z') }), /owner.*operator/i);
});
