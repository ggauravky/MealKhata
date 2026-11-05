import { verify } from 'node:crypto';
import { isValidLogicalDate } from '../utils/date.js';
import { checksumValue } from './sourceInventory.service.js';

const PLAN_FIELDS = new Set(['format', 'source', 'recovery', 'target',
  'sourceArchiveSha256', 'frozenArchiveSha256', 'financialStartDate']);
const ROLES = ['source', 'recovery', 'target'];
const ID_FIELDS = new Set(['clusterId', 'databaseName', 'replicaSet']);
const ACTIONS = new Set(['read-source-inventory', 'archive-source', 'restore-recovery',
  'create-target', 'apply-history', 'freeze-source-writes', 'archive-frozen-source', 'replay-final-meals',
  'configure-financial-boundary', 'configure-operations', 'deploy-backend',
  'deploy-frontend', 'switch-connection', 'open-writes', 'rollback-connection']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function exactIdentity(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !ID_FIELDS.has(key))
    || [...ID_FIELDS].some(key => !SAFE_ID.test(value[key] ?? ''))) {
    throw new Error(`${label} requires exact cluster, database and replica-set identity fields`);
  }
  return Object.fromEntries([...ID_FIELDS].map(key => [key, value[key]]));
}

/** Offline validation only. This function has no network or database connector. */
export function validateProductionCutoverPlan({ plan, trustedAllowlist, observedIdentities }) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)
    || Object.keys(plan).some(key => !PLAN_FIELDS.has(key))
    || plan.format !== 'mealkhata-v3-production-cutover-plan-v1') {
    throw new Error('Unexpected production cutover plan format or fields');
  }
  if (!trustedAllowlist || !observedIdentities
    || Object.keys(trustedAllowlist).length !== 3 || Object.keys(observedIdentities).length !== 3) {
    throw new Error('Independent trusted allowlist and observed identities are required');
  }
  if (!SHA256.test(plan.sourceArchiveSha256 ?? '') || !SHA256.test(plan.frozenArchiveSha256 ?? '')
    || !isValidLogicalDate(plan.financialStartDate)) {
    throw new Error('Archive fingerprints and an explicitly approved future boundary are required');
  }
  const identities = {};
  for (const role of ROLES) {
    const planned = exactIdentity(plan[role], `${role} plan`);
    const allowed = exactIdentity(trustedAllowlist[role], `${role} allowlist`);
    const observed = exactIdentity(observedIdentities[role], `${role} observation`);
    if (checksumValue(planned) !== checksumValue(allowed)
      || checksumValue(planned) !== checksumValue(observed)) {
      throw new Error(`${role} identity does not match the independent allowlist and observation`);
    }
    identities[role] = planned;
  }
  const unique = new Set(ROLES.map(role =>
    `${identities[role].clusterId}\n${identities[role].databaseName}`));
  if (unique.size !== 3) throw new Error('Source, recovery and target database identities must be distinct');
  return { planDigest: checksumValue(plan), ...identities,
    sourceArchiveSha256: plan.sourceArchiveSha256,
    frozenArchiveSha256: plan.frozenArchiveSha256,
    financialStartDate: plan.financialStartDate };
}

/** Verifies a single action approval; execution must separately record nonce consumption. */
export function verifyProductionActionApproval({ approval, planDigest, action, trustedSigners, now = new Date() }) {
  if (!ACTIONS.has(action) || !approval || approval.action !== action) {
    throw new Error('Production action is not approved for this step');
  }
  if (!SHA256.test(planDigest ?? '') || approval.planDigest !== planDigest
    || typeof approval.nonce !== 'string' || !SAFE_ID.test(approval.nonce)
    || !Array.isArray(approval.signatures)) {
    throw new Error('Production approval is not bound to this plan and nonce');
  }
  const expiry = new Date(approval.expiresAt);
  if (Number.isNaN(expiry.getTime()) || expiry <= now) throw new Error('Production approval expired');
  if (!trustedSigners?.owner || !trustedSigners?.operator) {
    throw new Error('Independent owner and operator signing keys are required');
  }
  const payload = Buffer.from(`${planDigest}\n${action}\n${approval.expiresAt}\n${approval.nonce}`);
  const signerIds = new Set();
  for (const role of ['owner', 'operator']) {
    const signatures = approval.signatures.filter(signature => signature.role === role);
    if (signatures.length !== 1 || !trustedSigners[role][signatures[0].signerId]) {
      throw new Error('Production action requires distinct owner and operator signatures');
    }
    const { signerId, signature } = signatures[0];
    if (signerIds.has(signerId) || typeof signature !== 'string'
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)
      || !verify(null, payload, trustedSigners[role][signerId], Buffer.from(signature, 'base64'))) {
      throw new Error('Production action signature is invalid or not independent');
    }
    signerIds.add(signerId);
  }
  if (approval.signatures.length !== 2) throw new Error('Production action has unexpected signatures');
  return true;
}
