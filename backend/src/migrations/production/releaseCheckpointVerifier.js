const SHA = /^[a-f0-9]{64}$/;

/** Reads protected evidence independently of the action handler before accepting a checkpoint. */
export function createReleaseCheckpointVerifier({ readProtectedEvidence, verifyResourceState }) {
  if (typeof readProtectedEvidence !== 'function' || typeof verifyResourceState !== 'function'
    || readProtectedEvidence === verifyResourceState) {
    throw new Error('Independent checkpoint evidence and resource observers are required');
  }
  return async ({ action, context, checkpoint }) => {
    let evidence;
    try {
      evidence = await readProtectedEvidence({ action, releaseId: context?.releaseId,
        checkpointId: checkpoint?.checkpointId });
      if (evidence?.action !== action || evidence.releaseId !== context?.releaseId
        || evidence.checkpointId !== checkpoint?.checkpointId
        || evidence.evidenceDigest !== checkpoint?.evidenceDigest
        || !SHA.test(evidence.resourceFingerprint ?? '')) return false;
      return await verifyResourceState({ action, context, evidence }) === true;
    } catch {
      return false;
    }
  };
}
