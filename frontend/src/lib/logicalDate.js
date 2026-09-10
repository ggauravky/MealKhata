const logicalDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseParts(value) {
  const match = logicalDatePattern.exec(value ?? '');

  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function isValidLogicalDate(value) {
  const parts = parseParts(value);

  if (!parts) {
    return false;
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  return date.toISOString().slice(0, 10) === value;
}

export function formatLogicalDate(value, options = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const parts = parseParts(value);

  if (!parts) {
    return value;
  }

  const safeDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'UTC' }).format(safeDate);
}

export function addLogicalDays(value, amount) {
  const parts = parseParts(value);

  if (!parts) {
    return value;
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount, 12));
  return date.toISOString().slice(0, 10);
}

export function formatIndiaTime(value) {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}
