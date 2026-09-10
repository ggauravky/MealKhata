export const PAYMENT_SETTINGS_KEY = 'primary';
export const PAYMENT_METHODS = Object.freeze(['upi']);
export const PAYMENT_ENTRY_STATUSES = Object.freeze(['recorded', 'voided']);
export const PAYMENT_SUMMARY_STATUSES = Object.freeze([
  'rates_missing',
  'not_due_yet',
  'no_due',
  'pending',
  'partial',
  'paid',
  'overpaid',
]);

export const MAX_PAYMENT_AMOUNT_PAISE = 100_000_000;
export const MAX_UPI_REFERENCE_LENGTH = 100;
export const MAX_VOID_REASON_LENGTH = 200;
export const MAX_RECEIVER_NAME_LENGTH = 100;
export const MAX_UPI_ID_LENGTH = 100;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidPaymentAmount(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_PAYMENT_AMOUNT_PAISE;
}

export function isValidUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

