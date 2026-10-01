const logicalMonthPattern = /^(\d{4})-(\d{2})$/;

function parseLogicalMonth(value) {
  const match = typeof value === 'string' ? logicalMonthPattern.exec(value) : null;

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

export function isValidLogicalMonth(value) {
  return parseLogicalMonth(value) !== null;
}

export function daysInLogicalMonth(value) {
  const parts = parseLogicalMonth(value);

  if (!parts) {
    throw new TypeError('month must use the YYYY-MM format');
  }

  return new Date(Date.UTC(parts.year, parts.month, 0, 12)).getUTCDate();
}

export function firstDateOfMonth(value) {
  if (!isValidLogicalMonth(value)) {
    throw new TypeError('month must use the YYYY-MM format');
  }

  return `${value}-01`;
}

export function lastDateOfMonth(value) {
  return `${value}-${String(daysInLogicalMonth(value)).padStart(2, '0')}`;
}

export function listDatesInMonth(value) {
  return Array.from(
    { length: daysInLogicalMonth(value) },
    (_, index) => `${value}-${String(index + 1).padStart(2, '0')}`,
  );
}

export function compareLogicalMonths(left, right) {
  if (!isValidLogicalMonth(left) || !isValidLogicalMonth(right)) {
    throw new TypeError('both months must use the YYYY-MM format');
  }

  return left === right ? 0 : left < right ? -1 : 1;
}

export function getPreviousLogicalMonth(value) {
  const parts = parseLogicalMonth(value);

  if (!parts) {
    throw new TypeError('month must use the YYYY-MM format');
  }

  const year = parts.month === 1 ? parts.year - 1 : parts.year;
  const month = parts.month === 1 ? 12 : parts.month - 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function getNextLogicalMonth(value) {
  const parts = parseLogicalMonth(value);

  if (!parts) {
    throw new TypeError('month must use the YYYY-MM format');
  }

  const year = parts.month === 12 ? parts.year + 1 : parts.year;
  const month = parts.month === 12 ? 1 : parts.month + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function formatLogicalMonth(value) {
  const parts = parseLogicalMonth(value);

  if (!parts) {
    return value;
  }

  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, 1, 12)));
}

