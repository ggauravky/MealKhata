import { checksumValue } from '../sourceInventory.service.js';
import { RELEASE_STEP_CONTRACTS } from './releaseStepRegistry.js';

const SHA = /^[a-f0-9]{64}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const FIELDS = ['kind', 'action', 'providerId', 'credentialPrincipal',
  'credentialPrivileges', 'resourceDigests', 'operations', 'checkpointVerifierId'];
const RENDER_FIELDS = ['revisionSha256', 'targetIdentitySha256', 'protectedConfigSha256',
  'jwtKeySha256', 'previousJwtKeySha256', 'previousReleaseSha256',
  'canonicalOnlyAuth', 'cookieSecure', 'corsOriginsSha256',
  'websocketOriginsSha256', 'readinessPassed', 'oldWritersDisabled',
  'rollbackConfigVerified'];
const VERCEL_FLOWS = ['login', 'session', 'students', 'dashboard', 'calendar',
  'historicalReports', 'pdf', 'csv', 'messPayments', 'roomFees', 'expenses', 'mobile'];
const VERCEL_FIELDS = ['buildSha256', 'apiRewriteSha256', 'backendOriginSha256',
  'browserFlowResults'];
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const sameSet = (value, expected) => Array.isArray(value)
  && value.length === expected.length && new Set(value).size === expected.length
  && [...value].sort().every((item, index) => item === [...expected].sort()[index]);

/** Review artifact only. It has no run method, secret, URL, API client or activation switch. */
export function createDormantProductionProviderCatalog({ trustedResourceDigests,
  trustedCapabilities, descriptors }) {
  const actions = Object.keys(RELEASE_STEP_CONTRACTS)
    .filter(action => !RELEASE_STEP_CONTRACTS[action].approvalOnly);
  if (!Array.isArray(descriptors) || descriptors.length !== actions.length
    || !exact(trustedCapabilities, actions)
    || !trustedResourceDigests || typeof trustedResourceDigests !== 'object'
    || new Set(descriptors.map(item => item?.action)).size !== actions.length) {
    throw new Error('Production provider review requires one distinct descriptor per action');
  }
  const reviewed = [];
  for (const descriptor of descriptors) {
    const contract = RELEASE_STEP_CONTRACTS[descriptor?.action];
    const trusted = trustedCapabilities[descriptor?.action];
    if (!contract || contract.approvalOnly || !exact(descriptor, FIELDS)
      || descriptor.kind !== 'review-only' || !exact(trusted, FIELDS.slice(1))
      || !SAFE.test(descriptor.providerId ?? '')
      || !SAFE.test(descriptor.credentialPrincipal ?? '')
      || !SAFE.test(descriptor.checkpointVerifierId ?? '')
      || !sameSet(descriptor.operations, contract.operations)
      || !sameSet(descriptor.credentialPrivileges, trusted.credentialPrivileges)
      || !sameSet(descriptor.operations, trusted.operations)
      || descriptor.providerId !== trusted.providerId
      || descriptor.credentialPrincipal !== trusted.credentialPrincipal
      || descriptor.checkpointVerifierId !== trusted.checkpointVerifierId) {
      throw new Error('Production provider action, credential privilege or operation scope differs');
    }
    if (!exact(descriptor.resourceDigests, contract.resources)
      || !exact(trusted.resourceDigests, contract.resources)
      || contract.resources.some(resource => !SHA.test(trustedResourceDigests[resource] ?? '')
        || descriptor.resourceDigests[resource] !== trustedResourceDigests[resource]
        || trusted.resourceDigests[resource] !== trustedResourceDigests[resource])) {
      throw new Error('Production provider resource identity differs from trusted review scope');
    }
    reviewed.push(structuredClone(descriptor));
  }
  reviewed.sort((a, b) => a.action.localeCompare(b.action));
  return Object.freeze({ runnable: false, actionCount: reviewed.length,
    reviewSha256: checksumValue(reviewed),
    actions: Object.freeze(reviewed.map(item => Object.freeze({ action: item.action,
      providerId: item.providerId, credentialPrincipal: item.credentialPrincipal,
      checkpointVerifierId: item.checkpointVerifierId }))) });
}

/** Validate a mock or independently signed Render observation; this performs no deployment. */
export function verifyRenderReleaseObservation({ expected, observed }) {
  const expectedFields = ['revisionSha256', 'targetIdentitySha256',
    'protectedConfigSha256', 'previousReleaseSha256', 'corsOriginsSha256',
    'websocketOriginsSha256'];
  if (!exact(expected, expectedFields) || !exact(observed, RENDER_FIELDS)
    || expectedFields.some(field => !SHA.test(expected[field] ?? '')
      || observed[field] !== expected[field])
    || !SHA.test(observed.jwtKeySha256 ?? '')
    || !SHA.test(observed.previousJwtKeySha256 ?? '')
    || observed.jwtKeySha256 === observed.previousJwtKeySha256
    || observed.canonicalOnlyAuth !== true || observed.cookieSecure !== true
    || observed.readinessPassed !== true || observed.oldWritersDisabled !== true
    || observed.rollbackConfigVerified !== true) {
    throw new Error('Render revision, target identity, JWT key or protected configuration is unverified');
  }
  return Object.freeze({ passed: true, observationSha256: checksumValue(observed) });
}

/** Validate a mock or independently signed Vercel observation; this performs no deployment. */
export function verifyVercelReleaseObservation({ expected, observed }) {
  const expectedFields = ['buildSha256', 'apiRewriteSha256', 'backendOriginSha256'];
  if (!exact(expected, expectedFields) || !exact(observed, VERCEL_FIELDS)
    || expectedFields.some(field => !SHA.test(expected[field] ?? '')
      || observed[field] !== expected[field])
    || !exact(observed.browserFlowResults, VERCEL_FLOWS)
    || VERCEL_FLOWS.some(flow => observed.browserFlowResults[flow] !== true)) {
    throw new Error('Vercel immutable build, API route or browser flow is unverified');
  }
  return Object.freeze({ passed: true, observationSha256: checksumValue(observed) });
}
