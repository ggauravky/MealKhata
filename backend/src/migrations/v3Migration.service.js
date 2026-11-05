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
import { isValidLogicalDate } from '../utils/date.js';
import { checksumValue } from './sourceInventory.service.js';
import { verifyLegacySnapshotSidecar } from './v3SnapshotSidecar.service.js';
import { auditV3OperationalFinances } from './v3OperationalFinanceAudit.service.js';

export const V3_HISTORY_COLLECTIONS = Object.freeze([
  'students', 'student_audit_events', 'meal_days', 'meal_history_snapshots',
  'meal_history_corrections', 'monthly_meal_rates',
]);
const TARGET_COLLECTIONS = Object.freeze([...V3_HISTORY_COLLECTIONS, 'user_accounts', 'system_settings', 'v3_migration_manifests']);
const LEGACY_OPERATIONAL_IDENTIFIERS = Object.freeze({
  payments: 'paymentId', monthly_settlements: 'settlementId',
  rooms: 'roomId', room_assignments: 'assignmentId', room_fee_plans: 'feePlanId',
  room_charges: 'chargeId', room_payments: 'roomPaymentId',
  expenses: 'expenseId', expense_reimbursements: 'reimbursementId',
  hostel_stays: 'stayId', hostel_deposit_accounts: 'depositAccountId',
  hostel_deposit_transactions: 'depositTransactionId', hostel_clearances: 'clearanceId',
  payment_reclassifications: 'reclassificationId', unallocated_credits: 'creditId',
  credit_allocations: 'creditAllocationId', payment_reference_claims: 'normalizedReference',
});
const INDEX_MODELS = [Student, StudentAuditEvent, MealDay, MealHistorySnapshot,
  MealHistoricalCorrection, MonthlyMealRate, UserAccount, SystemSettings];
const ORIGINAL_IDS = ['gaurav', 'nikhil', 'devansh'];
const MIGRATION_ID = 'mealkhata-v3-blue-green';
const MAX_FINAL_DELTA_DOCUMENTS = 256;
const MAX_FINAL_DELTA_BYTES = 8 * 1024 * 1024;

function isValidAccountHash(value) {
  try { return typeof value === 'string' && bcrypt.getRounds(value) === 12; }
  catch { return false; }
}

function readVerifiedArchive({ archive, encryptionKey, sourceManifest, snapshotSidecar }) {
  if (!sourceManifest || typeof sourceManifest !== 'object') throw new Error('An explicit source manifest is required');
  const verified = verifyAndDecryptBackup({ backupPackageString: archive, encryptionKey });
  if (checksumValue(verified.manifest) !== checksumValue(sourceManifest)) {
    throw new Error('Explicit source manifest does not match verified encrypted archive');
  }
  if (!verified.manifest.sourceDatabase || !verified.manifest.sha256Checksum) {
    throw new Error('Source archive lacks a database identity or fingerprint');
  }
  if (snapshotSidecar) {
    const snapshots = verifyLegacySnapshotSidecar({ archive, encryptionKey, sourceManifest, snapshotSidecar });
    verified.rawData.meal_history_snapshots = [
      ...(verified.rawData.meal_history_snapshots ?? []), ...snapshots,
    ];
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

export function assertIsolatedMigrationTargetUri(uri, targetClassification, sourceDatabase) {
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error('Invalid isolated target URI'); }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const hosts = parsed.host.split(',').map(host => host.replace(/:\d+$/, '').toLowerCase());
  if (parsed.protocol !== 'mongodb:' || targetClassification !== 'isolated-test'
    || !hosts.length || hosts.some(host => !['127.0.0.1', 'localhost', '[::1]'].includes(host))
    || !name || name === sourceDatabase
    || /(?:^|[-_])(prod|production|live|atlas)(?:[-_]|$)/i.test(name)) {
    throw new Error('Migration URI requires isolated-test classification and a local disposable cluster');
  }
  return name;
}

export async function assertIsolatedMigrationTarget({ targetConnection, targetDbName, sourceDatabase, targetClassification }) {
  if (!targetConnection?.db || !targetDbName || targetConnection.db.databaseName !== targetDbName) {
    throw new Error('An explicit matching target database name and connected target are required');
  }
  if (targetDbName === sourceDatabase) {
    throw new Error('Source and target must be distinct');
  }
  const hosts = targetConnection.client?.options?.hosts ?? [];
  if (targetClassification !== 'isolated-test' || !hosts.length
    || hosts.some(host => !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.host))
    || /(?:^|[-_])(prod|production|live|atlas)(?:[-_]|$)/i.test(targetDbName)) {
    throw new Error('Migration target requires isolated-test classification on a local disposable cluster');
  }
  const hello = await targetConnection.db.admin().command({ hello: 1 });
  const clusterHosts = hello.hosts ?? [];
  if (!hello.setName || !clusterHosts.length || clusterHosts.some(host =>
    !/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(host))) {
    throw new Error('Migration target must identify as an isolated local replica set');
  }
  return checksumValue({ setName: hello.setName, hosts: [...clusterHosts].sort() });
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

async function verifyPostCutoverBoundary(db, settings, issues) {
  const start = settings?.financialStartDate;
  if (start != null && !isValidLogicalDate(start)) {
    issues.push('Configured financial start boundary is invalid');
    return;
  }
  const startMonth = start?.slice(0, 7);
  const ledgers = [
    { collection: 'payments', field: 'month', month: true },
    { collection: 'room_charges', field: 'month', month: true, fullMonth: true },
    { collection: 'room_payments', field: 'month', month: true },
    { collection: 'monthly_settlements', field: 'month', month: true, fullMonth: true },
    { collection: 'expenses', field: 'date', month: false },
  ];
  for (const ledger of ledgers) {
    const rows = await db.collection(ledger.collection).find({}).toArray();
    if (rows.length && !start) {
      issues.push(`${ledger.collection}: operational records exist without a financial start boundary`);
      continue;
    }
    for (const row of rows) {
      const value = row[ledger.field];
      const invalid = typeof value !== 'string' || (ledger.month
        ? !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value < startMonth
          || (ledger.fullMonth && value === startMonth && !start.endsWith('-01'))
        : !isValidLogicalDate(value) || value < start);
      if (invalid) issues.push(`${ledger.collection}: record precedes or violates the financial start boundary`);
    }
  }
}

export async function verifyV3Migration(options) {
  const archived = readVerifiedArchive(options);
  const originalPlan = buildPlan(archived);
  const verified = options.finalArchive ? readVerifiedArchive({ archive: options.finalArchive,
    sourceManifest: options.finalSourceManifest, encryptionKey: options.encryptionKey,
    snapshotSidecar: options.finalSnapshotSidecar }) : archived;
  const plan = options.finalArchive ? buildPlan(verified) : originalPlan;
  const db = options.targetConnection?.db;
  if (!db) throw new Error('A connected target database is required');
  const issues = [];
  const verificationStage = options.verificationStage ?? 'pre-cutover';
  if (!['pre-cutover', 'post-cutover'].includes(verificationStage)) throw new Error('Unknown migration verification stage');
  const postCutover = verificationStage === 'post-cutover';
  const migration = await db.collection('v3_migration_manifests').findOne({ migrationId: MIGRATION_ID });
  if (options.targetClassification) {
    const clusterIdentity = await assertIsolatedMigrationTarget({ targetConnection: options.targetConnection,
      targetDbName: db.databaseName, sourceDatabase: originalPlan.sourceDatabase,
      targetClassification: options.targetClassification });
    if (migration?.targetClusterIdentity !== clusterIdentity) issues.push('Target cluster identity changed');
  }
  const finalDeltas = migration?.finalMealDeltas ?? {};
  if (migration?.finalSourceChecksum && !options.finalArchive) {
    issues.push('Final frozen source archive is required to verify replayed history');
  }
  if (options.finalArchive && (migration?.finalSourceChecksum !== plan.sourceChecksum
    || plan.sourceDatabase !== originalPlan.sourceDatabase)) {
    issues.push('Final frozen source archive identity or checksum mismatch');
  }
  const targetSnapshots = (await db.collection('meal_history_snapshots').find({}).toArray()).map(toExtendedJson);
  const targetCorrections = (await db.collection('meal_history_corrections').find({}).toArray()).map(toExtendedJson);
  const frozenCorrectionIds = new Set(plan.collections.meal_history_corrections.map(documentId));
  const frozenTargetCorrections = targetCorrections.filter(record => frozenCorrectionIds.has(documentId(record)));
  const currentHistoricalAuthorities = {};
  let targetMealDays = [];
  for (const name of V3_HISTORY_COLLECTIONS) {
    const actual = (await db.collection(name).find({}).sort({ _id: 1 }).toArray()).map(toExtendedJson);
    if (name === 'meal_days') targetMealDays = actual;
    const expected = [...plan.collections[name]].sort((a, b) => documentId(a).localeCompare(documentId(b)));
    if (postCutover && name === 'students') {
      const actualIds = new Set(actual.map(student => student.studentId));
      for (const student of expected) if (!actualIds.has(student.studentId)) issues.push(`Missing historical student ${student.studentId}`);
    } else if (postCutover) {
      const actualById = new Map(actual.map(doc => [documentId(doc), doc]));
      for (const doc of expected) {
        if (checksumValue(actualById.get(documentId(doc))) !== checksumValue(doc)) {
          issues.push(`${name}: historical source document changed or disappeared`);
        }
      }
    } else if (checksumValue(actual) !== checksumValue(expected)) issues.push(`${name}: source and target document checksum differs`);
    if (name === 'meal_days') {
      const expectedByDate = new Map(expected.map(day => [day.date, day]));
      const sourceByDate = new Map((verified.rawData.meal_days ?? []).map(day => [day.date, day]));
      for (const day of actual) {
        if (postCutover && !sourceByDate.has(day.date)) continue;
        try {
          const targetAuthority = authoritativeDay(day, targetSnapshots, frozenTargetCorrections);
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
          if (postCutover && day.schemaVersion !== 3) {
            currentHistoricalAuthorities[day.date] = checksumValue(authoritativeDay(day,
              targetSnapshots, targetCorrections));
          }
        } catch { issues.push(`meal_days ${day.date}: authoritative calculation failed`); }
      }
    }
  }
  if (postCutover) {
    try {
      checkCorrectionChains({ meal_days: targetMealDays,
        meal_history_snapshots: targetSnapshots,
        meal_history_corrections: targetCorrections });
      for (const correction of targetCorrections) {
        if (frozenCorrectionIds.has(documentId(correction))) continue;
        const appended = fromExtendedJson(correction);
        if (appended.actorRole !== 'superadmin'
          || typeof appended.reason !== 'string' || appended.reason.trim().length < 3
          || !['status', 'allocation', 'clearAllocation', 'price', 'clearPrice'].includes(appended.operation)
          || !['morning', 'night'].includes(appended.mealType)
          || !(appended.createdAt instanceof Date) || Number.isNaN(appended.createdAt.getTime())) {
          issues.push(`meal_history_corrections ${correction.date}: appended correction lacks authorized audit metadata`);
        }
      }
    } catch {
      issues.push('Appended historical correction chain or exact integer-paise authority is invalid');
    }
  }
  for (const name of await targetCollectionNames(db)) {
    if (!postCutover && !TARGET_COLLECTIONS.includes(name)) issues.push(`Unexpected target collection: ${name}`);
    if (postCutover && plan.excludedCollections.includes(name)) {
      const archivedIds = new Set((verified.rawData[name] ?? []).map(documentId));
      const naturalKey = LEGACY_OPERATIONAL_IDENTIFIERS[name];
      const archivedKeys = new Set((verified.rawData[name] ?? [])
        .map(row => row[naturalKey]).filter(value => value != null && value !== ''));
      for (const record of await db.collection(name).find({}).toArray()) {
        if (archivedIds.has(documentId(toExtendedJson(record)))) issues.push(`${name}: old operational record was imported`);
        if (naturalKey && archivedKeys.has(record[naturalKey])) {
          issues.push(`${name}: old operational ${naturalKey} was reused`);
        }
      }
    }
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
  const archivedHashes = new Set((archived.rawData.user_accounts ?? []).map(account => account.passwordHash)
    .concat((archived.rawData.member_accounts ?? []).map(account => account.passwordHash)));
  if ((!postCutover && (accounts.length !== 2 || accounts.some(account => account.role !== 'superadmin' || account.active !== true)))
    || accounts.filter(account => account.role === 'superadmin' && account.active === true).length < 2
    || new Set(accounts.map(account => account.email)).size !== accounts.length
    || new Set(accounts.filter(account => account.memberId).map(account => account.memberId)).size
      !== accounts.filter(account => account.memberId).length) {
    issues.push('Target account roles, recovery access or uniqueness are invalid');
  }
  if (accounts.some(account => archivedHashes.has(account.passwordHash))) issues.push('Legacy credential hash was copied');
  if (accounts.some(account => !isValidAccountHash(account.passwordHash))) issues.push('Fresh account hash policy is invalid');
  const settings = await db.collection('system_settings').find({}).toArray();
  if (settings.length !== 1 || settings[0]?.settingsId !== 'system'
    || (!postCutover && settings[0]?.financialStartDate != null)) {
    issues.push('Financial start boundary state is invalid for verification stage');
  }
  if (postCutover) {
    await verifyPostCutoverBoundary(db, settings[0], issues);
    const financeAudit = await auditV3OperationalFinances(db, settings[0]?.financialStartDate);
    if (!financeAudit.passed) issues.push(...financeAudit.issues);
  }
  if (migration?.sourceChecksum !== originalPlan.sourceChecksum) issues.push('Migration manifest source fingerprint mismatch');
  for (const [date, delta] of Object.entries(finalDeltas)) {
    const actual = await db.collection('meal_days').findOne({ date });
    let authorityChecksum = null;
    try { if (actual) authorityChecksum = checksumValue(authoritativeDay(toExtendedJson(actual), targetSnapshots, frozenTargetCorrections)); }
    catch { /* Invalid authority is reported below. */ }
    if (!actual || checksumValue(toExtendedJson(actual)) !== delta.dayChecksum
      || authorityChecksum !== delta.authorityChecksum) {
      issues.push(`meal_days ${date}: final authority or per-date checksum differs`);
    }
  }
  for (const day of await db.collection('meal_days').find({ importedFromLegacy: true }).toArray()) {
    if (migration?.mealDateClassifications?.[day.date] !== 'historical'
      || day.financialClassification !== 'historical'
      || day.cutoverClassificationSource !== 'migration-manifest'
      || day.importedFromLegacy !== true) {
      issues.push(`meal_days ${day.date}: missing verified financial classification`);
    }
  }
  return { passed: issues.length === 0, issues, verificationStage, counts: plan.counts,
    sourceChecksum: originalPlan.sourceChecksum, finalSourceChecksum: migration?.finalSourceChecksum ?? null,
    currentHistoricalAuthorityChecksum: postCutover ? checksumValue(currentHistoricalAuthorities) : null,
    targetDatabase: db.databaseName };
}

export async function applyV3Migration(options) {
  const verified = readVerifiedArchive(options);
  const plan = buildPlan(verified);
  const { targetConnection, targetDbName, targetClassification, superAdmin, recoverySuperAdmin } = options;
  const targetClusterIdentity = await assertIsolatedMigrationTarget({ targetConnection, targetDbName,
    sourceDatabase: plan.sourceDatabase, targetClassification });
  const db = targetConnection.db;
  const existing = await db.collection('v3_migration_manifests').findOne({ migrationId: MIGRATION_ID });
  if (existing) {
    if (existing.targetClusterIdentity !== targetClusterIdentity) throw new Error('Migration target cluster identity changed');
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
    rollback, targetClusterIdentity, checkpoints: [], createdAt: new Date() };
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
  const { targetConnection, archive, sourceManifest, encryptionKey,
    finalArchive, finalSourceManifest, sourceWritesStopped, targetClassification } = options;
  if (sourceWritesStopped !== true || !finalArchive || !finalSourceManifest) {
    throw new Error('A verified frozen final source archive and write-free confirmation are required');
  }
  const base = buildPlan(readVerifiedArchive({ archive, sourceManifest, encryptionKey,
    snapshotSidecar: options.snapshotSidecar }));
  const final = buildPlan(readVerifiedArchive({ archive: finalArchive,
    sourceManifest: finalSourceManifest, encryptionKey,
    snapshotSidecar: options.finalSnapshotSidecar }));
  const targetClusterIdentity = await assertIsolatedMigrationTarget({ targetConnection, targetDbName: targetConnection?.db?.databaseName,
    sourceDatabase: base.sourceDatabase, targetClassification });
  if (base.sourceDatabase !== final.sourceDatabase) throw new Error('Final source database identity changed');
  const domain = ['meal_days', 'meal_history_snapshots', 'meal_history_corrections', 'monthly_meal_rates'];
  const baseArchive = readVerifiedArchive({ archive, sourceManifest, encryptionKey,
    snapshotSidecar: options.snapshotSidecar });
  const finalArchiveData = readVerifiedArchive({ archive: finalArchive,
    sourceManifest: finalSourceManifest, encryptionKey,
    snapshotSidecar: options.finalSnapshotSidecar });
  const collectionNames = new Set([...Object.keys(baseArchive.rawData), ...Object.keys(finalArchiveData.rawData)]);
  const nonMealChanges = [...collectionNames].filter(name => !domain.includes(name)
    && (checksumValue(baseArchive.rawData[name] ?? [])
      !== checksumValue(finalArchiveData.rawData[name] ?? [])
      || checksumValue(baseArchive.manifest.collectionMetadata?.[name]?.indexes ?? [])
        !== checksumValue(finalArchiveData.manifest.collectionMetadata?.[name]?.indexes ?? []))).sort();
  if (nonMealChanges.length) {
    const review = options.nonMealChangeReview;
    if (!review) throw new Error(`Final source changed outside the verified meal domain: ${nonMealChanges.join(', ')}`);
    if (review.format !== 'mealkhata-v3-nonmeal-review-v1'
      || review.baseArchiveSha256 !== base.sourceChecksum
      || review.finalArchiveSha256 !== final.sourceChecksum
      || review.decision !== 'acknowledge-excluded-v2-only'
      || typeof review.reason !== 'string' || review.reason.trim().length < 10
      || !Array.isArray(review.changes) || review.changes.length !== nonMealChanges.length
      || Object.keys(review).some(key => !['format', 'baseArchiveSha256',
        'finalArchiveSha256', 'decision', 'reason', 'changes'].includes(key))) {
      throw new Error('Non-meal source change review is missing or bound to the wrong archive fingerprint');
    }
    const reviewedNames = new Set();
    for (const item of review.changes) {
      if (!item || !nonMealChanges.includes(item.collection) || reviewedNames.has(item.collection)
        || Object.keys(item).some(key => !['collection', 'baseChecksum', 'finalChecksum',
          'baseCount', 'finalCount', 'baseIndexesChecksum', 'finalIndexesChecksum'].includes(key))) {
        throw new Error('Non-meal source change review has an unexpected collection');
      }
      reviewedNames.add(item.collection);
      const before = baseArchive.manifest.collectionMetadata?.[item.collection];
      const after = finalArchiveData.manifest.collectionMetadata?.[item.collection];
      if (item.baseChecksum !== (before?.sha256Checksum ?? checksumValue([]))
        || item.finalChecksum !== (after?.sha256Checksum ?? checksumValue([]))
        || item.baseCount !== (before?.count ?? 0)
        || item.finalCount !== (after?.count ?? 0)
        || item.baseIndexesChecksum !== checksumValue(before?.indexes ?? [])
        || item.finalIndexesChecksum !== checksumValue(after?.indexes ?? [])) {
        throw new Error(`Non-meal source change review checksum or count differs: ${item.collection}`);
      }
    }
  }
  for (const name of domain) {
    const finalIds = new Set(final.collections[name].map(documentId));
    for (const previous of base.collections[name]) {
      if (!finalIds.has(documentId(previous))) throw new Error(`Final source removed historical ${name} document`);
    }
  }
  const db = targetConnection.db;
  const markerCollection = db.collection('v3_migration_manifests');
  const marker = await markerCollection.findOne({ migrationId: MIGRATION_ID, status: 'complete' });
  if (!marker || marker.sourceChecksum !== base.sourceChecksum
    || marker.targetClusterIdentity !== targetClusterIdentity) throw new Error('Target source or cluster fingerprint mismatch');
  if (marker.finalSourceChecksum && marker.finalSourceChecksum !== final.sourceChecksum) {
    throw new Error('A different frozen final source was already replayed');
  }
  const knownStudents = new Set((await db.collection('students').find({}).toArray()).map(student => student.studentId));
  for (const raw of final.collections.meal_days) {
    const day = fromExtendedJson(raw);
    const participants = new Set([...(day.participantOrder ?? []), ...extractMealParticipantIds(day)]);
    if ([...participants].some(id => !knownStudents.has(id))) {
      throw new Error(`Final meal source references an unknown student on ${day.date}`);
    }
  }
  const baseDocs = Object.fromEntries(domain.map(name => [name,
    new Map(base.collections[name].map(doc => [documentId(doc), doc]))]));
  const changed = Object.fromEntries(domain.map(name => [name,
    final.collections[name].filter(doc => checksumValue(doc)
      !== checksumValue(baseDocs[name].get(documentId(doc)) ?? null))]));
  const deltaCount = domain.reduce((total, name) => total + changed[name].length, 0);
  if (deltaCount > MAX_FINAL_DELTA_DOCUMENTS
    || Buffer.byteLength(JSON.stringify(changed)) > MAX_FINAL_DELTA_BYTES) {
    throw new Error('Final meal delta exceeds one safe transaction; take a new base archive and target');
  }
  const changedDates = new Set(changed.meal_days.map(doc => doc.date));
  for (const name of ['meal_history_snapshots', 'meal_history_corrections']) {
    for (const doc of changed[name]) changedDates.add(doc.date);
  }
  for (const rate of changed.monthly_meal_rates) {
    for (const day of final.collections.meal_days) if (day.date.startsWith(`${rate.month}-`)) changedDates.add(day.date);
  }
  const sourceSnapshots = final.collections.meal_history_snapshots;
  const sourceCorrections = final.collections.meal_history_corrections;
  const finalDays = new Map(final.collections.meal_days.map(day => [day.date, day]));
  const authorities = Object.fromEntries([...changedDates].map(date => {
    const day = finalDays.get(date);
    if (!day) throw new Error(`Final meal authority missing day ${date}`);
    return [date, { dayChecksum: checksumValue(day),
      authorityChecksum: checksumValue(authoritativeDay(day, sourceSnapshots, sourceCorrections)),
      revision: day.revision }];
  }));
  const session = await targetConnection.startSession();
  try {
    await session.withTransaction(async () => {
      const activeMarker = await markerCollection.findOne({ migrationId: MIGRATION_ID, status: 'complete' }, { session });
      if (!activeMarker || activeMarker.sourceChecksum !== base.sourceChecksum
        || (activeMarker.finalSourceChecksum && activeMarker.finalSourceChecksum !== final.sourceChecksum)) {
        throw new Error('Concurrent or foreign final replay checkpoint');
      }
      await markerCollection.updateOne({ migrationId: MIGRATION_ID, status: 'complete' },
        { $set: { status: 'replaying' } }, { session });
      for (const name of domain) {
        for (const raw of changed[name]) {
          const id = fromExtendedJson(raw)._id;
          if (!id) throw new Error(`Final ${name} document lacks an immutable ID`);
          const current = await db.collection(name).findOne({ _id: id }, { session });
          const currentChecksum = checksumValue(current ? toExtendedJson(current) : null);
          const previousChecksum = checksumValue(baseDocs[name].get(documentId(raw)) ?? null);
          if (currentChecksum !== previousChecksum && currentChecksum !== checksumValue(raw)) {
            throw new Error(`Concurrent or mismatched ${name} target document`);
          }
          if (currentChecksum !== checksumValue(raw)) {
            await db.collection(name).replaceOne({ _id: id }, fromExtendedJson(raw), { upsert: !current, session });
          }
        }
      }
      if (options.onBeforeCheckpoint) await options.onBeforeCheckpoint();
      const targetSnapshots = (await db.collection('meal_history_snapshots').find({}, { session }).toArray()).map(toExtendedJson);
      const targetCorrections = (await db.collection('meal_history_corrections').find({}, { session }).toArray()).map(toExtendedJson);
      for (const [date, expected] of Object.entries(authorities)) {
        const actual = await db.collection('meal_days').findOne({ date }, { session });
        if (!actual || checksumValue(toExtendedJson(actual)) !== expected.dayChecksum
          || checksumValue(authoritativeDay(toExtendedJson(actual), targetSnapshots, targetCorrections))
            !== expected.authorityChecksum) {
          throw new Error(`Final meal authority differs by at least one paise on ${date}`);
        }
      }
      await markerCollection.updateOne({ migrationId: MIGRATION_ID, status: 'replaying' },
        { $set: { status: 'complete', finalSourceChecksum: final.sourceChecksum,
          finalSourceManifestChecksum: final.sourceManifestChecksum,
          finalMealDeltas: authorities,
          mealDateClassifications: final.mealDateClassifications },
          $inc: { finalReplayRevision: 1 } }, { session });
    });
  } finally { await session.endSession(); }
  const verification = await verifyV3Migration({ ...options, targetConnection });
  if (!verification.passed) throw new Error(`Final source reconciliation failed: ${verification.issues.join('; ')}`);
  return { replayed: changed.meal_days.length, verifiedDates: [...changedDates].sort(),
    finalSourceChecksum: final.sourceChecksum, verification };
}
