import 'dotenv/config';
import bcrypt from 'bcryptjs';

const parsedPort = Number.parseInt(process.env.PORT ?? '5000', 10);

export function normalizeAppOrigin(value) {
  const trimmed = value?.trim() ?? '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number.isNaN(parsedPort) ? 5000 : parsedPort,
  mongoUri: process.env.MONGODB_URI?.trim() ?? '',
  appTimezone: process.env.APP_TIMEZONE?.trim() || 'Asia/Kolkata',
  adminEmail: process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? '',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH?.trim() ?? '',
  superAdminEmail: process.env.SUPERADMIN_EMAIL?.trim().toLowerCase() ?? '',
  superAdminPasswordHash: process.env.SUPERADMIN_PASSWORD_HASH?.trim() ?? '',
  authJwtSecret: process.env.AUTH_JWT_SECRET?.trim() ?? '',
  appOrigin: normalizeAppOrigin(process.env.APP_ORIGIN),
});

const bcryptHashPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mongoUriPattern = /^mongodb(?:\+srv)?:\/\//;

function isValidOrigin(value, requireHttps) {
  try {
    const url = new URL(value);
    const allowedProtocol = requireHttps ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol);

    return allowedProtocol && url.origin === value;
  } catch {
    return false;
  }
}

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function hasRequiredBcryptCost(value) {
  if (!bcryptHashPattern.test(value)) {
    return false;
  }

  try {
    return bcrypt.getRounds(value) === 12;
  } catch {
    return false;
  }
}

export function validateEnvironment(config = env) {
  const missing = [];

  const requiredValues = {
    MONGODB_URI: config.mongoUri,
    ADMIN_EMAIL: config.adminEmail,
    ADMIN_PASSWORD_HASH: config.adminPasswordHash,
    SUPERADMIN_EMAIL: config.superAdminEmail,
    SUPERADMIN_PASSWORD_HASH: config.superAdminPasswordHash,
    AUTH_JWT_SECRET: config.authJwtSecret,
    APP_ORIGIN: config.appOrigin,
  };

  for (const [name, value] of Object.entries(requiredValues)) {
    if (!value) {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (!['development', 'test', 'production'].includes(config.nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }

  if (!emailPattern.test(config.adminEmail) || !emailPattern.test(config.superAdminEmail)) {
    throw new Error('ADMIN_EMAIL and SUPERADMIN_EMAIL must be valid email addresses');
  }

  if (config.adminEmail === config.superAdminEmail) {
    throw new Error('ADMIN_EMAIL and SUPERADMIN_EMAIL must be different');
  }

  if (!hasRequiredBcryptCost(config.adminPasswordHash)) {
    throw new Error('ADMIN_PASSWORD_HASH must be a valid bcrypt hash with cost 12');
  }

  if (!hasRequiredBcryptCost(config.superAdminPasswordHash)) {
    throw new Error('SUPERADMIN_PASSWORD_HASH must be a valid bcrypt hash with cost 12');
  }

  const minimumSecretBytes = config.nodeEnv === 'production' ? 48 : 32;
  if (Buffer.byteLength(config.authJwtSecret, 'utf8') < minimumSecretBytes) {
    throw new Error(`AUTH_JWT_SECRET must contain at least ${minimumSecretBytes} bytes`);
  }

  if (!isValidOrigin(config.appOrigin, config.nodeEnv === 'production')) {
    throw new Error('APP_ORIGIN must use HTTPS in production and be an exact origin with no path, query, or fragment');
  }

  if (!isValidTimeZone(config.appTimezone)) {
    throw new Error('APP_TIMEZONE must be a valid IANA timezone');
  }


  if (config.appTimezone !== 'Asia/Kolkata') {
    throw new Error('APP_TIMEZONE must remain Asia/Kolkata');
  }

  if (!mongoUriPattern.test(config.mongoUri)) {
    throw new Error('MONGODB_URI must use the mongodb or mongodb+srv scheme');
  }
}

export const isProduction = env.nodeEnv === 'production';
export const isDevelopment = env.nodeEnv === 'development';
export const isTest = env.nodeEnv === 'test';
