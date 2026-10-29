import { createViewerAuth } from '../auth/permissions.js';
import {
  getClearSessionCookieOptions,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from '../auth/token.service.js';
import { logger } from '../utils/logger.js';

export function createAuthenticateSession({ accounts, resolver } = {}) {
  return async function authenticateSession(req, res, next) {
    req.auth = createViewerAuth();

    const token = req.cookies?.[SESSION_COOKIE_NAME];

    if (!token) {
      return next();
    }

    try {
      req.auth = await verifySessionToken(token, { accounts, resolver });
    } catch {
      res.clearCookie(SESSION_COOKIE_NAME, getClearSessionCookieOptions());
      logger.info('Invalid or expired session rejected');
    }

    return next();
  };
}

export const authenticateSession = createAuthenticateSession();
