export function getSafeNextPath(value, fallback = '/admin') {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return fallback;
  }

  try {
    const base = new URL('https://meal-khata.local');
    const target = new URL(value, base);

    if (target.origin !== base.origin) {
      return fallback;
    }

    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
