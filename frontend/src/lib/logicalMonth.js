const logicalMonthPattern = /^(\d{4})-(\d{2})$/;

function parseLogicalMonth(value) {
  const match = logicalMonthPattern.exec(value ?? '');

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

export function addLogicalMonths(value, amount) {
  const parts = parseLogicalMonth(value);

  if (!parts) {
    return value;
  }

  return new Date(Date.UTC(parts.year, parts.month - 1 + amount, 1, 12))
    .toISOString()
    .slice(0, 7);
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

export function getMondayFirstOffset(logicalDate) {
  const [year, month, day] = logicalDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return (weekday + 6) % 7;
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

