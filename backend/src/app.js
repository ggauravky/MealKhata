import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDevelopment, isProduction } from './config/env.js';
import { authenticateSession } from './middleware/authenticate.js';
import { enforceTrustedOrigin } from './middleware/csrfProtection.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiNotFound, notFound } from './middleware/notFound.js';
import { authRouter } from './routes/auth.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { mealRouter } from './routes/meal.routes.js';
import { billingRouter } from './routes/billing.routes.js';
import { calendarRouter } from './routes/calendar.routes.js';
import { reportRouter } from './routes/report.routes.js';
import { paymentRouter } from './routes/payment.routes.js';
import { paymentSettingsRouter } from './routes/paymentSettings.routes.js';
import { reminderSettingsRouter } from './routes/reminderSettings.routes.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = path.resolve(currentDirectory, '../../frontend/dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');
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
  meals = mealRouter,
  billing = billingRouter,
  calendar = calendarRouter,
  reports = reportRouter,
  payments = paymentRouter,
  paymentSettings = paymentSettingsRouter,
  reminderSettings = reminderSettingsRouter,
  health = healthRouter,
} = {}) {
  const app = express();

  app.disable('x-powered-by');

  if (isProduction) {
    app.set('trust proxy', PRODUCTION_TRUST_PROXY_HOPS);
  }

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
  app.use('/api/auth', authRouter);
  app.use('/api/meals', meals);
  app.use('/api/billing', billing);
  app.use('/api/calendar', calendar);
  app.use('/api/reports', reports);
  app.use('/api/payments', payments);
  app.use('/api/payment-settings', paymentSettings);
  app.use('/api/settings/reminders', reminderSettings);
  app.use('/api', apiNotFound);

  if (isProduction) {
    app.use('/assets', express.static(path.join(frontendDistPath, 'assets'), {
      immutable: true,
      index: false,
      maxAge: '1y',
    }));
    app.use(express.static(frontendDistPath, { index: false, maxAge: 0 }));

    app.use((req, res, next) => {
      const shouldServeApp =
        req.method === 'GET' &&
        req.accepts('html') &&
        !req.path.startsWith('/api') &&
        !req.path.startsWith('/socket.io');

      if (!shouldServeApp) {
        return next();
      }

      res.set('Cache-Control', 'no-store');
      return res.sendFile(frontendIndexPath);
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
