import { env } from '../config/env.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function enforceTrustedOrigin(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) {
    return next();
  }

  const origin = req.get('origin');
  const isAllowedOrigin =
    origin === env.appOrigin ||
    (env.nodeEnv === 'development' &&
      (origin === 'http://localhost:5173' || origin === 'http://localhost:5174'));

  if (!isAllowedOrigin) {
    return res.status(403).json({
      success: false,
      message: 'Request origin is not allowed.',
    });
  }

  return next();
}
