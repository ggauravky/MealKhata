import { Router } from 'express';
import { authenticateCredentials, validateLoginInput } from '../auth/auth.service.js';
import {
  createAuthenticatedSession,
  createViewerSession,
} from '../auth/permissions.js';
import {
  createSessionToken,
  getClearSessionCookieOptions,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '../auth/token.service.js';
import { loginLimiter } from '../middleware/rateLimiters.js';
import { logger } from '../utils/logger.js';

export function createAuthRouter({ service = { authenticateCredentials } } = {}) {
  const router = Router();

  router.post('/login', loginLimiter, async (req, res) => {
    const credentials = validateLoginInput(req.body);

    try {
      const auth = await service.authenticateCredentials(credentials);
      const token = await createSessionToken(auth.role, { memberId: auth.memberId });

      res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
      logger.info('Authentication succeeded', { role: auth.role, memberId: auth.memberId });

      return res.json({
        success: true,
        session: createAuthenticatedSession(auth.role, { memberId: auth.memberId }),
      });
    } catch (error) {
      if (error.statusCode === 401) {
        logger.warn('Authentication failed');
      }

      throw error;
    }
  });

  router.get('/session', (req, res) => {
    const session = req.auth?.authenticated
      ? createAuthenticatedSession(req.auth.role, { memberId: req.auth.memberId })
      : createViewerSession();

    res.json({
      success: true,
      session,
    });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, getClearSessionCookieOptions());

    if (req.auth?.authenticated) {
      logger.info('Session ended', { role: req.auth.role, memberId: req.auth.memberId });
    }

    res.json({ success: true });
  });

  return router;
}

export const authRouter = createAuthRouter();
