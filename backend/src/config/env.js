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
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY?.trim() ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY?.trim() ?? '',
  vapidSubject: process.env.VAPID_SUBJECT?.trim() ?? '',
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

  const hasAdminEmail = Boolean(config.adminEmail);
  const hasSuperAdminEmail = Boolean(config.superAdminEmail);

  if (hasAdminEmail && !emailPattern.test(config.adminEmail)) {
    throw new Error('ADMIN_EMAIL and SUPERADMIN_EMAIL must be valid email addresses');
  }

  if (hasSuperAdminEmail && !emailPattern.test(config.superAdminEmail)) {
    throw new Error('ADMIN_EMAIL and SUPERADMIN_EMAIL must be valid email addresses');
  }

  if (hasAdminEmail && hasSuperAdminEmail && config.adminEmail === config.superAdminEmail) {
    throw new Error('ADMIN_EMAIL and SUPERADMIN_EMAIL must be different');
  }

  if (config.adminPasswordHash && !hasRequiredBcryptCost(config.adminPasswordHash)) {
    throw new Error('ADMIN_PASSWORD_HASH must be a valid bcrypt hash with cost 12');
  }

  if (config.superAdminPasswordHash && !hasRequiredBcryptCost(config.superAdminPasswordHash)) {
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

  validateVapidConfiguration(config, { required: false });
}

export function validateVapidConfiguration(config = env, { required = false } = {}) {
  const hasPublic = Boolean(config.vapidPublicKey);
  const hasPrivate = Boolean(config.vapidPrivateKey);
  const hasSubject = Boolean(config.vapidSubject);

  const hasAny = hasPublic || hasPrivate || hasSubject;
  const hasAll = hasPublic && hasPrivate && hasSubject;

  if (!hasAny) {
    if (required) {
      throw new Error('Background push is not configured. VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT are required.');
    }
    return false;
  }

  if (!hasAll) {
    const missing = [];
    if (!hasPublic) missing.push('VAPID_PUBLIC_KEY');
    if (!hasPrivate) missing.push('VAPID_PRIVATE_KEY');
    if (!hasSubject) missing.push('VAPID_SUBJECT');
    throw new Error(
      `Partial VAPID configuration detected. Missing: ${missing.join(', ')}. All three variables must be configured together or all omitted.`,
    );
  }

  if (
    Buffer.byteLength(config.vapidPublicKey, 'utf8') < 16 ||
    Buffer.byteLength(config.vapidPrivateKey, 'utf8') < 16
  ) {
    throw new Error('VAPID keys must be valid non-empty base64url encoded strings');
  }

  const subject = config.vapidSubject;
  if (!subject.startsWith('mailto:') && !subject.startsWith('https://')) {
    throw new Error('VAPID_SUBJECT must be a mailto: URL or HTTPS URL');
  }

  return true;
}

export function validatePushRunnerEnvironment(config = env) {
  if (!config.mongoUri) {
    throw new Error('Missing required environment variable: MONGODB_URI');
  }
  if (!mongoUriPattern.test(config.mongoUri)) {
    throw new Error('MONGODB_URI must use the mongodb or mongodb+srv scheme');
  }
  if (!isValidTimeZone(config.appTimezone) || config.appTimezone !== 'Asia/Kolkata') {
    throw new Error('APP_TIMEZONE must remain Asia/Kolkata');
  }
  validateVapidConfiguration(config, { required: true });
}

export const isProduction = env.nodeEnv === 'production';
export const isDevelopment = env.nodeEnv === 'development';
export const isTest = env.nodeEnv === 'test';
export const isPushConfigured = validateVapidConfiguration(env, { required: false });
