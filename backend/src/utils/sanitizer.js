const SENSITIVE_KEY_PATTERN = /^(password|passwordhash|hash|token|authorization|cookie|secret|jwt|vapid|p256dh|endpoint|upireference|upisecret|key|mongouri)$/i;
const SENSITIVE_SUBSTRING_PATTERN = /(password|jwtsecret|vapidprivate|authtoken|secretkey)/i;
const MONGO_URI_PATTERN = /mongodb(\+srv)?:\/\/[^\s"']+/gi;
const JWT_PATTERN = /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g;

/**
 * Recursively redacts sensitive keys and values from objects, arrays, and strings.
 * Safe for JSON serialization (handles circular references and non-plain objects).
 */
export function sanitizeLogMetadata(data, depth = 0, seen = new WeakSet()) {
  if (depth > 8) {
    return '[TRUNCATED_DEPTH]';
  }

  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return sanitizeString(data);
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (data instanceof Date) {
    return data.toISOString();
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: sanitizeString(data.message),
      code: data.code,
      statusCode: data.statusCode,
    };
  }

  if (typeof data === 'object') {
    if (seen.has(data)) {
      return '[CIRCULAR]';
    }
    seen.add(data);

    if (Array.isArray(data)) {
      return data.map((item) => sanitizeLogMetadata(item, depth + 1, seen));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      if (isSensitiveKey(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeLogMetadata(value, depth + 1, seen);
      }
    }
    return sanitized;
  }

  return String(data);
}

function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  const lower = key.toLowerCase();
  // Ensure non-sensitive terms like actorRole, author, isAuthenticated aren't accidentally matched
  if (lower === 'actorrole' || lower === 'actor' || lower === 'status' || lower === 'authenticated') {
    return false;
  }
  return SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_SUBSTRING_PATTERN.test(key);
}

function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(MONGO_URI_PATTERN, 'mongodb://[REDACTED_URI]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]');
}
