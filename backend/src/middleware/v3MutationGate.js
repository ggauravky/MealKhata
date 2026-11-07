import { env } from '../config/env.js';
import { isDraining } from '../config/lifecycle.js';
import { checkV3ReleaseReadiness } from '../config/v3ReleaseReadiness.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createV3MutationGate({ config = env, readiness = checkV3ReleaseReadiness,
  drainingCheck = isDraining } = {}) {
  return async (req, res, next) => {
    if (config.runtimeProfile !== 'v3' || !MUTATING.has(req.method)) return next();
    try {
      if (!drainingCheck() && await readiness({ requiredLaunchStage: 'serving' }) === true
        && !drainingCheck()) return next();
    } catch { /* A failed release observation must block writes. */ }
    return res.status(503).json({ success: false, message: 'Release write gate is closed.' });
  };
}

export const v3MutationGate = createV3MutationGate();
