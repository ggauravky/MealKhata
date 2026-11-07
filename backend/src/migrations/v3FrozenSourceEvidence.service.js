import { verifyAndDecryptBackup } from '../backup/backupEngine.js';
import { checksumValue } from './sourceInventory.service.js';
import { buildHistoricalCostEvidence } from './v3HistoricalEvidence.service.js';
import { compareSourceEvidenceToArchive } from './v3SourceEvidence.service.js';

const DOMAIN = ['meal_days', 'meal_history_snapshots',
  'meal_history_corrections', 'monthly_meal_rates'];
const documentId = value => value?._id?.$oid ?? String(value?._id ?? '');

function archived(archive, manifest, encryptionKey) {
  const verified = verifyAndDecryptBackup({ backupPackageString: archive, encryptionKey });
  if (checksumValue(verified.manifest) !== checksumValue(manifest)) {
    throw new Error('Frozen source manifest does not match its authenticated archive');
  }
  return verified;
}

function compareCollections(base, frozen) {
  const names = [...new Set([...base.manifest.collectionOrder,
    ...frozen.manifest.collectionOrder])].sort();
  const changes = names.filter(name => {
    const first = base.manifest.collectionMetadata?.[name];
    const last = frozen.manifest.collectionMetadata?.[name];
    return first?.sha256Checksum !== last?.sha256Checksum
      || checksumValue(first?.indexes ?? []) !== checksumValue(last?.indexes ?? [])
      || first?.count !== last?.count;
  }).map(name => ({ collection: name,
    baseChecksum: base.manifest.collectionMetadata?.[name]?.sha256Checksum ?? checksumValue([]),
    finalChecksum: frozen.manifest.collectionMetadata?.[name]?.sha256Checksum ?? checksumValue([]),
    baseCount: base.manifest.collectionMetadata?.[name]?.count ?? 0,
    finalCount: frozen.manifest.collectionMetadata?.[name]?.count ?? 0,
    baseIndexesChecksum: checksumValue(base.manifest.collectionMetadata?.[name]?.indexes ?? []),
    finalIndexesChecksum: checksumValue(frozen.manifest.collectionMetadata?.[name]?.indexes ?? []),
  }));
  return { names, changes, nonMealChanges: changes.filter(change => !DOMAIN.includes(change.collection)) };
}

function verifyReview(review, nonMealChanges, baseSha, finalSha) {
  if (!nonMealChanges.length) return;
  if (!review || review.format !== 'mealkhata-v3-nonmeal-review-v1'
    || review.baseArchiveSha256 !== baseSha || review.finalArchiveSha256 !== finalSha
    || review.decision !== 'acknowledge-excluded-v2-only'
    || typeof review.reason !== 'string' || review.reason.trim().length < 10
    || !Array.isArray(review.changes)
    || checksumValue([...review.changes].sort((a, b) => a.collection.localeCompare(b.collection)))
      !== checksumValue(nonMealChanges)) {
    throw new Error('Non-meal source drift requires an exact archive-bound review');
  }
}

function changedMealDocuments(base, frozen) {
  const delta = {};
  for (const name of DOMAIN) {
    const before = new Map((base.rawData[name] ?? []).map(row => [documentId(row), row]));
    const after = new Map((frozen.rawData[name] ?? []).map(row => [documentId(row), row]));
    if ([...before.keys()].some(id => !after.has(id))) {
      throw new Error(`Frozen source removed historical meal authority from ${name}`);
    }
    delta[name] = [...after].filter(([id, row]) => checksumValue(row)
      !== checksumValue(before.get(id) ?? null)).map(([, row]) => row);
  }
  if (Object.values(delta).reduce((sum, rows) => sum + rows.length, 0) > 256
    || Buffer.byteLength(JSON.stringify(delta)) > 8 * 1024 * 1024) {
    throw new Error('Frozen meal delta exceeds the safe replay transaction');
  }
  return delta;
}

/** Offline artifact binding; the injected freeze verifier must independently prove stopped writers. */
export async function verifyFrozenAmendmentArtifacts({ baseEvidence, finalEvidence,
  baseArchive, baseManifest, finalArchive, finalManifest, finalSidecar, encryptionKey,
  nonMealChangeReview = null, freezeAt, verifyWriteFreeze }) {
  if (typeof verifyWriteFreeze !== 'function'
    || baseEvidence?.consistency?.level !== 'SNAPSHOT_WITH_STABLE_WRITE_EPOCH'
    || finalEvidence?.consistency?.level !== 'SNAPSHOT_WITH_STABLE_WRITE_EPOCH'
    || baseEvidence?.credentialScope?.verifiedReadOnly !== true
    || finalEvidence?.credentialScope?.verifiedReadOnly !== true || !finalSidecar) {
    throw new Error('Independent freeze proof and consistent source inventories are required');
  }
  const base = archived(baseArchive, baseManifest, encryptionKey);
  const frozen = archived(finalArchive, finalManifest, encryptionKey);
  const freezeTime = Date.parse(freezeAt);
  if (!Number.isFinite(freezeTime) || freezeTime < Date.parse(baseManifest.createdAt)
    || freezeTime > Date.parse(finalManifest.createdAt) || freezeTime > Date.now()) {
    throw new Error('Source freeze chronology differs from base and frozen archives');
  }
  compareSourceEvidenceToArchive({ evidence: baseEvidence, archive: baseArchive,
    sourceManifest: baseManifest, encryptionKey });
  compareSourceEvidenceToArchive({ evidence: finalEvidence, archive: finalArchive,
    sourceManifest: finalManifest, encryptionKey });
  if (checksumValue(baseEvidence.sourceIdentity) !== checksumValue(finalEvidence.sourceIdentity)) {
    throw new Error('Frozen source identity changed between archives');
  }
  let freeze;
  try { freeze = await verifyWriteFreeze({ sourceIdentity: finalEvidence.sourceIdentity,
    freezeAt, finalArchiveSha256: finalManifest.sha256Checksum }); }
  catch { throw new Error('Independent source write-freeze verification failed'); }
  if (!freeze?.passed || freeze.freezeAt !== freezeAt
    || checksumValue(freeze.sourceIdentity) !== checksumValue(finalEvidence.sourceIdentity)
    || freeze.finalArchiveSha256 !== finalManifest.sha256Checksum) {
    throw new Error('Independent source write-freeze evidence differs from frozen archive');
  }
  const comparison = compareCollections(base, frozen);
  verifyReview(nonMealChangeReview, comparison.nonMealChanges,
    baseManifest.sha256Checksum, finalManifest.sha256Checksum);
  const historical = buildHistoricalCostEvidence({ archive: finalArchive,
    sourceManifest: finalManifest, encryptionKey, snapshotSidecar: finalSidecar });
  const delta = changedMealDocuments(base, frozen);
  const inventoryComparisonSha256 = checksumValue({ base: baseManifest.sha256Checksum,
    final: finalManifest.sha256Checksum, changes: comparison.changes,
    nonMealReviewSha256: nonMealChangeReview ? checksumValue(nonMealChangeReview) : null });
  return { passed: true, baseArchiveSha256: baseManifest.sha256Checksum,
    finalArchiveSha256: finalManifest.sha256Checksum,
    frozenInventorySha256: finalEvidence.fingerprint,
    sidecarSha256: checksumValue(finalSidecar),
    inventoryComparisonSha256, finalMealDeltaSha256: checksumValue(delta),
    nonMealChanges: comparison.nonMealChanges.map(item => item.collection),
    historicalAuthoritySha256: historical.evidenceSha256,
    freezeAttestationSha256: checksumValue(freeze) };
}
