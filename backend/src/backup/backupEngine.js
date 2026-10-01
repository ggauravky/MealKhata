import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import zlib from 'node:zlib';
import mongoose from 'mongoose';

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_COLLECTIONS = Object.freeze([
  'member_accounts',
  'meal_days',
  'monthly_meal_rates',
  'payments',
  'payment_settings',
  'reminder_settings',
  'monthly_settlements',
  'push_subscriptions',
  'push_deliveries',
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
export async function createEncryptedBackup({ dbConnection, encryptionKey, appVersion = '0.1.0' }) {
  if (!encryptionKey || typeof encryptionKey !== 'string' || encryptionKey.length < 16) {
    throw new Error('Encryption key must be a string containing at least 16 characters');
  }

  const db = dbConnection.db;
  const data = {};
  const collectionCounts = {};
  let totalRecords = 0;

  for (const collectionName of BACKUP_COLLECTIONS) {
    let docs;
    try {
      docs = await db.collection(collectionName).find({}).toArray();
    } catch {
      docs = [];
    }
    data[collectionName] = docs.map(toExtendedJson);
    collectionCounts[collectionName] = docs.length;
    totalRecords += docs.length;
  }

  const rawJson = JSON.stringify(data);
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
    collections: collectionCounts,
    totalRecords,
    sha256Checksum,
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
export function verifyAndDecryptBackup({ backupPackageString, encryptionKey }) {
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
    throw new Error(`Backup decryption failed: invalid encryption key or tampered data (${err.message})`, { cause: err });
  }

  const decompressed = zlib.gunzipSync(compressed).toString('utf8');
  const computedChecksum = createHash('sha256').update(decompressed).digest('hex');

  if (computedChecksum !== manifest.sha256Checksum) {
    throw new Error('Backup integrity checksum mismatch: archive may be corrupted or tampered');
  }

  const rawData = JSON.parse(decompressed);
  return { manifest, rawData };
}

/**
 * Restores a verified backup into a target database connection
 */
export async function restoreDatabase({ backupPackageString, encryptionKey, targetDbConnection, dropExisting = false }) {
  const { manifest, rawData } = verifyAndDecryptBackup({ backupPackageString, encryptionKey });
  const db = targetDbConnection.db;
  const restoredCounts = {};

  for (const collectionName of BACKUP_COLLECTIONS) {
    const rawDocs = rawData[collectionName] || [];
    const restoredDocs = rawDocs.map(fromExtendedJson);

    const collection = db.collection(collectionName);
    if (dropExisting) {
      try {
        await collection.drop();
      } catch {
        // ignore if collection didn't exist
      }
    }

    if (restoredDocs.length > 0) {
      await collection.insertMany(restoredDocs);
    }
    restoredCounts[collectionName] = restoredDocs.length;
  }

  return {
    success: true,
    manifest,
    restoredCounts,
  };
}
