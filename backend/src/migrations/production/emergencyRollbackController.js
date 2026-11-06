import { checksumValue } from '../sourceInventory.service.js';
import { verifyProductionActionApproval } from '../v3ProductionGate.service.js';

const ACTION = 'emergency-rollback-connection';
const SHA = /^[a-f0-9]{64}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const IDENTITY_FIELDS = ['projectId', 'clusterId', 'databaseName', 'replicaSet',
  'endpointIdentity', 'principal', 'expectedPrivileges'];
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

/** Dormant, injected emergency path. It never opens a connection or enables writes. */
export function createEmergencyRollbackController({ mode, journal, identityObserver, trustedSigners,
  verifyCurrentSignerAuthority, verifyTargetOutage, verifySourceUnchanged,
  verifyPreviousRelease, verifyWritesStopped, restorePreviousConnection,
  verifyCheckpoint, now = () => new Date(), log = () => {} }) {
  if (mode !== 'isolated-rehearsal' || process.env.NODE_ENV !== 'test') {
    throw new Error('Emergency rollback controller is limited to isolated rehearsal; production activation is unavailable');
  }
  const verifiers = [verifyCurrentSignerAuthority, verifyTargetOutage,
    verifySourceUnchanged, verifyPreviousRelease, verifyWritesStopped, verifyCheckpoint];
  if (!journal?.readRelease || !journal?.reserve || !journal?.complete || !journal?.assertReady
    || typeof journal.observeConnectionIdentity !== 'function'
    || typeof identityObserver?.observeRole !== 'function'
    || journal.databaseName !== identityObserver.controlDatabaseName
    || verifiers.some(value => typeof value !== 'function')
    || new Set(verifiers).size !== verifiers.length
    || typeof restorePreviousConnection !== 'function' || typeof log !== 'function') {
    throw new Error('Independent emergency observers, control journal and scoped handler are required');
  }
  const safeLog = event => { try { log(event); } catch { /* The journal remains authoritative. */ } };
  return Object.freeze({
    async execute(releaseId, approval, outageEvidence) {
      if (!SAFE.test(releaseId ?? '') || !exact(outageEvidence,
        ['evidenceRef', 'lastKnownTargetFingerprint', 'evidenceDigest',
          'targetState', 'observedAt'])
        || !SAFE.test(outageEvidence.evidenceRef)
        || !SHA.test(outageEvidence.lastKnownTargetFingerprint)
        || !SHA.test(outageEvidence.evidenceDigest)
        || outageEvidence.targetState !== 'unreachable') {
        throw new Error('Protected target outage evidence reference is invalid');
      }
      let source;
      let control;
      let actualJournal;
      try {
        source = await identityObserver.observeRole('source');
        control = await identityObserver.observeRole('control');
        actualJournal = await journal.observeConnectionIdentity();
      } catch { throw new Error('Emergency source or control identity observation failed'); }
      if (!exact(actualJournal, IDENTITY_FIELDS)
        || checksumValue(actualJournal) !== checksumValue(Object.fromEntries(
          IDENTITY_FIELDS.map(field => [field, control[field]])))) {
        throw new Error('Emergency control journal identity differs from allowlist');
      }
      let release;
      try {
        await journal.assertReady();
        release = await journal.readRelease(releaseId);
      } catch { throw new Error('Emergency control journal is unavailable'); }
      if (!release || release.phase !== 'B' || release.releaseId !== releaseId
        || checksumValue(release.plan) !== release.stageAPlanDigest
        || checksumValue({ stageAPlanDigest: release.stageAPlanDigest,
          amendment: release.amendment }) !== release.stageBPlanDigest
        || release.actions?.['switch-connection']?.status !== 'complete'
        || !SHA.test(release.actions?.['archive-frozen-source']?.evidenceDigest ?? '')
        || release.actions?.['rollback-connection']
        || release.actions?.[ACTION]
        || checksumValue(release.plan.source) !== checksumValue({
          clusterId: source.clusterId, databaseName: source.databaseName,
          replicaSet: source.replicaSet })) {
        throw new Error('Emergency rollback release lineage or source identity is invalid');
      }
      const at = now();
      const outageAt = new Date(outageEvidence.observedAt);
      if (typeof outageEvidence.observedAt !== 'string'
        || !Number.isFinite(outageAt.getTime()) || outageAt > at
        || at.getTime() - outageAt.getTime() > 5 * 60_000) {
        throw new Error('Target outage evidence is stale or invalid');
      }
      verifyProductionActionApproval({ approval, planDigest: release.stageBPlanDigest,
        action: ACTION, trustedSigners, now: at });
      if (new Date(approval.expiresAt).getTime() - at.getTime() > 5 * 60_000) {
        throw new Error('Emergency approval exceeds five minutes');
      }
      let currentSigners = false;
      try { currentSigners = await verifyCurrentSignerAuthority({ action: ACTION,
        signers: approval.signatures.map(({ role, signerId }) => ({ role, signerId })) }); }
      catch { /* Never expose signer-directory details. */ }
      if (currentSigners !== true) throw new Error('Current emergency signer authority is unverified');
      let verifiedOutage;
      let unchanged;
      let previous;
      let stopped;
      try {
        verifiedOutage = await verifyTargetOutage({ releaseId,
          evidenceRef: outageEvidence.evidenceRef,
          switchCheckpoint: release.actions['switch-connection'] });
        unchanged = await verifySourceUnchanged({ releaseId,
          frozenArchiveSha256: release.actions['archive-frozen-source']?.evidenceDigest,
          sourceIdentity: source });
        previous = await verifyPreviousRelease({ releaseId, sourceIdentity: source });
        stopped = await verifyWritesStopped({ releaseId });
      } catch { throw new Error('Protected emergency rollback evidence is unavailable'); }
      if (verifiedOutage?.passed !== true
        || verifiedOutage.evidenceRef !== outageEvidence.evidenceRef
        || verifiedOutage.lastKnownTargetFingerprint !== outageEvidence.lastKnownTargetFingerprint
        || verifiedOutage.evidenceDigest !== outageEvidence.evidenceDigest
        || verifiedOutage.targetState !== 'unreachable'
        || verifiedOutage.observedAt !== outageEvidence.observedAt
        || verifiedOutage.switchCheckpointDigest !== release.actions['switch-connection'].evidenceDigest
        || unchanged?.passed !== true
        || unchanged.frozenArchiveSha256 !== release.actions['archive-frozen-source']?.evidenceDigest
        || previous?.passed !== true || !SAFE.test(previous.releaseId ?? '')
        || !SHA.test(previous.configSha256 ?? '')
        || previous.sourceIdentitySha256 !== checksumValue(Object.fromEntries(
          IDENTITY_FIELDS.map(field => [field, source[field]])))
        || stopped?.passed !== true || !SHA.test(stopped.evidenceDigest ?? '')) {
        throw new Error('Emergency rollback evidence or stopped-writer proof is invalid');
      }
      try {
        await journal.reserve(releaseId, 'B', release.stageBPlanDigest, ACTION,
          structuredClone(approval), 'switch-connection', at, {
            outageEvidenceRef: outageEvidence.evidenceRef,
            outageEvidenceDigest: verifiedOutage.evidenceDigest,
            lastKnownTargetFingerprint: verifiedOutage.lastKnownTargetFingerprint,
            outageObservedAt: outageEvidence.observedAt,
            sourceIdentitySha256: previous.sourceIdentitySha256,
            controlIdentitySha256: checksumValue(Object.fromEntries(
              IDENTITY_FIELDS.map(field => [field, control[field]]))),
            previousConfigSha256: previous.configSha256,
            writesStoppedDigest: stopped.evidenceDigest,
          });
      } catch { throw new Error('Emergency rollback reservation is used or ambiguous; stop'); }
      try {
        safeLog({ event: 'v3.release.emergency_reserved', releaseId,
          action: ACTION, planDigest: release.stageBPlanDigest });
        const checkpoint = await restorePreviousConnection(Object.freeze({ action: ACTION,
          releaseId, previousReleaseId: previous.releaseId,
          previousConfigSha256: previous.configSha256,
          sourceIdentitySha256: previous.sourceIdentitySha256,
          outageEvidenceDigest: verifiedOutage.evidenceDigest,
          writesStoppedDigest: stopped.evidenceDigest }));
        if (!exact(checkpoint, ['checkpointId', 'evidenceDigest'])
          || !SAFE.test(checkpoint.checkpointId ?? '')
          || !SHA.test(checkpoint.evidenceDigest ?? '')
          || await verifyCheckpoint({ action: ACTION, releaseId, checkpoint }) !== true) {
          throw new Error('Emergency rollback checkpoint is invalid');
        }
        await journal.complete(releaseId, ACTION, checkpoint, now());
        safeLog({ event: 'v3.release.emergency_complete', releaseId, action: ACTION,
          checkpointId: checkpoint.checkpointId, evidenceDigest: checkpoint.evidenceDigest });
        return { status: 'complete', action: ACTION, releaseId,
          checkpointId: checkpoint.checkpointId, evidenceDigest: checkpoint.evidenceDigest,
          writesAllowed: false, reconciliationPending: true };
      } catch {
        await journal.fail(releaseId, ACTION, now()).catch(() => {});
        safeLog({ event: 'v3.release.emergency_failed', releaseId, action: ACTION });
        throw new Error('Emergency rollback failed; preserve evidence, stop and keep writes closed');
      }
    },
  });
}
