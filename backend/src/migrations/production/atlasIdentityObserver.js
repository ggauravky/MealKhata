import { checksumValue } from '../sourceInventory.service.js';

const ROLES = Object.freeze(['source', 'recovery', 'target', 'control']);
const FIELDS = Object.freeze(['projectId', 'clusterId', 'databaseName', 'replicaSet',
  'endpointIdentity', 'principal', 'expectedPrivileges']);
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const PLAN_FIELDS = Object.freeze(['clusterId', 'databaseName', 'replicaSet']);
const FORBIDDEN = new Set(['anyAction', 'drop', 'dropDatabase', 'dbAdmin', 'root',
  'userAdmin', 'grantRole', 'createUser', 'updateUser']);
const SOURCE_ACTIONS = ['find', 'listCollections', 'listIndexes'];

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some(field => !Object.hasOwn(value, field))) {
    throw new Error(`${label} has incomplete or unexpected identity fields`);
  }
}

function validateAllowed(role, value) {
  exact(value, FIELDS, `${role} allowlist`);
  for (const field of FIELDS.slice(0, -1)) {
    if (typeof value[field] !== 'string' || !SAFE.test(value[field])) {
      throw new Error(`${role} allowlist identity is invalid`);
    }
  }
  const actions = value.expectedPrivileges;
  if (!Array.isArray(actions) || !actions.length || new Set(actions).size !== actions.length
    || actions.some(action => typeof action !== 'string' || !SAFE.test(action)
      || FORBIDDEN.has(action))) {
    throw new Error(`${role} allowlist privilege scope is invalid`);
  }
  if (role === 'source' && checksumValue([...actions].sort())
    !== checksumValue(SOURCE_ACTIONS)) {
    throw new Error('Source principal must have the exact read-only inventory scope');
  }
}

/** No connector is opened on import. All three independent observations are injected. */
export function createAtlasIdentityObserver({ trustedAllowlist, observeAtlas,
  observeHandshake, observePrivileges }) {
  if (typeof observeAtlas !== 'function' || typeof observeHandshake !== 'function'
    || typeof observePrivileges !== 'function' || observeAtlas === observeHandshake
    || observeAtlas === observePrivileges || observeHandshake === observePrivileges) {
    throw new Error('Three independent trusted identity and privilege observers are required');
  }
  exact(trustedAllowlist, ROLES, 'Production allowlist');
  const allowlist = structuredClone(trustedAllowlist);
  for (const role of ROLES) validateAllowed(role, allowlist[role]);
  const locations = ROLES.map(role => `${allowlist[role].projectId}\n${allowlist[role].clusterId}\n${allowlist[role].databaseName}`);
  if (new Set(locations).size !== ROLES.length) {
    throw new Error('Source, recovery, target and control databases must be distinct');
  }
  if (new Set(ROLES.map(role => allowlist[role].principal)).size !== ROLES.length) {
    throw new Error('Release principals must be distinct for each database role');
  }
  const planAllowlist = Object.freeze(Object.fromEntries(ROLES.filter(role => role !== 'control')
    .map(role => [role, Object.freeze(Object.fromEntries(PLAN_FIELDS
      .map(field => [field, allowlist[role][field]])))])));

  async function observeRole(role) {
    if (!ROLES.includes(role)) throw new Error('Unknown Atlas database role');
    const expected = allowlist[role];
    let atlas;
    let handshake;
    let privileges;
    try {
      [atlas, handshake, privileges] = await Promise.all([
        observeAtlas(role), observeHandshake(role), observePrivileges(role),
      ]);
    } catch {
      throw new Error(`${role} trusted Atlas observation failed`);
    }
    exact(atlas, ['projectId', 'clusterId', 'endpointIdentity'], `${role} Atlas observation`);
    exact(handshake, ['databaseName', 'replicaSet', 'endpointIdentity'], `${role} handshake`);
    exact(privileges, ['principal', 'actions'], `${role} privilege observation`);
    for (const field of ['projectId', 'clusterId', 'endpointIdentity']) {
      if (atlas[field] !== expected[field]) throw new Error(`${role} Atlas identity differs from allowlist`);
    }
    for (const field of ['databaseName', 'replicaSet', 'endpointIdentity']) {
      if (handshake[field] !== expected[field]) throw new Error(`${role} handshake identity differs from allowlist`);
    }
    if (privileges.principal !== expected.principal) {
      throw new Error(`${role} credential principal differs from allowlist`);
    }
    if (!Array.isArray(privileges.actions)
      || checksumValue([...privileges.actions].sort())
        !== checksumValue([...expected.expectedPrivileges].sort())) {
      throw new Error(`${role} credential privilege scope differs from allowlist`);
    }
    return Object.freeze({ ...structuredClone(expected),
      observationSha256: checksumValue({ atlas, handshake, privileges }) });
  }
  return Object.freeze({ planAllowlist, controlDatabaseName: allowlist.control.databaseName,
    observeRole,
    async observeAll() {
      const result = {};
      for (const role of ROLES) result[role] = await observeRole(role);
      return Object.freeze(result);
    },
  });
}
