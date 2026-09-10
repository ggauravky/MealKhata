import { env } from '../config/env.js';
import { ROLES } from '../auth/permissions.js';

const logicalDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isValidLogicalDate(value) {
  if (typeof value !== 'string' || !logicalDatePattern.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function getLogicalDateInTimeZone(now = new Date(), timeZone = env.appTimezone) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function canEditDate({ role, targetDate, now = new Date(), timeZone = env.appTimezone }) {
  if (!isValidLogicalDate(targetDate)) {
    throw new TypeError('targetDate must be a valid date in YYYY-MM-DD format');
  }

  if (role === ROLES.SUPERADMIN) {
    return true;
  }

  if (role !== ROLES.ADMIN) {
    return false;
  }

  return targetDate === getLogicalDateInTimeZone(now, timeZone);
}
