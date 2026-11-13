import { readFile } from 'node:fs/promises';
import { createPublicKey, verify } from 'node:crypto';
import mongoose from 'mongoose';
import { UserAccount } from '../auth/userAccount.model.js';
import { MonthlyMealRate } from '../billing/monthlyRate.model.js';
import { MealDay } from '../meals/meal.model.js';
import { MealHistoricalCorrection } from '../meals/mealHistoricalCorrection.model.js';
import { MealHistorySnapshot } from '../meals/mealHistorySnapshot.model.js';
import { checksumValue } from '../migrations/sourceInventory.service.js';
import { SystemSettings } from '../settings/systemSettings.model.js';
import { Student } from '../students/student.model.js';
import { StudentAuditEvent } from '../students/studentAuditEvent.model.js';
import { checkDatabaseReadiness } from './db.js';
import { env } from './env.js';

const SHA = /^[a-f0-9]{64}$/;
const BUILD_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MIGRATION_ID = 'mealkhata-v3-blue-green';
const FIELDS = ['format', 'releaseId', 'buildSha', 'targetDatabase',
  'targetClusterIdentity', 'sourceChecksum', 'sourceManifestChecksum', 'finalSourceChecksum',
  'recoveryEvidenceSha256', 'migrationEvidenceSha256', 'stageBPlanDigest',
  'launchStage', 'issuedAt', 'expiresAt'];
const FRESH_FIELDS = ['format', 'releaseId', 'buildSha', 'targetDatabase',
  'targetClusterIdentity', 'initializationChecksum', 'launchStage', 'issuedAt', 'expiresAt'];
const FRESH_MANIFEST_FIELDS_V1 = ['initializationId', 'status', 'targetDatabase',
  'targetClusterIdentity', 'sourceDatabase', 'superAdminUserId', 'superAdminEmail',
  'financialStartDate', 'createdAt'];
const FRESH_MANIFEST_FIELDS_V2 = ['initializationId', 'status', 'targetDatabase',
  'targetClusterIdentity', 'initializationMode', 'superAdminUserId', 'superAdminEmail',
  'financialStartDate', 'createdAt'];
const INDEX_MODELS = [Student, StudentAuditEvent, MealDay, MealHistorySnapshot,
  MealHistoricalCorrection, MonthlyMealRate, UserAccount, SystemSettings];

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function verifyAttestationSignatures(body, signatures, config) {
  try {
    const owner = createPublicKey(config.v3OwnerPublicKey);
    const operator = createPublicKey(config.v3OperatorPublicKey);
    if (owner.asymmetricKeyType !== 'ed25519' || operator.asymmetricKeyType !== 'ed25519'
      || owner.export({ type: 'spki', format: 'der' }).equals(operator.export({ type: 'spki', format: 'der' }))) return false;
    const message = Buffer.from(checksumValue(body));
    for (const [role, key] of [['owner', owner], ['operator', operator]]) {
      const signature = signatures[role];
      if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)
        || !verify(null, message, key, Buffer.from(signature, 'base64'))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function verifyV3RuntimeAttestation(document, config, now = new Date()) {
  if (!exact(document, ['body', 'signatures']) || !exact(document.signatures, ['owner', 'operator'])) return null;
  const { body, signatures } = document;
  if (!exact(body, FIELDS) || body.format !== 'mealkhata-v3-runtime-attestation-v1'
    || !SAFE_ID.test(body.releaseId ?? '') || !SAFE_ID.test(body.targetDatabase ?? '')
    || !BUILD_SHA.test(body.buildSha ?? '') || body.buildSha !== config.v3BuildSha
    || ![body.targetClusterIdentity, body.sourceChecksum, body.sourceManifestChecksum,
      body.finalSourceChecksum,
      body.recoveryEvidenceSha256, body.migrationEvidenceSha256,
      body.stageBPlanDigest].every(value => SHA.test(value ?? ''))
    || !['read-only', 'serving'].includes(body.launchStage)
    || typeof body.issuedAt !== 'string' || typeof body.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(body.issuedAt)) || !Number.isFinite(Date.parse(body.expiresAt))
    || Date.parse(body.issuedAt) > now.getTime()
    || Date.parse(body.expiresAt) <= now.getTime()
    || Date.parse(body.expiresAt) - Date.parse(body.issuedAt) > 24 * 60 * 60 * 1_000) return null;
  return verifyAttestationSignatures(body, signatures, config) ? body : null;
}

export function verifyV3FreshRuntimeAttestation(document, config, now = new Date()) {
  if (!exact(document, ['body', 'signatures']) || !exact(document.signatures, ['owner', 'operator'])) return null;
  const { body, signatures } = document;
  if (!exact(body, FRESH_FIELDS) || body.format !== 'mealkhata-v3-fresh-runtime-attestation-v1'
    || !SAFE_ID.test(body.releaseId ?? '') || !SAFE_ID.test(body.targetDatabase ?? '')
    || !BUILD_SHA.test(body.buildSha ?? '') || body.buildSha !== config.v3BuildSha
    || !SHA.test(body.targetClusterIdentity ?? '') || !SHA.test(body.initializationChecksum ?? '')
    || !['read-only', 'serving'].includes(body.launchStage)
    || typeof body.issuedAt !== 'string' || typeof body.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(body.issuedAt)) || !Number.isFinite(Date.parse(body.expiresAt))
    || Date.parse(body.issuedAt) > now.getTime()
    || Date.parse(body.expiresAt) <= now.getTime()
    || Date.parse(body.expiresAt) - Date.parse(body.issuedAt) > 24 * 60 * 60 * 1_000) return null;
  return verifyAttestationSignatures(body, signatures, config) ? body : null;
}

function freshManifestBody(manifest) {
  const emptyDatabaseMode = manifest?.initializationMode === 'empty-database';
  const fields = emptyDatabaseMode
    ? FRESH_MANIFEST_FIELDS_V2 : FRESH_MANIFEST_FIELDS_V1;
  if (!manifest || fields.some(field => !Object.hasOwn(manifest, field))
    || (emptyDatabaseMode
      ? Object.hasOwn(manifest, 'sourceDatabase')
      : Object.hasOwn(manifest, 'initializationMode'))) return null;
  const body = Object.fromEntries(fields.map(field => [field, manifest[field]]));
  if (body.initializationId !== 'mealkhata-v3-fresh' || body.status !== 'complete'
    || !SAFE_ID.test(body.targetDatabase)
    || (body.initializationMode === 'empty-database'
      ? Object.hasOwn(body, 'sourceDatabase')
      : !SAFE_ID.test(body.sourceDatabase) || body.targetDatabase === body.sourceDatabase)
    || !SHA.test(body.targetClusterIdentity)
    || !SAFE_ID.test(body.superAdminUserId)
    || typeof body.superAdminEmail !== 'string' || !body.superAdminEmail.includes('@')
    || typeof body.financialStartDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.financialStartDate)
    || typeof body.createdAt !== 'string' || !Number.isFinite(Date.parse(body.createdAt))) return null;
  return body;
}

async function observeHandshake(db) {
  const hello = await db.admin().command({ hello: 1, maxTimeMS: 2_000 });
  return { setName: hello.setName, hosts: hello.hosts };
}

function matchesIndex(actual, key, expected) {
  return JSON.stringify(actual?.key) === JSON.stringify(key)
    && (!expected.unique || actual.unique === true)
    && (!expected.sparse || actual.sparse === true)
    && (expected.expireAfterSeconds === undefined
      || actual.expireAfterSeconds === expected.expireAfterSeconds)
    && (!expected.partialFilterExpression
      || checksumValue(actual.partialFilterExpression) === checksumValue(expected.partialFilterExpression));
}

export async function inspectV3RequiredIndexes(db, { mode = 'migration' } = {}) {
  for (const model of INDEX_MODELS) {
    const actual = await db.collection(model.collection.name).indexes();
    for (const [key, expected] of model.schema.indexes()) {
      if (!actual.some(index => matchesIndex(index, key, expected))) return false;
    }
  }
  const markerCollection = mode === 'fresh' ? 'v3_fresh_initializations' : 'v3_migration_manifests';
  const markerKey = mode === 'fresh' ? { initializationId: 1 } : { migrationId: 1 };
  const markerIndexes = await db.collection(markerCollection).indexes();
  return markerIndexes.some(index => matchesIndex(index, markerKey, { unique: true }));
}

export async function createV3RequiredIndexes(db, { mode = 'fresh' } = {}) {
  for (const model of INDEX_MODELS) await model.createIndexes();
  const markerCollection = mode === 'fresh' ? 'v3_fresh_initializations' : 'v3_migration_manifests';
  const markerKey = mode === 'fresh' ? { initializationId: 1 } : { migrationId: 1 };
  await db.collection(markerCollection).createIndex(markerKey, { unique: true });
}

/** The protected, dual-signed artifact is reread on every probe so revocation fails closed. */
export async function checkV3ReleaseReadiness({ config = env, db = mongoose.connection.db,
  probe = checkDatabaseReadiness, readAttestation = path => readFile(path, 'utf8'),
  observeHandshake: handshake = observeHandshake, inspectIndexes = inspectV3RequiredIndexes,
  requiredLaunchStage = null, now = new Date() } = {}) {
  if (config.runtimeProfile !== 'v3' || config.canonicalOnlyAuth !== true
    || config.observedBuildSha !== config.v3BuildSha || !db
    || !config.v3AttestationPath || !config.v3BuildSha) return false;
  try {
    if (await probe() !== true) return false;
    const raw = await readAttestation(config.v3AttestationPath);
    if (Buffer.byteLength(raw, 'utf8') > 16_384) return false;
    const document = JSON.parse(raw);
    const fresh = document?.body?.format === 'mealkhata-v3-fresh-runtime-attestation-v1';
    const body = fresh
      ? verifyV3FreshRuntimeAttestation(document, config, now)
      : verifyV3RuntimeAttestation(document, config, now);
    if (!body || (requiredLaunchStage && body.launchStage !== requiredLaunchStage)
      || db.databaseName !== body.targetDatabase) return false;
    const observed = await handshake(db);
    if (!SAFE_ID.test(observed?.setName ?? '') || !Array.isArray(observed.hosts)
      || observed.hosts.length === 0 || observed.hosts.some(host => typeof host !== 'string')) return false;
    const clusterIdentity = checksumValue({ setName: observed.setName,
      hosts: [...observed.hosts].sort() });
    if (clusterIdentity !== body.targetClusterIdentity) return false;
    if (fresh) {
      const [manifest, migrated] = await Promise.all([
        db.collection('v3_fresh_initializations').findOne({ initializationId: 'mealkhata-v3-fresh' }),
        db.collection('v3_migration_manifests').findOne({ migrationId: MIGRATION_ID }),
      ]);
      const initialization = freshManifestBody(manifest);
      if (migrated || !initialization
        || initialization.targetDatabase !== body.targetDatabase
        || initialization.targetClusterIdentity !== body.targetClusterIdentity
        || checksumValue(initialization) !== body.initializationChecksum) return false;
      const admin = await db.collection('user_accounts').findOne({
        userId: initialization.superAdminUserId,
        email: initialization.superAdminEmail,
        role: 'superadmin', active: true,
      }, { projection: { userId: 1 } });
      if (!admin) return false;
      const settings = await db.collection('system_settings').findOne({ settingsId: 'system' },
        { projection: { financialStartDate: 1 } });
      if (settings?.financialStartDate !== initialization.financialStartDate) return false;
      return await inspectIndexes(db, { mode: 'fresh' }) === true;
    }
    const manifest = await db.collection('v3_migration_manifests').findOne({ migrationId: MIGRATION_ID });
    if (!manifest || manifest.status !== 'complete'
      || manifest.sourceChecksum !== body.sourceChecksum
      || manifest.finalSourceChecksum !== body.finalSourceChecksum
      || manifest.targetClusterIdentity !== body.targetClusterIdentity
      || manifest.sourceManifestChecksum !== body.sourceManifestChecksum) return false;
    return await inspectIndexes(db) === true;
  } catch {
    return false;
  }
}
