import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { isDevelopment, isProduction } from './config/env.js';
import { authenticateSession } from './middleware/authenticate.js';
import { enforceTrustedOrigin } from './middleware/csrfProtection.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiNotFound, notFound } from './middleware/notFound.js';
import { sensitiveMutationLimiter } from './middleware/rateLimiters.js';
import { requestCorrelation } from './middleware/requestCorrelation.js';
import { authRouter } from './routes/auth.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { mealRouter } from './routes/meal.routes.js';
import { billingRouter } from './routes/billing.routes.js';
import { calendarRouter } from './routes/calendar.routes.js';
import { reportRouter } from './routes/report.routes.js';
import { paymentRouter } from './routes/payment.routes.js';
import { paymentSettingsRouter } from './routes/paymentSettings.routes.js';
import { reminderSettingsRouter } from './routes/reminderSettings.routes.js';
import { pushRouter } from './routes/push.routes.js';
import { settlementRouter } from './routes/settlement.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';

export const PRODUCTION_TRUST_PROXY_HOPS = 1;
export const API_RATE_LIMIT = Object.freeze({
  windowMs: 15 * 60 * 1_000,
  developmentLimit: 1_000,
  productionLimit: 300,
});

export function createHelmetOptions({ production = isProduction } = {}) {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", ...(!production ? ['ws:', 'http:'] : [])],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: production
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
  };
}

export function createApp({
  auth = authRouter,
  meals = mealRouter,
  billing = billingRouter,
  calendar = calendarRouter,
  reports = reportRouter,
  payments = paymentRouter,
  paymentSettings = paymentSettingsRouter,
  reminderSettings = reminderSettingsRouter,
  push = pushRouter,
  settlements = settlementRouter,
  dashboard = dashboardRouter,
  health = healthRouter,
} = {}) {
  const app = express();

  app.disable('x-powered-by');

  if (isProduction) {
    app.set('trust proxy', PRODUCTION_TRUST_PROXY_HOPS);
  }

  app.use(requestCorrelation);
  app.use(helmet(createHelmetOptions()));
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
    next();
  });
  app.use(compression());
  app.use(express.json({ limit: '150kb' }));
  app.use(express.urlencoded({ extended: false, limit: '150kb' }));
  app.use(cookieParser());

  if (isDevelopment) {
    app.use(morgan('dev'));
  }

  const apiLimiter = rateLimit({
    windowMs: API_RATE_LIMIT.windowMs,
    limit: isProduction ? API_RATE_LIMIT.productionLimit : API_RATE_LIMIT.developmentLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many requests. Please try again shortly.',
    },
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', apiLimiter);
  app.use('/api', authenticateSession);
  app.use('/api', enforceTrustedOrigin);
  app.use('/api', health);
  app.use('/api/auth', auth);
  app.use('/api/meals', meals);
  app.use('/api/billing', billing);
  app.use('/api/calendar', calendar);
  app.use('/api/reports', reports);
  app.use('/api/dashboard', dashboard);

  // Apply sensitive mutation limiter to financial, settlement, settings, and push mutation endpoints
  app.use('/api/payments', sensitiveMutationLimiter, payments);
  app.use('/api/settlements', sensitiveMutationLimiter, settlements);
  app.use('/api/payment-settings', sensitiveMutationLimiter, paymentSettings);
  app.use('/api/settings/reminders', sensitiveMutationLimiter, reminderSettings);
  app.use('/api/push', sensitiveMutationLimiter, push);

  app.use('/api', apiNotFound);

  app.get('/', (req, res) => {
    res.json({ service: 'MealKhata API', status: 'running' });
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
