import fs from 'node:fs/promises';
import { verifyAndDecryptBackup } from '../backup/backupEngine.js';
import { checksumValue, stableStringify, verifyRestoredInventory } from './sourceInventory.service.js';
import { compareSourceEvidenceToArchive } from './v3SourceEvidence.service.js';

const ID_FIELDS = ['clusterId', 'databaseName', 'replicaSet'];
const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_]*$/;
const SAFE_COLLECTION = /^[A-Za-z][A-Za-z0-9_]*$/;
const SAFE_RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function assertIdentity(expected, observed, label) {
  if (!expected || !observed || ID_FIELDS.some(field => expected[field] !== observed[field])
    || Object.keys(expected).length !== 3 || Object.keys(observed).length !== 3) {
    throw new Error(`${label} identity observation differs from approved allowlist`);
  }
}

/** Read-only proof for a disposable recovery copy; a future adapter supplies independently observed identities. */
export async function verifyRecoveryEvidence({ archive, manifest, encryptionKey, inventory,
  comparison, sourceInventoryAfter, recoveryConnection, expectedSourceIdentity,
  expectedRecoveryIdentity, observeRecoveryControlPlane, observeRecoveryConnection,
  v2ReadProbe, v3OnlyRecords = [] }) {
  if (!recoveryConnection?.db || typeof observeRecoveryControlPlane !== 'function'
    || typeof observeRecoveryConnection !== 'function'
    || observeRecoveryControlPlane === observeRecoveryConnection
    || typeof v2ReadProbe !== 'function' || !Array.isArray(v3OnlyRecords)) {
    throw new Error('Independent recovery identity and v2 read-only access probes are required');
  }
  assertIdentity(expectedSourceIdentity, inventory?.sourceIdentity, 'Source');
  assertIdentity(expectedRecoveryIdentity, await observeRecoveryControlPlane(), 'Recovery control-plane');
  assertIdentity(expectedRecoveryIdentity, await observeRecoveryConnection(), 'Recovery handshake');
  if (expectedSourceIdentity.clusterId === expectedRecoveryIdentity.clusterId
    && expectedSourceIdentity.databaseName === expectedRecoveryIdentity.databaseName) {
    throw new Error('Recovery database must differ from source');
  }
  if (recoveryConnection.db.databaseName !== expectedRecoveryIdentity.databaseName
    || sourceInventoryAfter?.fingerprint !== inventory.fingerprint
    || comparison?.sourceInventoryFingerprint !== inventory.fingerprint) {
    throw new Error('Source changed or recovery database identity differs');
  }
  const verified = verifyAndDecryptBackup({ backupPackageString: archive, encryptionKey });
  if (checksumValue(verified.manifest) !== checksumValue(manifest)
    || comparison.archiveSha256 !== manifest.sha256Checksum) {
    throw new Error('Recovery archive and source evidence are not bound to one manifest');
  }
  compareSourceEvidenceToArchive({ evidence: sourceInventoryAfter, archive,
    sourceManifest: manifest, encryptionKey });
  const restored = await verifyRestoredInventory({ sourceManifest: manifest,
    targetDbConnection: recoveryConnection, serializeDocument: value => {
      // The inventory helper compares BSON using its canonical Extended JSON representation.
      return value;
    } });
  if (!restored.passed) throw new Error('Recovery collection or index checksum differs from source archive');
  let access;
  try { access = await v2ReadProbe(); }
  catch { throw new Error('Legacy v2 recovery read probe failed'); }
  if (!access?.passed) throw new Error('Legacy v2 recovery read probe failed');
  for (const item of v3OnlyRecords) {
    if (!item || !SAFE_COLLECTION.test(item.collection ?? '')
      || !SAFE_FIELD.test(item.field ?? '') || typeof item.value !== 'string') {
      throw new Error('Invalid protected v3-only reconciliation record');
    }
    if (await recoveryConnection.db.collection(item.collection)
      .findOne({ [item.field]: item.value })) {
      throw new Error('A v3-only financial record appeared in the v2 recovery copy');
    }
  }
  return { passed: true, sourceUnchanged: true, archiveSha256: manifest.sha256Checksum,
    sourceInventoryFingerprint: inventory.fingerprint,
    recoveryIdentitySha256: checksumValue(expectedRecoveryIdentity),
    collectionCount: manifest.collectionOrder.length,
    recoveryInventorySha256: checksumValue(restored.targetInventory.collections),
    v2AccessVerified: true, v3OnlyRecordsExcluded: v3OnlyRecords.length };
}

function genuineSourceVerified(options) {
  const { provenance, genuineAttestation, verifyGenuineAttestation,
    sourceInventory, archiveComparison } = options;
  if (provenance !== 'genuine-authorized' || typeof verifyGenuineAttestation !== 'function'
    || !genuineAttestation?.authorizationRef
    || sourceInventory?.credentialScope?.verifiedReadOnly !== true
    || genuineAttestation.sourceInventoryFingerprint !== sourceInventory?.fingerprint
    || genuineAttestation.archiveSha256 !== archiveComparison?.archiveSha256) return false;
  return verifyGenuineAttestation(genuineAttestation) === true;
}

/** Never elevates synthetic fixture evidence to genuine source verification. */
export function buildReleaseEvidencePackage(options) {
  const { releaseId, planVersion, sourceInventory, archiveComparison, historicalCosts,
    snapshotSidecarSha256, recoveryEvidence = null, approvals = [],
    identityAttestationRefs = [], journalRefs = [],
    stageAPlanDigest = null, stageBPlanDigest = null,
    missingEligibility = [], blockers = [],
    executorReviewed = false } = options;
  if (!SAFE_RELEASE.test(releaseId ?? '') || !SAFE_RELEASE.test(planVersion ?? '')
    || !sourceInventory?.fingerprint
    || !archiveComparison?.passed || !historicalCosts?.passed
    || snapshotSidecarSha256 !== historicalCosts.snapshotSidecarSha256
    || !Array.isArray(approvals) || !Array.isArray(identityAttestationRefs)
    || !Array.isArray(journalRefs)
    || !Array.isArray(missingEligibility)
    || !Array.isArray(blockers)) {
    throw new Error('Release evidence inputs are incomplete or inconsistent');
  }
  const sourceVerified = genuineSourceVerified(options);
  const sourceStatus = sourceVerified ? 'SOURCE_EVIDENCE_VERIFIED' : 'SOURCE_EVIDENCE_PENDING';
  const pending = [...blockers, ...(sourceInventory.findings ?? [])];
  if (!sourceVerified) pending.push('Authorized genuine source evidence is pending');
  if (!recoveryEvidence?.passed) pending.push('Approved recovery evidence is pending');
  if (missingEligibility.length) pending.push('Required student eligibility decisions are pending');
  if (!executorReviewed) pending.push('Production executor review is pending');
  const readiness = sourceVerified && pending.length === 0
    ? 'READY_FOR_CUTOVER_REVIEW' : 'NOT_READY — BLOCKERS REMAIN';
  const content = { format: 'mealkhata-v3-release-evidence-v1', releaseId, planVersion,
    stageAPlanDigest, stageBPlanDigest, journalRefs,
    implementationStatus: 'IMPLEMENTATION_VERIFIED', sourceStatus, readiness,
    sourceIdentityAttestationSha256: checksumValue(sourceInventory.sourceIdentity),
    identityAttestationRefs, credentialScope: sourceInventory.credentialScope,
    sourceInventoryFingerprint: sourceInventory.fingerprint,
    archiveSha256: archiveComparison.archiveSha256,
    snapshotSidecarSha256, collectionCounts: Object.fromEntries(sourceInventory.collectionOrder
      .map(name => [name, sourceInventory.collections[name].count])),
    indexChecksums: Object.fromEntries(sourceInventory.collectionOrder
      .map(name => [name, sourceInventory.collections[name].indexesChecksum])),
    sourceConsistency: sourceInventory.consistency,
    sourceFindings: sourceInventory.findings,
    historicalCosts, recoveryEvidence, approvals,
    missingEligibility, blockers: pending };
  const privatePackage = { ...content, evidenceSha256: checksumValue(content) };
  const publicSummary = { releaseId, planVersion,
    implementationStatus: content.implementationStatus, sourceStatus, readiness,
    collectionCount: sourceInventory.collectionOrder.length,
    mealDayCount: historicalCosts.dayCount, blockerCount: pending.length,
    evidenceSha256: privatePackage.evidenceSha256 };
  return { private: privatePackage, public: publicSummary };
}

export function verifyReleaseEvidencePackage(privatePackage) {
  if (!privatePackage || privatePackage.format !== 'mealkhata-v3-release-evidence-v1') {
    throw new Error('Release evidence format is invalid');
  }
  const { evidenceSha256, ...content } = privatePackage;
  if (checksumValue(content) !== evidenceSha256) {
    throw new Error('Release evidence checksum mismatch or tampering detected');
  }
  return true;
}

/** Writes both detailed artifacts privately; returns only an aggregate, safe summary. */
export async function writeProtectedReleaseEvidence({ evidence, jsonPath, markdownPath }) {
  verifyReleaseEvidencePackage(evidence?.private);
  if (!jsonPath || !markdownPath || jsonPath === markdownPath) {
    throw new Error('Two distinct protected evidence artifact paths are required');
  }
  const body = evidence.private;
  const lines = [
    `# V3 release evidence: ${body.releaseId}`,
    '',
    `Plan version: ${body.planVersion}`,
    `Source evidence: ${body.sourceStatus}`,
    `Review readiness: ${body.readiness}`,
    `Archive SHA-256: ${body.archiveSha256}`,
    `Snapshot sidecar SHA-256: ${body.snapshotSidecarSha256 ?? 'none'}`,
    `Historical meal dates: ${body.historicalCosts.dayCount}`,
    `Historical household paise: ${body.historicalCosts.householdAmountPaise}`,
    '',
    '## Protected student totals (paise)',
    ...Object.entries(body.historicalCosts.studentTotalsPaise)
      .map(([id, amount]) => `- ${id}: ${amount}`),
    '',
    '## Stop conditions',
    ...body.blockers.map(item => `- ${item}`),
  ];
  await fs.writeFile(jsonPath, `${stableStringify(body)}\n`, { flag: 'wx', mode: 0o600 });
  await fs.writeFile(markdownPath, `${lines.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
  return { ...evidence.public, status: evidence.public.sourceStatus, reportWritten: true };
}
