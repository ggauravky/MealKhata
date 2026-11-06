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
const INDEX_MODELS = [Student, StudentAuditEvent, MealDay, MealHistorySnapshot,
  MealHistoricalCorrection, MonthlyMealRate, UserAccount, SystemSettings];

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
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
  try {
    const owner = createPublicKey(config.v3OwnerPublicKey);
    const operator = createPublicKey(config.v3OperatorPublicKey);
    if (owner.asymmetricKeyType !== 'ed25519' || operator.asymmetricKeyType !== 'ed25519'
      || owner.export({ type: 'spki', format: 'der' }).equals(operator.export({ type: 'spki', format: 'der' }))) return null;
    const message = Buffer.from(checksumValue(body));
    for (const [role, key] of [['owner', owner], ['operator', operator]]) {
      const signature = signatures[role];
      if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)
        || !verify(null, message, key, Buffer.from(signature, 'base64'))) return null;
    }
    return body;
  } catch {
    return null;
  }
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

export async function inspectV3RequiredIndexes(db) {
  for (const model of INDEX_MODELS) {
    const actual = await db.collection(model.collection.name).indexes();
    for (const [key, expected] of model.schema.indexes()) {
      if (!actual.some(index => matchesIndex(index, key, expected))) return false;
    }
  }
  const markerIndexes = await db.collection('v3_migration_manifests').indexes();
  return markerIndexes.some(index => matchesIndex(index, { migrationId: 1 }, { unique: true }));
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
    const body = verifyV3RuntimeAttestation(JSON.parse(raw), config, now);
    if (!body || (requiredLaunchStage && body.launchStage !== requiredLaunchStage)
      || db.databaseName !== body.targetDatabase) return false;
    const observed = await handshake(db);
    if (!SAFE_ID.test(observed?.setName ?? '') || !Array.isArray(observed.hosts)
      || observed.hosts.length === 0 || observed.hosts.some(host => typeof host !== 'string')) return false;
    const clusterIdentity = checksumValue({ setName: observed.setName,
      hosts: [...observed.hosts].sort() });
    if (clusterIdentity !== body.targetClusterIdentity) return false;
    const manifest = await db.collection('v3_migration_manifests')
      .findOne({ migrationId: MIGRATION_ID });
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
