import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { verifyIndexes } from '../../scripts/verifyIndexes.js';
import { verifyDataIntegrity } from '../../scripts/verifyData.js';
import { fromExtendedJson, toExtendedJson, verifyAndDecryptBackup } from '../backup/backupEngine.js';
import { createAuthService } from '../auth/auth.service.js';
import { UserAccount } from '../auth/userAccount.model.js';
import { MonthlyMealRate } from '../billing/monthlyRate.model.js';
import { MealDay } from '../meals/meal.model.js';
import { MealHistoricalCorrection } from '../meals/mealHistoricalCorrection.model.js';
import { MealHistorySnapshot } from '../meals/mealHistorySnapshot.model.js';
import { serializeLegacyMealSnapshot, serializeMealDay } from '../meals/meal.serializer.js';
import { extractMealParticipantIds } from '../meals/mealParticipants.js';
import { buildLegacyMealSnapshot, verifyLegacyMealSnapshot } from './legacyMealSnapshot.service.js';
import { SystemSettings } from '../settings/systemSettings.model.js';
import { Student } from '../students/student.model.js';
import { StudentAuditEvent } from '../students/studentAuditEvent.model.js';
import { assertSafeStudentId } from '../students/studentId.js';
import { checksumValue } from './sourceInventory.service.js';

export const V3_HISTORY_COLLECTIONS = Object.freeze([
  'students', 'student_audit_events', 'meal_days', 'meal_history_snapshots',
  'meal_history_corrections', 'monthly_meal_rates',
]);
const TARGET_COLLECTIONS = Object.freeze([...V3_HISTORY_COLLECTIONS, 'user_accounts', 'system_settings', 'v3_migration_manifests']);
const INDEX_MODELS = [Student, StudentAuditEvent, MealDay, MealHistorySnapshot,
  MealHistoricalCorrection, MonthlyMealRate, UserAccount, SystemSettings];
const ORIGINAL_IDS = ['gaurav', 'nikhil', 'devansh'];
const MIGRATION_ID = 'mealkhata-v3-blue-green';

function isValidAccountHash(value) {
  try { return typeof value === 'string' && bcrypt.getRounds(value) === 12; }
  catch { return false; }
}

function readVerifiedArchive({ archive, encryptionKey, sourceManifest }) {
  if (!sourceManifest || typeof sourceManifest !== 'object') throw new Error('An explicit source manifest is required');
  const verified = verifyAndDecryptBackup({ backupPackageString: archive, encryptionKey });
  if (checksumValue(verified.manifest) !== checksumValue(sourceManifest)) {
    throw new Error('Explicit source manifest does not match verified encrypted archive');
  }
  if (!verified.manifest.sourceDatabase || !verified.manifest.sha256Checksum) {
    throw new Error('Source archive lacks a database identity or fingerprint');
  }
  return verified;
}

function historicalStudents(rawData) {
  const students = new Map();
  for (const document of rawData.students ?? []) {
    const student = fromExtendedJson(document);
    assertSafeStudentId(student.studentId);
    if (students.has(student.studentId)) throw new Error(`Duplicate source student: ${student.studentId}`);
    students.set(student.studentId, student);
  }
  const referenced = new Set(ORIGINAL_IDS);
  for (const raw of rawData.meal_days ?? []) {
    const day = fromExtendedJson(raw);
    for (const id of day.participantOrder ?? extractMealParticipantIds(day)) referenced.add(id);
    for (const id of extractMealParticipantIds(day)) referenced.add(id);
  }
  for (const raw of rawData.meal_history_snapshots ?? []) {
    for (const id of raw.participantOrder ?? []) referenced.add(id);
  }
  for (const raw of rawData.meal_history_corrections ?? []) {
    for (const id of raw.snapshot?.participantOrder ?? []) referenced.add(id);
  }
  for (const id of referenced) {
    assertSafeStudentId(id);
    if (!students.has(id)) {
      if (!ORIGINAL_IDS.includes(id)) throw new Error(`Referenced student ${id} has no source identity`);
      students.set(id, { _id: new mongoose.Types.ObjectId(checksumValue(`v3-original-${id}`).slice(0, 24)),
        studentId: id, displayName: id[0].toUpperCase() + id.slice(1),
        status: 'ACTIVE', rosterOrder: ORIGINAL_IDS.indexOf(id),
        mealEligibilityFrom: null, mealEligibilityUntil: null });
    }
  }
  return [...students.values()].sort((a, b) => (a.rosterOrder ?? 9999) - (b.rosterOrder ?? 9999)
    || a.studentId.localeCompare(b.studentId));
}

function checkCorrectionChains(rawData) {
  const days = new Map((rawData.meal_days ?? []).map(raw => [raw.date, fromExtendedJson(raw)]));
  const snapshots = new Map();
  for (const raw of rawData.meal_history_snapshots ?? []) {
    const snapshot = fromExtendedJson(raw);
    const key = `${snapshot.date}:${snapshot.calculationVersion}`;
    if (!days.has(snapshot.date) || snapshot.calculationVersion !== 'legacy-v2') {
      throw new Error(`Orphaned or unsupported historical snapshot for ${key}`);
    }
    if (snapshots.has(key)) throw new Error(`Duplicate historical snapshot for ${key}`);
    snapshots.set(key, snapshot);
  }
  for (const [date, day] of days) {
    if (day.schemaVersion !== 3) verifyLegacyMealSnapshot(day, snapshots.get(`${date}:legacy-v2`));
  }
  const byDate = new Map();
  for (const raw of rawData.meal_history_corrections ?? []) {
    const correction = fromExtendedJson(raw);
    if (!byDate.has(correction.date)) byDate.set(correction.date, []);
    byDate.get(correction.date).push(correction);
  }
  for (const [date, corrections] of byDate) {
    const day = days.get(date);
    if (!day || day.schemaVersion === 3) throw new Error(`Historical correction has no legacy day for ${date}`);
    const baseline = snapshots.get(`${date}:legacy-v2`);
    corrections.sort((a, b) => a.revision - b.revision);
    let previous = baseline.sourceRevision;
    for (const correction of corrections) {
      if (correction.previousRevision !== previous || correction.revision !== previous + 1) {
        throw new Error(`Historical correction revision chain is incomplete for ${date}`);
      }
      const recalculated = buildLegacyMealSnapshot(correction.sourceState);
      recalculated.snapshotId = correction.snapshot?.snapshotId;
      recalculated.calculationVersion = 'legacy-correction-v1';
      if (correction.originalSourceChecksum !== baseline.sourceChecksum
        || correction.snapshot?.date !== date
        || correction.snapshot?.sourceRevision !== correction.revision
        || checksumValue(correction.snapshot) !== correction.snapshotChecksum
        || checksumValue(recalculated) !== checksumValue(correction.snapshot)) {
        throw new Error(`Historical correction authority mismatch for ${date}`);
      }
      previous = correction.revision;
    }
  }
}

function buildPlan(verified) {
  const students = historicalStudents(verified.rawData);
  checkCorrectionChains(verified.rawData);
  const collections = Object.fromEntries(V3_HISTORY_COLLECTIONS.map(name => [name,
    name === 'students' ? students.map(toExtendedJson)
      : name === 'meal_days' ? (verified.rawData[name] ?? []).map(day => ({ ...day,
        importedFromLegacy: true, financialClassification: 'historical',
        cutoverClassificationSource: 'migration-manifest' }))
        : (verified.rawData[name] ?? [])]));
  const dates = (collections.meal_days ?? []).map(day => day.date);
  if (new Set(dates).size !== dates.length) throw new Error('Duplicate source meal dates');
  if (verified.baselines) {
    const capturedByDate = new Map(verified.baselines.calendarDays.map(day => [day.date, day]));
    for (const raw of verified.rawData.meal_days ?? []) {
      const captured = capturedByDate.get(raw.date);
      if (!captured) throw new Error(`Missing archived calendar baseline for ${raw.date}`);
      const expected = authoritativeDay(raw, verified.rawData.meal_history_snapshots ?? [],
        verified.rawData.meal_history_corrections ?? []);
      const comparable = { date: captured.date, revision: captured.revision,
        meals: captured.meals, allocations: captured.allocations, pricing: captured.pricing,
        dailyCostSummary: captured.dailyCostSummary };
      if (checksumValue(comparable) !== checksumValue(expected)) {
        throw new Error(`Archived calendar baseline differs from authoritative meal calculation for ${raw.date}`);
      }
    }
  }
  return {
    format: 'mealkhata-v3-migration-plan-v1',
    sourceDatabase: verified.manifest.sourceDatabase,
    sourceChecksum: verified.manifest.sha256Checksum,
    sourceManifestChecksum: checksumValue(verified.manifest),
    studentIds: students.map(student => student.studentId),
    counts: Object.fromEntries(V3_HISTORY_COLLECTIONS.map(name => [name, collections[name].length])),
    dates: dates.sort(),
    mealDateClassifications: Object.fromEntries(dates.map(date => [date, 'historical'])),
    excludedCollections: Object.keys(verified.rawData).filter(name => !V3_HISTORY_COLLECTIONS.includes(name)).sort(),
    collectionChecksums: Object.fromEntries(V3_HISTORY_COLLECTIONS.map(name => [name, checksumValue(collections[name])])),
    collections,
  };
}

export function planV3Migration(options) {
  const publicPlan = { ...buildPlan(readVerifiedArchive(options)) };
  delete publicPlan.collections;
  return publicPlan;
}

function assertTarget({ targetConnection, targetDbName, sourceDatabase }) {
  if (!targetConnection?.db || !targetDbName || targetConnection.db.databaseName !== targetDbName) {
    throw new Error('An explicit matching target database name and connected target are required');
  }
  if (targetDbName === sourceDatabase || !/(?:^|[-_])(?:v3|target|restore|isolated|fixture)(?:[-_]|$)/i.test(targetDbName)) {
    throw new Error('Source and target must be distinct, and target must be explicitly isolated');
  }
}

async function targetCollectionNames(db) {
  return (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(item => item.name).filter(name => !name.startsWith('system.')).sort();
}

async function ensureIndexes(db) {
  for (const model of INDEX_MODELS) {
    const collection = db.collection(model.collection.name);
    for (const [key, options] of model.schema.indexes()) {
      await collection.createIndex(key, options);
    }
  }
  await db.collection('v3_migration_manifests').createIndex({ migrationId: 1 }, { unique: true });
}

function authoritativeDay(day, snapshots, corrections) {
  const source = fromExtendedJson(day);
  let cooked;
  if (source.schemaVersion === 3) {
    cooked = serializeMealDay(source, source.date);
  } else {
    const corrected = corrections.filter(record => record.date === source.date)
      .sort((a, b) => b.revision - a.revision)[0];
    const snapshot = corrected?.snapshot ?? snapshots.find(record => record.date === source.date
      && record.calculationVersion === 'legacy-v2');
    if (!snapshot) throw new Error(`Missing authoritative historical snapshot for ${source.date}`);
    cooked = serializeLegacyMealSnapshot(fromExtendedJson(snapshot));
  }
  return { date: cooked.date, revision: cooked.revision, meals: cooked.meals,
    allocations: cooked.allocations, pricing: cooked.pricing,
    dailyCostSummary: cooked.dailyCostSummary };
}

function documentId(value) {
  return value?._id?.$oid ?? String(value?._id ?? '');
}

export async function verifyV3Migration(options) {
  const verified = readVerifiedArchive(options);
  const plan = buildPlan(verified);
  const db = options.targetConnection?.db;
  if (!db) throw new Error('A connected target database is required');
  const issues = [];
  const migration = await db.collection('v3_migration_manifests').findOne({ migrationId: MIGRATION_ID });
  const finalDeltas = migration?.finalMealDeltas ?? {};
  const targetSnapshots = (await db.collection('meal_history_snapshots').find({}).toArray()).map(toExtendedJson);
  const targetCorrections = (await db.collection('meal_history_corrections').find({}).toArray()).map(toExtendedJson);
  for (const name of V3_HISTORY_COLLECTIONS) {
    const actual = (await db.collection(name).find({}).sort({ _id: 1 }).toArray()).map(toExtendedJson);
    const expected = [...plan.collections[name]].sort((a, b) => documentId(a).localeCompare(documentId(b)));
    if (name === 'meal_days' && Object.keys(finalDeltas).length) {
      const baseActual = actual.filter(day => !finalDeltas[day.date]);
      const baseExpected = expected.filter(day => !finalDeltas[day.date]);
      if (checksumValue(baseActual) !== checksumValue(baseExpected)) issues.push(`${name}: base source and target document checksum differs`);
      for (const [date, delta] of Object.entries(finalDeltas)) {
        const targetDay = actual.find(day => day.date === date);
        if (!targetDay || checksumValue(targetDay) !== delta.checksum) issues.push(`${name} ${date}: final delta checksum differs`);
      }
    } else if (checksumValue(actual) !== checksumValue(expected)) issues.push(`${name}: source and target document checksum differs`);
    if (name === 'meal_days') {
      const expectedByDate = new Map(expected.map(day => [day.date, day]));
      const sourceByDate = new Map((verified.rawData.meal_days ?? []).map(day => [day.date, day]));
      for (const day of actual) {
        if (finalDeltas[day.date]) continue;
        try {
          const targetAuthority = authoritativeDay(day, targetSnapshots, targetCorrections);
          const sourceAuthority = authoritativeDay(sourceByDate.get(day.date),
            verified.rawData.meal_history_snapshots ?? [], verified.rawData.meal_history_corrections ?? []);
          if (checksumValue(targetAuthority) !== checksumValue(sourceAuthority)
            || checksumValue(authoritativeDay(expectedByDate.get(day.date),
              verified.rawData.meal_history_snapshots ?? [], verified.rawData.meal_history_corrections ?? [])) !== checksumValue(sourceAuthority)) {
            issues.push(`meal_days ${day.date}: authoritative costs or attendance differ by at least one paise`);
          }
          const captured = verified.baselines?.calendarDays?.find(entry => entry.date === day.date);
          if (captured && checksumValue({ date: captured.date, revision: captured.revision,
            meals: captured.meals, allocations: captured.allocations, pricing: captured.pricing,
            dailyCostSummary: captured.dailyCostSummary }) !== checksumValue(sourceAuthority)) {
            issues.push(`meal_days ${day.date}: archived calendar baseline differs from source authority`);
          }
        } catch { issues.push(`meal_days ${day.date}: authoritative calculation failed`); }
      }
    }
  }
  for (const name of await targetCollectionNames(db)) {
    if (!TARGET_COLLECTIONS.includes(name)) issues.push(`Unexpected target collection: ${name}`);
  }
  const indexAudit = await verifyIndexes(options.targetConnection);
  const requiredModels = new Set(INDEX_MODELS.map(model => model.modelName));
  for (const result of indexAudit.results) {
    if (requiredModels.has(result.model) && result.status !== 'PASS') {
      issues.push(`${result.collection}: required v3 indexes are missing or misconfigured (${result.missing.join(', ')})`);
    }
  }
  const dataAudit = await verifyDataIntegrity(options.targetConnection);
  if (!dataAudit.passed) issues.push('Target data integrity audit failed', ...dataAudit.issues);
  const accounts = await db.collection('user_accounts').find({}).toArray();
  const archivedHashes = new Set((verified.rawData.user_accounts ?? []).map(account => account.passwordHash)
    .concat((verified.rawData.member_accounts ?? []).map(account => account.passwordHash)));
  if (accounts.length !== 2 || accounts.some(account => account.role !== 'superadmin' || account.active !== true)
    || new Set(accounts.map(account => account.email)).size !== 2) {
    issues.push('Target must contain two distinct active fresh Super Admin accounts');
  }
  if (accounts.some(account => archivedHashes.has(account.passwordHash))) issues.push('Legacy credential hash was copied');
  if (accounts.some(account => !isValidAccountHash(account.passwordHash))) issues.push('Fresh account hash policy is invalid');
  const settings = await db.collection('system_settings').find({}).toArray();
  if (settings.length !== 1 || settings[0]?.settingsId !== 'system'
    || settings[0]?.financialStartDate != null) {
    issues.push('Exactly one unset financial start boundary is required');
  }
  if (migration?.sourceChecksum !== plan.sourceChecksum) issues.push('Migration manifest source fingerprint mismatch');
  for (const day of await db.collection('meal_days').find({}).toArray()) {
    if (migration?.mealDateClassifications?.[day.date] !== 'historical'
      || day.financialClassification !== 'historical'
      || day.cutoverClassificationSource !== 'migration-manifest'
      || day.importedFromLegacy !== true) {
      issues.push(`meal_days ${day.date}: missing verified financial classification`);
    }
  }
  return { passed: issues.length === 0, issues, counts: plan.counts,
    sourceChecksum: plan.sourceChecksum, targetDatabase: db.databaseName };
}

export async function applyV3Migration(options) {
  const verified = readVerifiedArchive(options);
  const plan = buildPlan(verified);
  const { targetConnection, targetDbName, superAdmin, recoverySuperAdmin } = options;
  assertTarget({ targetConnection, targetDbName, sourceDatabase: plan.sourceDatabase });
  const db = targetConnection.db;
  const existing = await db.collection('v3_migration_manifests').findOne({ migrationId: MIGRATION_ID });
  if (existing) {
    if (existing.status !== 'complete' || existing.sourceChecksum !== plan.sourceChecksum) {
      throw new Error('Partial or foreign migration target requires manual review');
    }
    const verification = await verifyV3Migration(options);
    if (!verification.passed) throw new Error(`Existing migration verification failed: ${verification.issues.join('; ')}`);
    return { status: 'already-complete', verification, rollback: existing.rollback };
  }
  if ((await targetCollectionNames(db)).length > 0) throw new Error('Foreign or nonempty target database is rejected');
  if ([superAdmin, recoverySuperAdmin].some(account => !account
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email ?? '')
    || typeof account.password !== 'string' || account.password.length < 16)
    || superAdmin.email.trim().toLowerCase() === recoverySuperAdmin.email.trim().toLowerCase()
    || superAdmin.password === recoverySuperAdmin.password) {
    throw new Error('Distinct fresh Super Admin and recovery credentials are required from protected inputs');
  }
  const legacyHashes = [...(verified.rawData.user_accounts ?? []),
    ...(verified.rawData.member_accounts ?? [])]
    .map(account => account.passwordHash).filter(isValidAccountHash);
  for (const candidate of [superAdmin.password, recoverySuperAdmin.password]) {
    for (const legacyHash of legacyHashes) {
      if (await bcrypt.compare(candidate, legacyHash)) {
        throw new Error('Fresh Super Admin secrets must differ from archived account credentials');
      }
    }
  }
  const passwordHash = await bcrypt.hash(superAdmin.password, 12);
  const rollback = { sourceDatabase: plan.sourceDatabase, sourceChecksum: plan.sourceChecksum,
    targetDatabase: targetDbName, action: 'switch-connection-to-preserved-source',
    destructiveRollbackAllowed: false };
  const marker = { migrationId: MIGRATION_ID, format: 'mealkhata-v3-migration-manifest-v1',
    status: 'applying', sourceChecksum: plan.sourceChecksum,
    sourceManifestChecksum: plan.sourceManifestChecksum, counts: plan.counts,
    mealDateClassifications: plan.mealDateClassifications,
    collectionChecksums: plan.collectionChecksums, excludedCollections: plan.excludedCollections,
    rollback, checkpoints: [], createdAt: new Date() };
  await db.collection('v3_migration_manifests').insertOne(marker);
  for (const name of V3_HISTORY_COLLECTIONS) {
    const docs = plan.collections[name].map(fromExtendedJson);
    if (docs.length) await db.collection(name).insertMany(docs, { ordered: true });
    await db.collection('v3_migration_manifests').updateOne({ migrationId: MIGRATION_ID },
      { $push: { checkpoints: { collection: name, count: docs.length, checksum: plan.collectionChecksums[name] } } });
  }
  await db.collection('system_settings').insertOne({ settingsId: 'system', financialStartDate: null,
    timezone: 'Asia/Kolkata', revision: 0, configuredAt: null, configuredBy: null });
  await db.collection('user_accounts').insertMany([
    { userId: randomUUID(), email: superAdmin.email.trim().toLowerCase(),
      displayName: 'Super Admin', role: 'superadmin', memberId: null, passwordHash,
      active: true, sessionVersion: 0, passwordChangedAt: new Date() },
    { userId: randomUUID(), email: recoverySuperAdmin.email.trim().toLowerCase(),
      displayName: 'Recovery Super Admin', role: 'superadmin', memberId: null,
      passwordHash: await bcrypt.hash(recoverySuperAdmin.password, 12), active: true,
      sessionVersion: 0, passwordChangedAt: new Date() },
  ]);
  await ensureIndexes(db);
  await db.collection('v3_migration_manifests').updateOne({ migrationId: MIGRATION_ID },
    { $set: { status: 'verifying' } });
  const verification = await verifyV3Migration(options);
  if (!verification.passed) throw new Error(`Migration verification failed: ${verification.issues.join('; ')}`);
  const auth = createAuthService({ config: { canonicalOnlyAuth: true }, accounts: null,
    userAccounts: { findByEmail: async candidate => db.collection('user_accounts').findOne({ email: candidate }),
      updateLastLogin: async () => {} } });
  for (const account of [superAdmin, recoverySuperAdmin]) {
    const login = await auth.authenticateCredentials({ email: account.email, password: account.password });
    if (login.role !== 'superadmin' || !login.userId) throw new Error('Fresh Super Admin or recovery login verification failed');
  }
  await db.collection('v3_migration_manifests').updateOne({ migrationId: MIGRATION_ID },
    { $set: { status: 'complete', completedAt: new Date() } });
  const completedManifest = await db.collection('v3_migration_manifests').findOne({ migrationId: MIGRATION_ID });
  return { status: 'complete', verification, rollback,
    migrationManifest: completedManifest };
}

export async function replayFinalMealDelta(options) {
  const { targetConnection, deltaDocuments, expectedSourceChecksum,
    expectedDeltaChecksum, sourceWritesStopped } = options;
  if (!Array.isArray(deltaDocuments) || !expectedSourceChecksum || !expectedDeltaChecksum
    || sourceWritesStopped !== true || checksumValue(deltaDocuments) !== expectedDeltaChecksum) {
    throw new Error('Verified final meal delta, checksum and write-free confirmation are required');
  }
  if (!targetConnection?.db) throw new Error('A connected target database is required');
  const marker = await targetConnection.db.collection('v3_migration_manifests').findOne({ migrationId: MIGRATION_ID, status: 'complete' });
  if (!marker || marker.sourceChecksum !== expectedSourceChecksum) throw new Error('Target source fingerprint mismatch');
  const knownStudents = new Set((await targetConnection.db.collection('students').find({}).toArray()).map(student => student.studentId));
  const seenDates = new Set();
  const planned = [];
  for (const raw of deltaDocuments) {
    const day = fromExtendedJson(raw);
    if (!day._id || !day.date || seenDates.has(day.date)
      || !Number.isSafeInteger(day.revision) || day.revision < 0) throw new Error('Invalid final meal delta');
    seenDates.add(day.date);
    const participants = new Set([...(day.participantOrder ?? []), ...extractMealParticipantIds(day)]);
    if ([...participants].some(id => !knownStudents.has(id))) throw new Error(`Final meal delta has an unknown student on ${day.date}`);
    day.importedFromLegacy = true;
    day.financialClassification = 'historical';
    day.cutoverClassificationSource = 'migration-manifest';
    const current = await targetConnection.db.collection('meal_days').findOne({ date: day.date });
    if (current && String(current._id) !== String(day._id)) throw new Error('Final meal delta source identity mismatch');
    if (current && day.revision < current.revision) throw new Error('Stale final meal delta');
    if (current && day.revision === current.revision
      && checksumValue(toExtendedJson(current)) !== checksumValue(toExtendedJson(day))) {
      throw new Error('Conflicting final meal delta');
    }
    planned.push({ day, current, checksum: checksumValue(toExtendedJson(day)) });
  }
  for (const { day, current, checksum } of planned) {
    if (!current) await targetConnection.db.collection('meal_days').insertOne(day);
    else if (day.revision > current.revision) {
      const updated = await targetConnection.db.collection('meal_days').replaceOne({ date: day.date, revision: current.revision }, day);
      if (updated.modifiedCount !== 1) throw new Error('Concurrent final meal delta conflict');
    }
    await targetConnection.db.collection('v3_migration_manifests').updateOne({ migrationId: MIGRATION_ID },
      { $set: { [`finalMealDeltas.${day.date}`]: { revision: day.revision, checksum },
        [`mealDateClassifications.${day.date}`]: 'historical' } });
  }
  return { replayed: planned.length, deltaChecksum: expectedDeltaChecksum,
    verifiedDates: planned.map(item => item.day.date) };
}
