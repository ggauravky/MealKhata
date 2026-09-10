import { env } from '../config/env.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function enforceTrustedOrigin(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) {
    return next();
  }

  if (req.get('origin') !== env.appOrigin) {
    return res.status(403).json({
      success: false,
      message: 'Request origin is not allowed.',
    });
  }

  return next();
}
