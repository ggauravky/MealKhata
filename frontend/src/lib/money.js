export const MAX_MEAL_PRICE_PAISE = 10_000_000;
export const MAX_PAYMENT_AMOUNT_PAISE = 100_000_000;

const wholeInrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const fractionalInrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function parseRupeesToPaise(value, maximumPaise) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());

  if (!match) {
    return null;
  }

  const paise = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');

  if (paise > BigInt(maximumPaise)) {
    return null;
  }

  return Number(paise);
}

export function rupeesToPaise(value) {
  return parseRupeesToPaise(value, MAX_MEAL_PRICE_PAISE);
}

export function paymentRupeesToPaise(value) {
  const result = parseRupeesToPaise(value, MAX_PAYMENT_AMOUNT_PAISE);
  return result !== null && result > 0 ? result : null;
}

export function paiseToRupeeInput(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    return '';
  }

  const rupees = Math.floor(value / 100);
  const paise = value % 100;
  return paise === 0 ? String(rupees) : `${rupees}.${String(paise).padStart(2, '0')}`;
}

export function formatPaise(value) {
  if (!Number.isSafeInteger(value)) {
    return 'Rates not set';
  }

  const formatter = value % 100 === 0 ? wholeInrFormatter : fractionalInrFormatter;
  return formatter.format(value / 100);
}
