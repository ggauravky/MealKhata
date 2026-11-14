import { requiredIndexesEnsured } from '../config/initialization.js';
import { isDraining } from '../config/lifecycle.js';
import { initializationState } from '../config/readiness.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Login and logout cannot change application data; before setup no account exists to log in.
const ALWAYS_ALLOWED = new Set(['/auth/login', '/auth/logout']);

/** Blocks every write until the one-time Super Admin setup has completed. */
export function createInitializationGate({
  state = initializationState,
  drainingCheck = isDraining,
  indexesReady = requiredIndexesEnsured,
} = {}) {
  return async (req, res, next) => {
    if (!MUTATING.has(req.method) || ALWAYS_ALLOWED.has(req.path)) return next();
    if (drainingCheck() || !indexesReady()) {
      return res.status(503).json({ success: false, message: 'The server is starting. Please retry in a moment.' });
    }
    try {
      if (await state.isInitialized()) return next();
    } catch { /* A failed observation must block writes. */ }
    return res.status(503).json({
      success: false,
      code: 'SETUP_REQUIRED',
      message: 'MealKhata has not been set up yet. The owner must complete the one-time Super Admin setup.',
    });
  };
}

export const initializationGate = createInitializationGate();
