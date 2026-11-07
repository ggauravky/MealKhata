/** An interrupted reservation is never inferred safe from a missing checkpoint. */
export function decideReleaseFailure({ reserved, sideEffectsPossible, checkpointVerified }) {
  if (reserved || sideEffectsPossible || !checkpointVerified) {
    return Object.freeze({ decision: 'STOP_MANUAL_REVIEW', retryAllowed: false,
      writesAllowed: false });
  }
  return Object.freeze({ decision: 'NO_SIDE_EFFECTS_CONFIRMED', retryAllowed: false,
    writesAllowed: false });
}
