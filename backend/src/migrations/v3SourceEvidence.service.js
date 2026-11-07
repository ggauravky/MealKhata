import { BACKUP_COLLECTIONS, toExtendedJson, verifyAndDecryptBackup } from '../backup/backupEngine.js';
import { isValidLogicalDate } from '../utils/date.js';
import { checksumValue } from './sourceInventory.service.js';

const READ_ACTIONS = new Set(['find', 'listCollections', 'listIndexes']);
const INDEX_OPTIONS = ['unique', 'sparse', 'expireAfterSeconds',
  'partialFilterExpression', 'collation', 'hidden'];
const ID_FIELDS = ['clusterId', 'databaseName', 'replicaSet'];
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function normalizedIndex(index) {
  const normalized = { name: index.name, key: index.key };
  for (const option of INDEX_OPTIONS) {
    if (index[option] !== undefined) normalized[option] = index[option];
  }
  return normalized;
}

function exactIdentity(expected, observed) {
  if (!expected || !observed || Object.keys(expected).length !== 3
    || Object.keys(observed).length !== 3
    || ID_FIELDS.some(field => !SAFE.test(expected[field] ?? '')
      || expected[field] !== observed[field])) {
    throw new Error('Source identity differs from independent allowlist or observation');
  }
}

function inventoryProfile(documents) {
  const days = documents.meal_days ?? [];
  const dates = days.map(day => day.date).sort();
  const participants = new Set();
  const monthCounts = {};
  let auditChanges = 0;
  let priceOverrides = 0;
  let physicalPlateAllocations = 0;
  let legacyCount = 0;
  let v3Count = 0;
  const sourceRevisions = {};
  for (const day of days) {
    if (day.schemaVersion === 3) v3Count += 1;
    else legacyCount += 1;
    if (typeof day.date === 'string') {
      monthCounts[day.date.slice(0, 7)] = (monthCounts[day.date.slice(0, 7)] ?? 0) + 1;
      sourceRevisions[day.date] = day.revision;
    }
    for (const id of day.participantOrder ?? []) participants.add(id);
    for (const mealType of ['morning', 'night']) {
      for (const id of Object.keys(day.meals?.[mealType] ?? {})) participants.add(id);
      if (day.priceOverrides?.[mealType]) priceOverrides += 1;
      physicalPlateAllocations += day.allocations?.[mealType]?.plates?.length ?? 0;
    }
    auditChanges += (day.changes?.length ?? 0)
      + (day.allocationChanges?.length ?? 0) + (day.priceChanges?.length ?? 0);
  }
  for (const student of documents.students ?? []) participants.add(student.studentId);
  return { dates, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null,
    monthCounts, participantIds: [...participants].sort(),
    originalIdsPresent: ['gaurav', 'nikhil', 'devansh'].filter(id => participants.has(id)),
    legacyCount, v3Count, sourceRevisions, auditChanges, priceOverrides,
    physicalPlateAllocations, snapshots: (documents.meal_history_snapshots ?? []).length,
    corrections: (documents.meal_history_corrections ?? []).length,
    monthlyRateRecords: (documents.monthly_meal_rates ?? []).length };
}

/** Receives an already opened connection; it provides only read operations to the collector. */
export function createMongoSourceReadAdapter({ dbConnection, observeWriteEpoch, observePermissions }) {
  if (!dbConnection?.db || !dbConnection?.startSession
    || typeof observeWriteEpoch !== 'function' || typeof observePermissions !== 'function') {
    throw new Error('Connected replica set and independent read-only observations are required');
  }
  const db = dbConnection.db;
  return {
    databaseName: db.databaseName,
    observeWriteEpoch,
    observePermissions,
    async listCollections() {
      return (await db.listCollections({}, { nameOnly: true }).toArray())
        .map(row => row.name).filter(name => !name.startsWith('system.')).sort();
    },
    async listIndexes(name) {
      return (await db.collection(name).indexes()).filter(index => index.name !== '_id_')
        .map(normalizedIndex).sort((a, b) => a.name.localeCompare(b.name));
    },
    async readDocuments(name, session) {
      return (await db.collection(name).find({}, { session }).sort({ _id: 1 }).toArray())
        .map(toExtendedJson);
    },
    async withSnapshot(work) {
      const session = await dbConnection.startSession();
      try {
        return await session.withTransaction(() => work(session),
          { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
      } finally { await session.endSession(); }
    },
  };
}

/** Preliminary evidence only. A final frozen archive additionally needs an independent write-freeze attestation. */
export async function collectSourceEvidence({ reader, expectedIdentity, observeControlPlane,
  observeConnection, maxSnapshotMs = 30_000 }) {
  if (!reader?.withSnapshot || !reader?.readDocuments || !reader?.listIndexes
    || !reader?.listCollections || !reader?.observeWriteEpoch || !reader?.observePermissions
    || typeof observeControlPlane !== 'function' || typeof observeConnection !== 'function'
    || observeControlPlane === observeConnection) {
    throw new Error('Independent identity and read-only snapshot interfaces are required');
  }
  exactIdentity(expectedIdentity, await observeControlPlane());
  exactIdentity(expectedIdentity, await observeConnection());
  if (reader.databaseName !== expectedIdentity.databaseName) {
    throw new Error('Connected source database identity differs from allowlist');
  }
  const scope = await reader.observePermissions();
  if (!scope?.principalId || !Array.isArray(scope.actions)
    || [...READ_ACTIONS].some(action => !scope.actions.includes(action))
    || scope.actions.some(action => !READ_ACTIONS.has(action))) {
    throw new Error('Source credential scope must be independently verified read-only');
  }
  const startEpoch = await reader.observeWriteEpoch();
  if (typeof startEpoch !== 'string' || !startEpoch) throw new Error('Source write epoch is unavailable');
  const names = await reader.listCollections();
  const beforeIndexes = {};
  for (const name of names) beforeIndexes[name] = await reader.listIndexes(name);
  const startedAt = Date.now();
  let documents;
  try {
    documents = await reader.withSnapshot(async session => {
      const rows = {};
      for (const name of names) rows[name] = await reader.readDocuments(name, session);
      return rows;
    });
  } catch { throw new Error('Consistent source snapshot read failed'); }
  if (!documents || Date.now() - startedAt > maxSnapshotMs) {
    throw new Error('Source snapshot lifetime exceeded the approved bound');
  }
  const afterNames = await reader.listCollections();
  const afterIndexes = {};
  for (const name of afterNames) afterIndexes[name] = await reader.listIndexes(name);
  const endEpoch = await reader.observeWriteEpoch();
  if (startEpoch !== endEpoch || checksumValue(names) !== checksumValue(afterNames)
    || checksumValue(beforeIndexes) !== checksumValue(afterIndexes)) {
    throw new Error('Source changed during snapshot inventory; evidence is stale');
  }
  const collections = Object.fromEntries(names.map(name => [name, {
    count: documents[name].length, sha256Checksum: checksumValue(documents[name]),
    indexes: beforeIndexes[name], indexesChecksum: checksumValue(beforeIndexes[name]) }]));
  const meals = inventoryProfile(documents);
  const findings = names.filter(name => !BACKUP_COLLECTIONS.includes(name))
    .map(name => `Unknown source collection retained in complete archive: ${name}`);
  if (new Set(meals.dates).size !== meals.dates.length) findings.push('Duplicate source meal date');
  if (meals.dates.some(date => !isValidLogicalDate(date))) findings.push('Invalid source meal date');
  for (const id of ['gaurav', 'nikhil', 'devansh']) {
    if (!meals.originalIdsPresent.includes(id)) findings.push(`Original student identity absent: ${id}`);
  }
  return { format: 'mealkhata-v3-source-inventory-v1', sourceIdentity: structuredClone(expectedIdentity),
    principalFingerprint: checksumValue(scope.principalId), collectionOrder: names,
    credentialScope: { verifiedReadOnly: true, actions: [...READ_ACTIONS].sort(),
      principalFingerprint: checksumValue(scope.principalId) },
    collections, documents, meals, findings,
    consistency: { level: 'SNAPSHOT_WITH_STABLE_WRITE_EPOCH',
      writeEpochDigest: checksumValue(startEpoch), indexMetadataChecked: true,
      elapsedMs: Date.now() - startedAt },
    fingerprint: checksumValue({ identity: expectedIdentity, collections, meals }) };
}

/** Detects any source/archive mismatch, including unknown collections and index options. */
export function compareSourceEvidenceToArchive({ evidence, archive, sourceManifest, encryptionKey }) {
  const verified = verifyAndDecryptBackup({ backupPackageString: archive, encryptionKey });
  if (checksumValue(verified.manifest) !== checksumValue(sourceManifest)
    || evidence.sourceIdentity.databaseName !== verified.manifest.sourceDatabase
    || checksumValue(evidence.collectionOrder) !== checksumValue(verified.manifest.collectionOrder)) {
    throw new Error('Source archive manifest or collection inventory changed');
  }
  for (const name of evidence.collectionOrder) {
    const actual = evidence.collections[name];
    const archived = verified.manifest.collectionMetadata?.[name];
    if (!archived || actual.count !== archived.count
      || actual.sha256Checksum !== archived.sha256Checksum
      || actual.indexesChecksum !== checksumValue(archived.indexes ?? [])
      || checksumValue(evidence.documents[name]) !== checksumValue(verified.rawData[name])) {
      throw new Error(`Source archive document or index checksum changed: ${name}`);
    }
  }
  return { passed: true, sourceInventoryFingerprint: evidence.fingerprint,
    archiveSha256: verified.manifest.sha256Checksum,
    comparisonSha256: checksumValue({ inventory: evidence.fingerprint,
      archive: verified.manifest.sha256Checksum }) };
}
