import mongoose from 'mongoose';
import { ROLES } from '../auth/permissions.js';
import { checkDatabaseReadiness } from './db.js';
import { configuredDatabaseName, env } from './env.js';
import { findMissingIndexes, readInitializationState } from './initialization.js';

const POSITIVE_CACHE_MS = 15_000;

/**
 * Real service readiness: connectivity, the expected database, completed initialization,
 * an active Super Admin and every declared index. Never reports secrets.
 */
export async function checkReadiness({
  config = env,
  db = mongoose.connection.db,
  probe = checkDatabaseReadiness,
  missingIndexes = findMissingIndexes,
} = {}) {
  const checks = { database: false, databaseIdentity: false, initialized: false,
    superAdmin: false, indexes: false, configuration: false };
  checks.configuration = Boolean(config.authJwtSecret && config.appOrigin && configuredDatabaseName(config.mongoUri));
  try {
    checks.database = Boolean(db) && await probe() === true;
    if (!checks.database) return { ready: false, checks };
    checks.databaseIdentity = db.databaseName === configuredDatabaseName(config.mongoUri);
    const initialization = await readInitializationState(db);
    checks.initialized = initialization?.status === 'complete'
      && initialization.databaseName === db.databaseName;
    if (checks.initialized) {
      checks.superAdmin = Boolean(await db.collection('user_accounts').findOne({
        userId: initialization.superAdminUserId,
        role: ROLES.SUPERADMIN,
        active: true,
      }, { projection: { _id: 1 } }));
    }
    checks.indexes = (await missingIndexes(db)).length === 0;
  } catch {
    // A failed observation must never report readiness.
  }
  return { ready: Object.values(checks).every(Boolean), checks };
}

/**
 * Cached initialization check for the write gate. Positive results are cached briefly so
 * each mutation does not pay for the full probe; negative results are never cached.
 */
export function createInitializationState({ read = readInitializationState, now = () => Date.now() } = {}) {
  let confirmedAt = 0;
  return Object.freeze({
    async isInitialized() {
      if (confirmedAt && now() - confirmedAt < POSITIVE_CACHE_MS) return true;
      const db = mongoose.connection.db;
      if (!db) return false;
      const record = await read(db);
      const initialized = record?.status === 'complete' && record.databaseName === db.databaseName;
      confirmedAt = initialized ? now() : 0;
      return initialized;
    },
    reset() { confirmedAt = 0; },
  });
}

export const initializationState = createInitializationState();
