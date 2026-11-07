import { BACKUP_COLLECTIONS, verifyAndDecryptBackup } from '../backup/backupEngine.js';
import { isValidLogicalDate } from '../utils/date.js';
import { checksumValue } from './sourceInventory.service.js';
import { planV3Migration } from './v3Migration.service.js';
import { verifyLegacySnapshotSidecar } from './v3SnapshotSidecar.service.js';

/** Produces an archive-only inventory. It never creates a database connection. */
export function createV3SourcePreflight({ archive, sourceManifest, encryptionKey, snapshotSidecar }) {
  const verified = verifyAndDecryptBackup({ backupPackageString: archive, encryptionKey });
  if (checksumValue(verified.manifest) !== checksumValue(sourceManifest)) {
    throw new Error('Source manifest differs from the encrypted archive');
  }
  const raw = verified.rawData;
  const snapshots = snapshotSidecar
    ? verifyLegacySnapshotSidecar({ archive, sourceManifest, encryptionKey, snapshotSidecar }) : [];
  const archivedSnapshots = raw.meal_history_snapshots ?? [];
  const days = raw.meal_days ?? [];
  const legacyDates = days.filter(day => day.schemaVersion !== 3).map(day => day.date);
  const snapshotDates = new Set([...archivedSnapshots, ...snapshots]
    .filter(snapshot => snapshot.calculationVersion === 'legacy-v2').map(snapshot => snapshot.date));
  const missing = legacyDates.filter(date => !snapshotDates.has(date));
  if (missing.length) throw new Error(`Missing verified historical snapshot authority for ${missing.length} date(s)`);

  const issues = [];
  const known = new Set(BACKUP_COLLECTIONS);
  for (const name of verified.manifest.collectionOrder ?? []) {
    if (!known.has(name)) issues.push(`Unexpected source collection: ${name}`);
  }
  const dates = days.map(day => day.date).sort();
  if (new Set(dates).size !== dates.length) issues.push('Duplicate meal dates in source archive');
  for (const day of days) {
    if (!isValidLogicalDate(day.date) || !Number.isSafeInteger(day.revision) || day.revision < 0) {
      issues.push(`Malformed meal day: ${String(day.date)}`);
    }
  }
  let migrationPlan = null;
  try {
    migrationPlan = planV3Migration({ archive, sourceManifest, encryptionKey, snapshotSidecar });
  } catch {
    issues.push('Historical migration plan could not verify source records or correction authority');
  }
  const participants = new Set();
  for (const day of days) {
    for (const id of day.participantOrder ?? []) participants.add(id);
    for (const mealType of ['morning', 'night']) {
      for (const id of Object.keys(day.meals?.[mealType] ?? {})) participants.add(id);
    }
  }
  const monthlyBaselines = verified.baselines?.monthlyCostReports ?? [];
  const memberAmountsPaise = {};
  for (const month of monthlyBaselines) {
    for (const [id, amount] of Object.entries(month.memberAmountsPaise ?? {})) {
      if (!Number.isSafeInteger(amount)) issues.push(`Invalid historical paise total in ${month.month}`);
      memberAmountsPaise[id] = (memberAmountsPaise[id] ?? 0) + amount;
    }
  }
  const householdAmountPaise = monthlyBaselines.reduce((sum, month) =>
    sum + (month.householdAmountPaise ?? month.roomAmountPaise ?? 0), 0);
  if (!Number.isSafeInteger(householdAmountPaise)
    || Object.values(memberAmountsPaise).reduce((sum, amount) => sum + amount, 0) !== householdAmountPaise) {
    issues.push('Historical monthly baselines do not conserve exact integer paise');
  }
  const collections = Object.fromEntries((verified.manifest.collectionOrder ?? []).map(name => [name, {
    count: verified.manifest.collectionMetadata?.[name]?.count ?? raw[name]?.length ?? 0,
    sha256Checksum: verified.manifest.collectionMetadata?.[name]?.sha256Checksum ?? null,
    indexes: verified.manifest.collectionMetadata?.[name]?.indexes ?? [],
  }]));
  return {
    passed: issues.length === 0 && Boolean(migrationPlan), issues,
    sourceDatabase: verified.manifest.sourceDatabase,
    archiveFingerprint: verified.manifest.sha256Checksum,
    manifestFingerprint: checksumValue(verified.manifest),
    collections,
    mealDates: { count: dates.length, first: dates[0] ?? null, last: dates.at(-1) ?? null,
      months: [...new Set(dates.map(date => date.slice(0, 7)))].sort() },
    participantIds: [...participants].sort(),
    originalIdsPresent: ['gaurav', 'nikhil', 'devansh'].filter(id => participants.has(id)),
    snapshots: { archivedCount: archivedSnapshots.length, sidecarCount: snapshots.length,
      legacyDateCount: legacyDates.length, corrections: (raw.meal_history_corrections ?? []).length },
    monthlyRates: { count: (raw.monthly_meal_rates ?? []).length,
      months: (raw.monthly_meal_rates ?? []).map(rate => rate.month).sort() },
    historicalCosts: { householdAmountPaise, memberAmountsPaise,
      monthlyReports: monthlyBaselines.map(({ month, householdAmountPaise: total }) => ({ month, householdAmountPaise: total })) },
    migrationPlanChecksum: migrationPlan?.sourceChecksum ?? null,
  };
}
