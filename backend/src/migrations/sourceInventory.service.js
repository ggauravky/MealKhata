import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') };
  if (Array.isArray(value)) return value.map(canonicalize);

  if (typeof value === 'object') {
    if (typeof value.toExtendedJSON === 'function') {
      return canonicalize(value.toExtendedJSON());
    }
    if (typeof value.toHexString === 'function') {
      return { $oid: value.toHexString() };
    }
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize(value[key]);
    }
    return result;
  }

  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function checksumValue(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** @param {any} index */
function normalizeIndex(index) {
  const normalized = { name: index.name, key: index.key };
  for (const option of [
    'unique',
    'sparse',
    'expireAfterSeconds',
    'partialFilterExpression',
    'collation',
    'hidden',
  ]) {
    if (index[option] !== undefined) normalized[option] = index[option];
  }
  return normalized;
}

async function listCollectionNames(db, fallbackCollectionNames) {
  if (typeof db.listCollections !== 'function') {
    return [...new Set(fallbackCollectionNames)].sort();
  }

  const entries = await db.listCollections({}, { nameOnly: true }).toArray();
  return entries
    .map(({ name }) => name)
    .filter((name) => typeof name === 'string' && !name.startsWith('system.'))
    .sort();
}

async function readDocuments(collection) {
  const cursor = collection.find({});
  if (typeof cursor.sort === 'function') cursor.sort({ _id: 1 });
  return cursor.toArray();
}

async function readIndexes(collection) {
  if (typeof collection.indexes !== 'function') return [];
  try {
    const indexes = await collection.indexes();
    return indexes
      .filter(({ name }) => name !== '_id_')
      .map(normalizeIndex)
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (error?.codeName === 'NamespaceNotFound' || error?.code === 26) return [];
    throw error;
  }
}

/** @param {any} options @returns {Promise<any>} */
export async function discoverSourceInventory(options = {}) {
  const {
    dbConnection,
    fallbackCollectionNames = [],
    sampleSize = 3,
    serializeDocument = (document) => document,
  } = options;
  if (!dbConnection?.db) throw new Error('A connected MongoDB database is required for inventory');
  if (!Number.isInteger(sampleSize) || sampleSize < 0 || sampleSize > 100) {
    throw new Error('sampleSize must be an integer from 0 through 100');
  }

  const db = dbConnection.db;
  const collectionOrder = await listCollectionNames(db, fallbackCollectionNames);
  const collections = /** @type {Record<string, any>} */ ({});
  const documents = /** @type {Record<string, any[]>} */ ({});

  for (const collectionName of collectionOrder) {
    const collection = db.collection(collectionName);
    const docs = await readDocuments(collection);
    const serializedDocs = docs.map(serializeDocument);
    const indexes = await readIndexes(collection);
    documents[collectionName] = docs;
    collections[collectionName] = {
      count: docs.length,
      sha256Checksum: checksumValue(serializedDocs),
      indexes,
      samples: serializedDocs.slice(0, sampleSize).map((document) => ({
        sha256Checksum: checksumValue(document),
      })),
    };
  }

  return {
    databaseName: db.databaseName ?? null,
    collectionOrder,
    collections,
    documents,
  };
}

/** @param {string} key @param {any} value @param {string} fallbackValue */
function normalizeBaselineEntry(key, value, fallbackValue) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...value, [key]: fallbackValue };
  }
  return { [key]: fallbackValue, value };
}

/** @param {any} options @returns {Promise<any>} */
export async function captureHistoricalBaselines(options = {}) {
  const { inventory, baselineReaders } = options;
  if (!baselineReaders) return null;
  if (
    typeof baselineReaders.readCalendarDay !== 'function'
    || typeof baselineReaders.readMonthlyCostReport !== 'function'
  ) {
    throw new Error('Both calendar-day and monthly-cost baseline readers are required');
  }

  const mealDays = /** @type {Array<{date?: string}>} */ (inventory?.documents?.meal_days || []);
  const dates = /** @type {string[]} */ ([...new Set(
    mealDays
      .map(({ date }) => date)
      .filter((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)),
  )]).sort();
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))].sort();

  const calendarDays = /** @type {any[]} */ ([]);
  for (const date of dates) {
    calendarDays.push(normalizeBaselineEntry(
      'date',
      await baselineReaders.readCalendarDay(date),
      date,
    ));
  }

  const monthlyCostReports = /** @type {any[]} */ ([]);
  for (const month of months) {
    monthlyCostReports.push(normalizeBaselineEntry(
      'month',
      await baselineReaders.readMonthlyCostReport(month),
      month,
    ));
  }

  const baseline = { calendarDays, monthlyCostReports };
  return { ...baseline, sha256Checksum: checksumValue(baseline) };
}

/** @param {any} connection @returns {any} */
function connectionIdentity(connection) {
  if (!connection?.db) return null;
  return {
    databaseName: connection.db.databaseName ?? connection.name ?? null,
    host: connection.host ?? null,
    port: connection.port ?? null,
  };
}

/** @param {any} options */
export function assertDistinctDatabaseConnections(options) {
  const { sourceDbConnection, targetDbConnection } = options;
  if (!sourceDbConnection || !targetDbConnection) return;
  const source = connectionIdentity(sourceDbConnection);
  const target = connectionIdentity(targetDbConnection);
  const sameObject = sourceDbConnection === targetDbConnection || sourceDbConnection.db === targetDbConnection.db;
  const sameNamedServer = source?.databaseName
    && source.databaseName === target?.databaseName
    && source.host === target.host
    && source.port === target.port;
  if (sameObject || sameNamedServer) {
    throw new Error('Source and restore target databases must be different');
  }
}

function normalizedDatabaseUri(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new URL(value.trim());
  const hosts = parsed.host
    .toLowerCase()
    .split(',')
    .map((host) => host.trim())
    .sort()
    .join(',');
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  return `${parsed.protocol.toLowerCase()}//${hosts}/${databaseName}`;
}

/** @param {any} options */
export function assertDistinctDatabaseUris(options) {
  const { sourceUri, targetUri } = options;
  const source = normalizedDatabaseUri(sourceUri);
  const target = normalizedDatabaseUri(targetUri);
  if (source && target && source === target) {
    throw new Error('Source and restore target databases must be different');
  }
}

/** @param {any[]} indexes */
function canonicalIndexes(indexes) {
  return stableStringify((indexes || []).map(normalizeIndex).sort((a, b) => a.name.localeCompare(b.name)));
}

/** @param {any} options @returns {Promise<any>} */
export async function verifyRestoredInventory(options = {}) {
  const {
    sourceManifest,
    targetDbConnection,
    serializeDocument = (document) => document,
  } = options;
  const expectedOrder = sourceManifest?.collectionOrder
    || Object.keys(sourceManifest?.collections || {}).sort();
  const targetInventory = await discoverSourceInventory({
    dbConnection: targetDbConnection,
    fallbackCollectionNames: expectedOrder,
    sampleSize: 3,
    serializeDocument,
  });
  const issues = /** @type {string[]} */ ([]);

  const unexpectedCollections = targetInventory.collectionOrder
    .filter((name) => !expectedOrder.includes(name));
  for (const collectionName of unexpectedCollections) {
    issues.push(`Unexpected target collection: ${collectionName}`);
  }

  for (const collectionName of expectedOrder) {
    const expected = sourceManifest.collectionMetadata?.[collectionName] || {
      count: sourceManifest.collections?.[collectionName] ?? 0,
      indexes: [],
    };
    const actual = targetInventory.collections[collectionName];
    if (!actual) {
      issues.push(`Missing target collection: ${collectionName}`);
      continue;
    }
    if (actual.count !== expected.count) {
      issues.push(`${collectionName}: expected ${expected.count} records, found ${actual.count}`);
    }
    if (expected.sha256Checksum && actual.sha256Checksum !== expected.sha256Checksum) {
      issues.push(`${collectionName}: document checksum mismatch`);
    }
    if (canonicalIndexes(actual.indexes) !== canonicalIndexes(expected.indexes)) {
      issues.push(`${collectionName}: index metadata mismatch`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    targetInventory: {
      databaseName: targetInventory.databaseName,
      collectionOrder: targetInventory.collectionOrder,
      collections: targetInventory.collections,
    },
  };
}
