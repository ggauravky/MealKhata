import { verifyAndDecryptBackup } from '../backup/backupEngine.js';
import { checksumValue } from './sourceInventory.service.js';
import { authoritativeDay, planV3Migration } from './v3Migration.service.js';
import { verifyLegacySnapshotSidecar } from './v3SnapshotSidecar.service.js';

function auditFacts(day) {
  return { changes: day.changes ?? [], allocationChanges: day.allocationChanges ?? [],
    priceChanges: day.priceChanges ?? [], createdAt: day.createdAt ?? null,
    updatedAt: day.updatedAt ?? null, revision: day.revision };
}

function costForDay(authority) {
  const students = Object.fromEntries(Object.entries(authority.dailyCostSummary?.members ?? {})
    .map(([id, costs]) => [id, costs.totalAmountPaise]));
  const household = authority.dailyCostSummary?.room?.totalAmountPaise;
  if (!Number.isSafeInteger(household) || household < 0
    || Object.values(students).some(value => !Number.isSafeInteger(value) || value < 0)
    || Object.values(students).reduce((sum, value) => sum + value, 0) !== household) {
    throw new Error(`Historical costs do not conserve exact integer paise for ${authority.date}`);
  }
  return { household, students };
}

function addCosts(bucket, cost) {
  bucket.householdAmountPaise += cost.household;
  for (const [id, amount] of Object.entries(cost.students)) {
    bucket.studentAmountsPaise[id] = (bucket.studentAmountsPaise[id] ?? 0) + amount;
  }
  if (!Number.isSafeInteger(bucket.householdAmountPaise)
    || Object.values(bucket.studentAmountsPaise).some(value => !Number.isSafeInteger(value))) {
    throw new Error('Historical monthly paise total exceeds safe integer precision');
  }
}

/** Protected, deterministic cost evidence from an authenticated archive and optional proposed target. */
export function buildHistoricalCostEvidence({ archive, sourceManifest, encryptionKey,
  snapshotSidecar, targetHistory = null, financialStartDate = null }) {
  const verified = verifyAndDecryptBackup({ backupPackageString: archive, encryptionKey });
  if (checksumValue(verified.manifest) !== checksumValue(sourceManifest)
    || !verified.baselines?.calendarDays || !verified.baselines?.monthlyCostReports) {
    throw new Error('Historical source archive requires authenticated daily and monthly baselines');
  }
  const plan = planV3Migration({ archive, sourceManifest, encryptionKey, snapshotSidecar });
  const sidecarSnapshots = snapshotSidecar
    ? verifyLegacySnapshotSidecar({ archive, sourceManifest, encryptionKey, snapshotSidecar }) : [];
  const sourceDays = verified.rawData.meal_days ?? [];
  const sourceSnapshots = [...(verified.rawData.meal_history_snapshots ?? []), ...sidecarSnapshots];
  const sourceCorrections = verified.rawData.meal_history_corrections ?? [];
  const targetDays = targetHistory?.meal_days ?? [];
  const sourceDates = sourceDays.map(day => day.date);
  if (new Set(sourceDates).size !== sourceDates.length) throw new Error('Duplicate historical source date');
  const targetByDate = new Map(targetDays.map(day => [day.date, day]));
  if (targetHistory && (targetByDate.size !== targetDays.length || targetByDate.size !== sourceDays.length
    || sourceDates.some(date => !targetByDate.has(date)))) {
    throw new Error('Proposed target has a duplicate or missing historical date');
  }
  const archivedByDate = new Map(verified.baselines.calendarDays.map(day => [day.date, day]));
  if (archivedByDate.size !== sourceDays.length) {
    throw new Error('Archived daily cost baseline has a missing or duplicate date');
  }
  if (targetHistory && (checksumValue(targetHistory.meal_history_corrections ?? [])
    !== checksumValue(sourceCorrections)
    || checksumValue(targetHistory.meal_history_snapshots ?? []) !== checksumValue(sourceSnapshots))) {
    throw new Error('Proposed target historical snapshot or correction authority differs from frozen source');
  }
  const daily = [];
  const months = {};
  const total = { householdAmountPaise: 0, studentAmountsPaise: {} };
  for (const day of [...sourceDays].sort((a, b) => a.date.localeCompare(b.date))) {
    const sourceAuthority = authoritativeDay(day, sourceSnapshots, sourceCorrections);
    const archived = archivedByDate.get(day.date);
    const comparable = archived && { date: archived.date, revision: archived.revision,
      meals: archived.meals, allocations: archived.allocations,
      pricing: archived.pricing, dailyCostSummary: archived.dailyCostSummary };
    if (!comparable || checksumValue(comparable) !== checksumValue(sourceAuthority)) {
      throw new Error(`Archived historical authority differs for ${day.date}`);
    }
    let targetChecksum = null;
    if (targetHistory) {
      const proposed = targetByDate.get(day.date);
      if (checksumValue(auditFacts(proposed)) !== checksumValue(auditFacts(day))) {
        throw new Error(`Proposed target historical audit or timestamp differs for ${day.date}`);
      }
      const targetAuthority = authoritativeDay(proposed,
        targetHistory.meal_history_snapshots ?? [], targetHistory.meal_history_corrections ?? []);
      targetChecksum = checksumValue(targetAuthority);
      if (targetChecksum !== checksumValue(sourceAuthority)) {
        throw new Error(`Proposed target historical cost or authority differs by at least one paise for ${day.date}`);
      }
    }
    const costs = costForDay(sourceAuthority);
    const month = day.date.slice(0, 7);
    months[month] ??= { householdAmountPaise: 0, studentAmountsPaise: {}, dayCount: 0 };
    months[month].dayCount += 1;
    addCosts(months[month], costs);
    addCosts(total, costs);
    daily.push({ date: day.date, revision: day.revision, schemaVersion: day.schemaVersion ?? 2,
      sourceDocumentSha256: checksumValue(day),
      auditSha256: checksumValue(auditFacts(day)),
      sourceAuthoritySha256: checksumValue(sourceAuthority),
      archiveAuthoritySha256: checksumValue(comparable), targetAuthoritySha256: targetChecksum,
      householdAmountPaise: costs.household, studentAmountsPaise: costs.students });
  }
  const archivedMonths = verified.baselines.monthlyCostReports;
  if (archivedMonths.length !== Object.keys(months).length) {
    throw new Error('Historical monthly baseline has missing or duplicate months');
  }
  for (const report of archivedMonths) {
    const computed = months[report.month];
    if (!computed || report.householdAmountPaise !== computed.householdAmountPaise
      || checksumValue(report.memberAmountsPaise ?? {})
        !== checksumValue(computed.studentAmountsPaise)) {
      throw new Error(`Historical monthly integer-paise mismatch for ${report.month}`);
    }
  }
  return { format: 'mealkhata-v3-historical-cost-evidence-v1', passed: true,
    archiveSha256: verified.manifest.sha256Checksum,
    snapshotSidecarSha256: snapshotSidecar ? checksumValue(snapshotSidecar) : null,
    sourcePlanSha256: checksumValue(plan), dayCount: daily.length,
    householdAmountPaise: total.householdAmountPaise,
    studentTotalsPaise: total.studentAmountsPaise,
    historicalStudentIds: plan.studentIds,
    financialStartDateDecision: financialStartDate, // Metadata only; never changes historical costs.
    correctionCount: sourceCorrections.length,
    daily, months,
    evidenceSha256: checksumValue({ daily, months, total, sourcePlan: plan.sourceChecksum }) };
}
