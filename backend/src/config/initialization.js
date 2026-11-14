import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { AccountAuditEvent, ACCOUNT_AUDIT_EVENTS } from '../auth/accountAuditEvent.model.js';
import { ROLES } from '../auth/permissions.js';
import { UserAccount } from '../auth/userAccount.model.js';
import { SystemSettings } from '../settings/systemSettings.model.js';
import { isValidLogicalDate } from '../utils/date.js';
import { APP_INITIALIZATION_ID, AppInitialization } from './appInitialization.model.js';
import './models.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_12 = /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/;

/** Indexes declared on any registered schema, keyed by collection. */
function declaredIndexes() {
  return mongoose.modelNames().map((name) => {
    const model = mongoose.model(name);
    return { model, collection: model.collection.collectionName, indexes: model.schema.indexes() };
  });
}

function sameKey(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function matchesIndex(actual, key, expected) {
  return sameKey(actual?.key, key)
    && Boolean(expected.unique) === Boolean(actual.unique)
    && (!expected.sparse || actual.sparse === true)
    && (expected.expireAfterSeconds === undefined || actual.expireAfterSeconds === expected.expireAfterSeconds)
    && (!expected.partialFilterExpression
      || JSON.stringify(actual.partialFilterExpression) === JSON.stringify(expected.partialFilterExpression));
}

let indexesEnsured = false;

/** True once this process has confirmed every declared index exists. */
export function requiredIndexesEnsured() {
  return indexesEnsured;
}

/** Creates every declared index. Idempotent; safe on every startup and before setup. */
export async function ensureRequiredIndexes() {
  for (const { model } of declaredIndexes()) {
    await model.createCollection().catch((error) => {
      if (error?.codeName !== 'NamespaceExists' && error?.code !== 48) throw error;
    });
    await model.createIndexes();
  }
  indexesEnsured = true;
}

/** Returns the collections whose declared indexes are missing in the database. */
export async function findMissingIndexes(db = mongoose.connection.db) {
  const missing = [];
  for (const { collection, indexes } of declaredIndexes()) {
    let actual = [];
    try {
      actual = await db.collection(collection).indexes();
    } catch (error) {
      if (error?.codeName !== 'NamespaceNotFound' && error?.code !== 26) throw error;
    }
    for (const [key, options] of indexes) {
      if (!actual.some((index) => matchesIndex(index, key, options))) {
        missing.push(`${collection}:${Object.keys(key).join(',')}`);
      }
    }
  }
  return missing;
}

export function readInitializationState(db = mongoose.connection.db) {
  return db.collection(AppInitialization.collection.collectionName)
    .findOne({ initializationId: APP_INITIALIZATION_ID }, { projection: { _id: 0 } });
}

function assertSetupInput({ email, financialStartDate, passwordHash, db }) {
  if (!db) throw new Error('A connected database is required');
  if (typeof email !== 'string' || email !== email.trim().toLowerCase() || !EMAIL.test(email) || email.length > 254) {
    throw new Error('A valid lowercase Super Admin email is required');
  }
  if (!isValidLogicalDate(financialStartDate)) {
    throw new Error('A valid financial start date (YYYY-MM-DD) is required');
  }
  if (typeof passwordHash !== 'string' || !BCRYPT_12.test(passwordHash) || bcrypt.getRounds(passwordHash) !== 12) {
    throw new Error('A bcrypt cost-12 password hash is required');
  }
}

/**
 * One-time application initialization. Inside a single transaction it creates exactly one
 * Super Admin, the system settings and the durable initialization record. It never creates
 * students, meals, rooms or any financial data. A second or concurrent run fails because of
 * the unique initialization record and the single-superadmin index.
 */
export async function initializeApplication({
  email,
  financialStartDate,
  passwordHash,
  displayName = 'Super Admin',
  db = mongoose.connection.db,
  now = new Date(),
} = {}) {
  assertSetupInput({ email, financialStartDate, passwordHash, db });
  await ensureRequiredIndexes();

  const session = await mongoose.startSession();
  const superAdminUserId = randomUUID();
  try {
    await session.withTransaction(async () => {
      // Operations sharing one transaction session must run sequentially.
      const existing = await AppInitialization.findOne({ initializationId: APP_INITIALIZATION_ID })
        .session(session).lean();
      const anySuperAdmin = await UserAccount.findOne({ role: ROLES.SUPERADMIN }).session(session).lean();
      const accountCount = await UserAccount.countDocuments({}).session(session);
      const studentCount = await db.collection('students').countDocuments({}, { session });
      if (existing || anySuperAdmin) {
        throw new Error('MealKhata is already initialized; a second Super Admin cannot be created');
      }
      if (accountCount > 0 || studentCount > 0) {
        throw new Error('Refusing to initialize a database that already contains accounts or students');
      }
      await UserAccount.create([{
        userId: superAdminUserId,
        memberId: null,
        displayName,
        email,
        passwordHash,
        role: ROLES.SUPERADMIN,
        active: true,
        sessionVersion: 0,
        passwordChangedAt: now,
      }], { session });
      await SystemSettings.create([{
        settingsId: 'system',
        financialStartDate,
        timezone: 'Asia/Kolkata',
        revision: 1,
        configuredAt: now,
        configuredBy: superAdminUserId,
      }], { session });
      await AppInitialization.create([{
        initializationId: APP_INITIALIZATION_ID,
        status: 'complete',
        databaseName: db.databaseName,
        superAdminUserId,
        financialStartDate,
        initializedAt: now,
      }], { session });
      await AccountAuditEvent.create([{
        auditId: randomUUID(),
        event: ACCOUNT_AUDIT_EVENTS.SUPERADMIN_INITIALIZED,
        targetUserId: superAdminUserId,
        actorUserId: null,
        actorRole: 'setup',
        occurredAt: now,
        metadata: { email, financialStartDate },
      }], { session });
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new Error('MealKhata is already initialized; a second Super Admin cannot be created', { cause: error });
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return { superAdminUserId, databaseName: db.databaseName, financialStartDate, status: 'complete' };
}

/**
 * Owner recovery for a forgotten Super Admin password. Only reachable by someone holding
 * the database credentials (the local setup command); there is no HTTP route. Revokes every
 * existing Super Admin session and records an audit event.
 */
export async function resetSuperAdminPassword({ email, passwordHash, now = new Date() } = {}) {
  if (typeof passwordHash !== 'string' || !BCRYPT_12.test(passwordHash) || bcrypt.getRounds(passwordHash) !== 12) {
    throw new Error('A bcrypt cost-12 password hash is required');
  }
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const session = await mongoose.startSession();
  let userId;
  try {
    await session.withTransaction(async () => {
      const account = await UserAccount.findOne({ role: ROLES.SUPERADMIN }).session(session).lean();
      if (!account || account.email !== normalized) {
        throw new Error('That email is not the Super Admin of this database');
      }
      userId = account.userId;
      await UserAccount.updateOne({ userId }, {
        $set: { passwordHash, passwordChangedAt: now, active: true },
        $inc: { sessionVersion: 1 },
      }, { session });
      await AccountAuditEvent.create([{
        auditId: randomUUID(),
        event: ACCOUNT_AUDIT_EVENTS.PASSWORD_CHANGED,
        targetUserId: userId,
        actorUserId: null,
        actorRole: 'owner-recovery',
        occurredAt: now,
        metadata: { via: 'setup:admin --reset-password' },
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  return { userId };
}
