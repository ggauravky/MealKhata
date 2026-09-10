import rateLimit from 'express-rate-limit';

export const LOGIN_RATE_LIMIT = Object.freeze({
  windowMs: 15 * 60 * 1_000,
  limit: 10,
});

export const loginLimiter = rateLimit({
  ...LOGIN_RATE_LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again later.',
  },
});
