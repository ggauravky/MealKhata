export const LIFECYCLE_STATES = Object.freeze({
  STARTING: 'starting',
  READY: 'ready',
  DRAINING: 'draining',
  STOPPED: 'stopped',
});

let currentState = LIFECYCLE_STATES.STARTING;

export function getLifecycleState() {
  return currentState;
}

export function setLifecycleState(state) {
  if (!Object.values(LIFECYCLE_STATES).includes(state)) {
    throw new Error(`Invalid lifecycle state: ${state}`);
  }
  currentState = state;
}

export function isDraining() {
  return currentState === LIFECYCLE_STATES.DRAINING || currentState === LIFECYCLE_STATES.STOPPED;
}

export function isReady() {
  return currentState === LIFECYCLE_STATES.READY;
}

export function resetLifecycleStateForTesting() {
  currentState = LIFECYCLE_STATES.STARTING;
}
