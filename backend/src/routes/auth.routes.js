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

export const authRouter = Router();

authRouter.post('/login', loginLimiter, async (req, res) => {
  const credentials = validateLoginInput(req.body);

  try {
    const auth = await authenticateCredentials(credentials);
    const token = await createSessionToken(auth.role);

    res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    logger.info('Authentication succeeded', { role: auth.role });

    return res.json({
      success: true,
      session: createAuthenticatedSession(auth.role),
    });
  } catch (error) {
    if (error.statusCode === 401) {
      logger.warn('Authentication failed');
    }

    throw error;
  }
});

authRouter.get('/session', (req, res) => {
  const session = req.auth?.authenticated
    ? createAuthenticatedSession(req.auth.role)
    : createViewerSession();

  res.json({
    success: true,
    session,
  });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, getClearSessionCookieOptions());

  if (req.auth?.authenticated) {
    logger.info('Session ended', { role: req.auth.role });
  }

  res.json({ success: true });
});
