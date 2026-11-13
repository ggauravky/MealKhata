import bcrypt from 'bcryptjs';
import { STRONG_PASSWORD_PATTERN } from '../auth/accountSecurity.js';
import { isValidLogicalDate } from '../utils/date.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates the owner's setup answers and hashes the password with bcrypt cost 12. */
export async function prepareFirstAdmin({ email, financialStartDate, password, passwordConfirmation } = {}) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new Error('A valid Super Admin email is required');
  }
  if (!isValidLogicalDate(financialStartDate)) {
    throw new Error('A valid financial start date (YYYY-MM-DD) is required');
  }
  if (typeof password !== 'string' || !STRONG_PASSWORD_PATTERN.test(password)) {
    throw new Error('Password must be 12-256 characters with upper, lower, number and symbol');
  }
  if (password !== passwordConfirmation) throw new Error('Passwords do not match');
  return {
    email: normalizedEmail,
    financialStartDate,
    passwordHash: await bcrypt.hash(password, 12),
  };
}

/** Parses `--email x --start-date y` style arguments; unknown flags are rejected. */
export function parseSetupArguments(argv) {
  const allowed = new Map([['--email', 'email'], ['--start-date', 'financialStartDate']]);
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--reset-password') {
      result.resetPassword = true;
      continue;
    }
    const key = allowed.get(argv[index]);
    if (!key || argv[index + 1] === undefined || argv[index + 1].startsWith('--')) {
      throw new Error(`Unknown or incomplete option: ${argv[index]}`);
    }
    result[key] = argv[index + 1];
    index += 1;
  }
  return result;
}

/** Describes the target without credentials, for the confirmation prompt. */
export function describeMongoTarget(mongoUri) {
  const url = new URL(mongoUri);
  return { host: url.hostname, database: decodeURIComponent(url.pathname.slice(1)) };
}
