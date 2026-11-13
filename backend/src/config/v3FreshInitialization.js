import { createPublicKey, randomUUID, verify } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { UserAccount } from '../auth/userAccount.model.js';
import { SystemSettings } from '../settings/systemSettings.model.js';
import { isValidLogicalDate } from '../utils/date.js';
import { checksumValue } from '../migrations/sourceInventory.service.js';
import { createV3RequiredIndexes } from './v3ReleaseReadiness.js';

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA = /^[a-f0-9]{64}$/;
const APPROVAL_FIELDS_V1 = ['format', 'sourceDatabase', 'targetDatabase',
  'targetClusterIdentity', 'superAdminEmail', 'financialStartDate',
  'nonce', 'issuedAt', 'expiresAt'];
const APPROVAL_FIELDS_V2 = ['format', 'initializationMode', 'targetDatabase',
  'targetClusterIdentity', 'superAdminEmail', 'financialStartDate',
  'nonce', 'issuedAt', 'expiresAt'];
const MANIFEST_FIELDS_V1 = ['initializationId', 'status', 'targetDatabase',
  'targetClusterIdentity', 'sourceDatabase', 'superAdminUserId',
  'superAdminEmail', 'financialStartDate', 'createdAt'];
const MANIFEST_FIELDS_V2 = ['initializationId', 'status', 'targetDatabase',
  'targetClusterIdentity', 'initializationMode', 'superAdminUserId',
  'superAdminEmail', 'financialStartDate', 'createdAt'];

export function validateFreshTargetUris({ sourceUri, targetUri, sourceDatabase, targetDatabase }) {
  let source;
  let target;
  try {
    source = new URL(sourceUri);
    target = new URL(targetUri);
  } catch {
    throw new Error('Exact source and target MongoDB URIs are required');
  }
  if (source.protocol !== 'mongodb+srv:' || target.protocol !== 'mongodb+srv:'
    || !source.username || !target.username
    || source.searchParams.get('tls') === 'false' || target.searchParams.get('tls') === 'false'
    || source.host !== target.host) {
    throw new Error('Fresh source and target must use the same TLS-enabled Atlas cluster host');
  }
  if (!SAFE_NAME.test(sourceDatabase ?? '') || !SAFE_NAME.test(targetDatabase ?? '')
    || sourceDatabase === targetDatabase
    || decodeURIComponent(source.pathname.slice(1)) !== sourceDatabase
    || decodeURIComponent(target.pathname.slice(1)) !== targetDatabase) {
    throw new Error('Fresh target database URI must identify a separate exact database');
  }
  return { sourceDatabase, targetDatabase };
}

export function validateEmptyFreshTargetUri({ targetUri, targetDatabase }) {
  let target;
  try {
    target = new URL(targetUri);
  } catch {
    throw new Error('Exact fresh target MongoDB URI is required');
  }
  if (target.protocol !== 'mongodb+srv:' || !target.username
    || target.searchParams.get('tls') === 'false' || target.searchParams.get('ssl') === 'false') {
    throw new Error('Fresh target must use a TLS-enabled Atlas SRV URI');
  }
  if (!SAFE_NAME.test(targetDatabase ?? '')
    || ['admin', 'local', 'config'].includes(targetDatabase)
    || decodeURIComponent(target.pathname.slice(1)) !== targetDatabase) {
    throw new Error('Fresh target URI must identify the exact application database');
  }
  return { targetDatabase };
}

export function createFreshRuntimeAttestationBody({ manifest, buildSha, releaseId,
  launchStage, now = new Date() }) {
  const emptyDatabaseMode = manifest?.initializationMode === 'empty-database';
  const fields = emptyDatabaseMode
    ? MANIFEST_FIELDS_V2 : MANIFEST_FIELDS_V1;
  if (!manifest || fields.some(field => !Object.hasOwn(manifest, field))
    || (emptyDatabaseMode
      ? Object.hasOwn(manifest, 'sourceDatabase')
      : Object.hasOwn(manifest, 'initializationMode'))) {
    throw new Error('Complete fresh initialization manifest is required');
  }
  const recorded = Object.fromEntries(fields.map(field => [field, manifest[field]]));
  if (recorded.initializationId !== 'mealkhata-v3-fresh' || recorded.status !== 'complete'
    || !SAFE_NAME.test(recorded.targetDatabase)
    || (recorded.initializationMode === 'empty-database'
      ? Object.hasOwn(recorded, 'sourceDatabase')
      : !SAFE_NAME.test(recorded.sourceDatabase) || recorded.targetDatabase === recorded.sourceDatabase)
    || !SHA.test(recorded.targetClusterIdentity)
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(buildSha ?? '')
    || !SAFE_NAME.test(releaseId ?? '')
    || !['read-only', 'serving'].includes(launchStage)) {
    throw new Error('Fresh runtime attestation inputs are invalid');
  }
  return {
    format: 'mealkhata-v3-fresh-runtime-attestation-v1',
    releaseId, buildSha, targetDatabase: recorded.targetDatabase,
    targetClusterIdentity: recorded.targetClusterIdentity,
    initializationChecksum: checksumValue(recorded), launchStage,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
  };
}

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function verifyApproval(approval, { sourceDatabase, targetDatabase, ownerPublicKey,
  operatorPublicKey, now, clusterIdentity }) {
  const emptyDatabaseMode = approval?.body?.format === 'mealkhata-v3-fresh-init-approval-v2';
  const approvalFields = emptyDatabaseMode ? APPROVAL_FIELDS_V2 : APPROVAL_FIELDS_V1;
  if (!exact(approval, ['body', 'signatures'])
    || !exact(approval.signatures, ['owner', 'operator'])
    || !exact(approval.body, approvalFields)) throw new Error('Fresh initialization approval is invalid');
  const { body, signatures } = approval;
  if (!['mealkhata-v3-fresh-init-approval-v1', 'mealkhata-v3-fresh-init-approval-v2'].includes(body.format)
    || (emptyDatabaseMode
      ? body.initializationMode !== 'empty-database' || sourceDatabase !== undefined
      : body.sourceDatabase !== sourceDatabase || !SAFE_NAME.test(sourceDatabase ?? '')
        || sourceDatabase === targetDatabase)
    || body.targetDatabase !== targetDatabase
    || body.targetClusterIdentity !== clusterIdentity
    || !SAFE_NAME.test(body.nonce ?? '')
    || typeof body.superAdminEmail !== 'string'
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.superAdminEmail)
    || body.superAdminEmail !== body.superAdminEmail.trim().toLowerCase()
    || !isValidLogicalDate(body.financialStartDate)
    || typeof body.issuedAt !== 'string' || typeof body.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(body.issuedAt)) || !Number.isFinite(Date.parse(body.expiresAt))
    || Date.parse(body.issuedAt) > now.getTime() || Date.parse(body.expiresAt) <= now.getTime()
    || Date.parse(body.expiresAt) - Date.parse(body.issuedAt) > 10 * 60_000) {
    throw new Error('Fresh initialization approval is expired or does not match the target');
  }
  try {
    const owner = createPublicKey(ownerPublicKey);
    const operator = createPublicKey(operatorPublicKey);
    if (owner.asymmetricKeyType !== 'ed25519' || operator.asymmetricKeyType !== 'ed25519'
      || owner.export({ type: 'spki', format: 'der' }).equals(operator.export({ type: 'spki', format: 'der' }))) {
      throw new Error('Fresh initialization requires independent owner and operator keys');
    }
    const message = Buffer.from(checksumValue(body));
    for (const [role, key] of [['owner', owner], ['operator', operator]]) {
      const signature = signatures[role];
      if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)
        || !verify(null, message, key, Buffer.from(signature, 'base64'))) {
        throw new Error('Fresh initialization approval signature is invalid');
      }
    }
  } catch {
    throw new Error('Fresh initialization approval signature is invalid');
  }
  return body;
}

async function assertEmptyTarget(db) {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    if (await db.collection(name).countDocuments({}, { limit: 1 }) > 0) {
      throw new Error('Fresh target must be empty and not already initialized');
    }
  }
}

/** Offline, explicit one-use initialization. Never called by normal server startup. */
export async function initializeFreshV3({
  db = mongoose.connection.db,
  sourceDatabase,
  targetDatabase,
  approval,
  ownerPublicKey,
  operatorPublicKey,
  superAdminPasswordHash,
  execute = false,
  now = new Date(),
} = {}) {
  if (!db || !SAFE_NAME.test(targetDatabase ?? '')
    || ['admin', 'local', 'config'].includes(targetDatabase)
    || db.databaseName !== targetDatabase
    || mongoose.connection.db?.databaseName !== targetDatabase) {
    throw new Error('Fresh target database identity must be exact and allowed');
  }
  const hello = await db.admin().command({ hello: 1, maxTimeMS: 2_000 });
  if (!SAFE_NAME.test(hello.setName ?? '') || !Array.isArray(hello.hosts)
    || hello.hosts.length === 0 || hello.hosts.some(host => typeof host !== 'string')) {
    throw new Error('Fresh target cluster identity is unavailable');
  }
  const clusterIdentity = checksumValue({ setName: hello.setName, hosts: [...hello.hosts].sort() });
  if (!SHA.test(clusterIdentity)) throw new Error('Fresh target cluster identity is invalid');
  const body = verifyApproval(approval, { sourceDatabase, targetDatabase, ownerPublicKey,
    operatorPublicKey, now, clusterIdentity });
  await assertEmptyTarget(db);
  if (!execute) return { targetDatabase, ready: true };
  if (typeof superAdminPasswordHash !== 'string'
    || !/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(superAdminPasswordHash)
    || bcrypt.getRounds(superAdminPasswordHash) !== 12) {
    throw new Error('An explicit bcrypt cost 12 Super Admin password hash is required');
  }

  await createV3RequiredIndexes(db, { mode: 'fresh' });
  const session = await mongoose.startSession();
  let manifest;
  let initializationChecksum;
  try {
    await session.withTransaction(async () => {
      await assertEmptyTarget(db);
      const superAdminUserId = randomUUID();
      const createdAt = now.toISOString();
      manifest = {
        initializationId: 'mealkhata-v3-fresh', status: 'complete',
        targetDatabase, targetClusterIdentity: clusterIdentity,
        ...(body.initializationMode === 'empty-database'
          ? { initializationMode: 'empty-database' }
          : { sourceDatabase }),
        superAdminUserId, superAdminEmail: body.superAdminEmail,
        financialStartDate: body.financialStartDate, createdAt,
      };
      initializationChecksum = checksumValue(manifest);
      await db.collection('v3_fresh_initializations').insertOne(manifest, { session });
      await UserAccount.create([{
        userId: superAdminUserId, memberId: null, displayName: 'Super Admin',
        email: body.superAdminEmail, passwordHash: superAdminPasswordHash,
        role: 'superadmin', active: true, sessionVersion: 0,
      }], { session });
      await SystemSettings.create([{
        settingsId: 'system', financialStartDate: body.financialStartDate,
        timezone: 'Asia/Kolkata', revision: 1,
        configuredAt: now, configuredBy: superAdminUserId,
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  return { targetDatabase, initializationChecksum,
    superAdminUserId: manifest.superAdminUserId, status: 'complete' };
}
