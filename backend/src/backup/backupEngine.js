import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import zlib from 'node:zlib';
import mongoose from 'mongoose';
import {
  assertDistinctDatabaseConnections,
  captureHistoricalBaselines,
  checksumValue,
  discoverSourceInventory,
  verifyRestoredInventory,
} from '../migrations/sourceInventory.service.js';

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_COLLECTIONS = Object.freeze([
  'user_accounts',
  'member_accounts',
  'member_account_audits',
  'meal_days',
  'monthly_meal_rates',
  'payments',
  'payment_settings',
  'reminder_settings',
  'monthly_settlements',
  'push_subscriptions',
  'push_deliveries',
  'rooms',
  'room_assignments',
  'room_fee_plans',
  'room_charges',
  'room_payments',
  'room_payment_settings',
  'expenses',
  'expense_reimbursements',
  'hostel_stays',
  'hostel_deposit_accounts',
  'hostel_deposit_transactions',
  'hostel_clearances',
  'payment_reclassifications',
  'unallocated_credits',
  'credit_allocations',
  'credit_obligation_states',
  'payment_reference_claims',
]);

/**
 * Converts a MongoDB document into Extended JSON preserving ObjectIds and Dates
 */
export function toExtendedJson(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof mongoose.Types.ObjectId || (value._bsontype === 'ObjectID')) {
    return { $oid: value.toString() };
  }

  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }

  if (Array.isArray(value)) {
    return value.map(toExtendedJson);
  }

  if (typeof value === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(value)) {
      res[k] = toExtendedJson(v);
    }
    return res;
  }

  return value;
}

/**
 * Restores BSON types from Extended JSON representation
 */
export function fromExtendedJson(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1) {
      if (keys[0] === '$oid' && typeof value.$oid === 'string') {
        return new mongoose.Types.ObjectId(value.$oid);
      }
      if (keys[0] === '$date' && typeof value.$date === 'string') {
        return new Date(value.$date);
      }
    }

    if (Array.isArray(value)) {
      return value.map(fromExtendedJson);
    }

    const res = {};
    for (const [k, v] of Object.entries(value)) {
      res[k] = fromExtendedJson(v);
    }
    return res;
  }

  return value;
}

/**
 * Exports all database collections into an encrypted backup envelope
 */
/** @param {any} options @returns {Promise<any>} */
export async function createEncryptedBackup(options) {
  const {
    dbConnection,
    encryptionKey,
    appVersion = '0.1.0',
    baselineReaders = null,
  } = options;
  if (!encryptionKey || typeof encryptionKey !== 'string' || encryptionKey.length < 16) {
    throw new Error('Encryption key must be a string containing at least 16 characters');
  }

  const inventory = await discoverSourceInventory({
    dbConnection,
    fallbackCollectionNames: BACKUP_COLLECTIONS,
    serializeDocument: toExtendedJson,
  });
  const data = /** @type {Record<string, any[]>} */ ({});
  const collectionCounts = /** @type {Record<string, number>} */ ({});
  let totalRecords = 0;

  for (const collectionName of inventory.collectionOrder) {
    const docs = inventory.documents[collectionName];
    data[collectionName] = docs.map(toExtendedJson);
    collectionCounts[collectionName] = docs.length;
    totalRecords += docs.length;
  }

  const baselines = await captureHistoricalBaselines({ inventory, baselineReaders });
  const payload = {
    payloadFormat: 'mealkhata-backup-payload-v2',
    collections: data,
    baselines,
  };
  const rawJson = JSON.stringify(payload);
  const sha256Checksum = createHash('sha256').update(rawJson).digest('hex');
  const compressed = zlib.gzipSync(Buffer.from(rawJson, 'utf8'));

  // Encrypt with AES-256-GCM
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(encryptionKey, salt, 100_000, 32, 'sha256');

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const manifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    appVersion,
    sourceDatabase: inventory.databaseName,
    collectionOrder: inventory.collectionOrder,
    collections: collectionCounts,
    collectionMetadata: inventory.collections,
    totalRecords,
    sha256Checksum,
    baselines: baselines ? {
      sha256Checksum: baselines.sha256Checksum,
      calendarDayCount: baselines.calendarDays.length,
      monthlyCostReportCount: baselines.monthlyCostReports.length,
    } : null,
    algorithm: 'aes-256-gcm',
  };

  const backupPackage = {
    format: 'mealkhata-encrypted-backup-v1',
    manifest,
    crypto: {
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    },
    ciphertext: encrypted.toString('hex'),
  };

  return {
    manifest,
    serializedPackage: JSON.stringify(backupPackage, null, 2),
  };
}

/**
 * Decrypts and verifies a backup envelope without restoring it
 */
/** @param {any} options @returns {any} */
export function verifyAndDecryptBackup(options) {
  const { backupPackageString, encryptionKey } = options;
  if (!encryptionKey) {
    throw new Error('Encryption key is required to decrypt and verify the backup');
  }

  let pkg;
  try {
    pkg = JSON.parse(backupPackageString);
  } catch {
    throw new Error('Malformed backup file: invalid JSON envelope');
  }

  if (pkg.format !== 'mealkhata-encrypted-backup-v1' || !pkg.manifest || !pkg.crypto || !pkg.ciphertext) {
    throw new Error('Unsupported backup envelope structure or format version');
  }

  const { manifest, crypto: cryptoInfo, ciphertext } = pkg;

  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup formatVersion: ${manifest.formatVersion}`);
  }

  const salt = Buffer.from(cryptoInfo.salt, 'hex');
  const iv = Buffer.from(cryptoInfo.iv, 'hex');
  const authTag = Buffer.from(cryptoInfo.authTag, 'hex');
  const encrypted = Buffer.from(ciphertext, 'hex');

  const key = pbkdf2Sync(encryptionKey, salt, 100_000, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let compressed;
  try {
    compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw Object.assign(
      new Error(`Backup decryption failed: invalid encryption key or tampered data (${detail})`),
      { cause: err },
    );
  }

  const decompressed = zlib.gunzipSync(compressed).toString('utf8');
  const computedChecksum = createHash('sha256').update(decompressed).digest('hex');

  if (computedChecksum !== manifest.sha256Checksum) {
    throw new Error('Backup integrity checksum mismatch: archive may be corrupted or tampered');
  }

  const payload = JSON.parse(decompressed);
  const isWrappedPayload = payload?.payloadFormat === 'mealkhata-backup-payload-v2';
  const rawData = isWrappedPayload ? payload.collections : payload;
  const baselines = isWrappedPayload ? payload.baselines : null;

  for (const [collectionName, expectedCount] of Object.entries(manifest.collections || {})) {
    const documents = rawData?.[collectionName];
    if (!Array.isArray(documents) || documents.length !== expectedCount) {
      throw new Error(`Backup collection manifest mismatch for ${collectionName}`);
    }
    const expectedChecksum = manifest.collectionMetadata?.[collectionName]?.sha256Checksum;
    if (expectedChecksum && checksumValue(documents) !== expectedChecksum) {
      throw new Error(`Backup collection checksum mismatch for ${collectionName}`);
    }
  }

  if (manifest.baselines) {
    if (!baselines || checksumValue({
      calendarDays: baselines.calendarDays,
      monthlyCostReports: baselines.monthlyCostReports,
    }) !== manifest.baselines.sha256Checksum) {
      throw new Error('Backup historical baseline checksum mismatch');
    }
  }

  return { manifest, rawData, baselines };
}

/**
 * Restores a verified backup into a target database connection
 */
/** @param {any} options @returns {Promise<any>} */
export async function restoreDatabase(options) {
  const {
    backupPackageString,
    encryptionKey,
    sourceDbConnection = null,
    targetDbConnection,
    dropExisting = false,
  } = options;
  assertDistinctDatabaseConnections({ sourceDbConnection, targetDbConnection });
  const { manifest, rawData, baselines } = verifyAndDecryptBackup({ backupPackageString, encryptionKey });
  const db = targetDbConnection.db;
  const restoredCounts = /** @type {Record<string, number>} */ ({});
  const collectionOrder = manifest.collectionOrder || Object.keys(rawData).sort();
  const targetBeforeRestore = await discoverSourceInventory({
    dbConnection: targetDbConnection,
    serializeDocument: toExtendedJson,
  });

  if (!dropExisting && targetBeforeRestore.collectionOrder.length > 0) {
    throw new Error('Restore target database is not empty; use an explicit disposable target or --drop');
  }

  if (dropExisting) {
    for (const collectionName of targetBeforeRestore.collectionOrder) {
      try {
        await db.collection(collectionName).drop();
      } catch (error) {
        if (error?.codeName !== 'NamespaceNotFound' && error?.code !== 26) throw error;
      }
    }
  }

  for (const collectionName of collectionOrder) {
    const rawDocs = rawData[collectionName] || [];
    const restoredDocs = rawDocs.map(fromExtendedJson);

    const collection = db.collection(collectionName);
    if (restoredDocs.length > 0) {
      await collection.insertMany(restoredDocs);
    } else if (typeof db.createCollection === 'function') {
      try {
        await db.createCollection(collectionName);
      } catch (error) {
        if (error?.codeName !== 'NamespaceExists' && error?.code !== 48) throw error;
      }
    }

    const indexes = manifest.collectionMetadata?.[collectionName]?.indexes || [];
    if (indexes.length > 0 && typeof collection.createIndexes === 'function') {
      await collection.createIndexes(indexes.map(({ key, ...options }) => ({ key, ...options })));
    }
    restoredCounts[collectionName] = restoredDocs.length;
  }

  const verification = await verifyRestoredInventory({
    sourceManifest: manifest,
    targetDbConnection,
    serializeDocument: toExtendedJson,
  });
  if (!verification.passed) {
    throw new Error(`Post-restore archive verification failed: ${verification.issues.join('; ')}`);
  }

  return {
    success: true,
    manifest,
    restoredCounts,
    baselines,
    verification,
  };
}
