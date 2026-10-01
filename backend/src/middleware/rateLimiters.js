import rateLimit from 'express-rate-limit';
import { isProduction } from '../config/env.js';

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

export const SENSITIVE_MUTATION_LIMIT = Object.freeze({
  windowMs: 15 * 60 * 1_000,
  developmentLimit: 1_000,
  productionLimit: 60,
});

export const sensitiveMutationLimiter = rateLimit({
  windowMs: SENSITIVE_MUTATION_LIMIT.windowMs,
  limit: isProduction
    ? SENSITIVE_MUTATION_LIMIT.productionLimit
    : SENSITIVE_MUTATION_LIMIT.developmentLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many mutation attempts. Please wait a moment before trying again.',
  },
});
