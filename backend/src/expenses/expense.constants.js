export const EXPENSE_CATEGORIES = Object.freeze([
  'groceries',
  'snacks',
  'outside_food',
  'household_supplies',
  'utilities',
  'other',
]);

export const EXPENSE_CATEGORY_LABELS = Object.freeze({
  groceries: 'Groceries',
  snacks: 'Snacks & Tea',
  outside_food: 'Outside Food',
  household_supplies: 'Household Supplies',
  utilities: 'Utilities',
  other: 'Other',
});

export const SPLIT_TYPES = Object.freeze(['equal', 'personal', 'custom']);

export const EXPENSE_STATUSES = Object.freeze({
  RECORDED: 'recorded',
  VOIDED: 'voided',
});

export const REIMBURSEMENT_STATUSES = Object.freeze({
  RECORDED: 'recorded',
  VOIDED: 'voided',
});

export const REIMBURSEMENT_METHODS = Object.freeze(['upi', 'cash', 'bank_transfer', 'other']);

export const MAX_EXPENSE_AMOUNT_PAISE = 100_000_000; // ₹10,00,000 in integer paise
export const MAX_EXPENSE_TITLE_LENGTH = 120;
export const MAX_EXPENSE_NOTE_LENGTH = 500;
export const MAX_REIMBURSEMENT_REF_LENGTH = 120;
export const MAX_VOID_REASON_LENGTH = 300;

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return typeof value === 'string' && UUID_V4_REGEX.test(value);
}

export function isValidLogicalDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2020 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function isValidLogicalMonth(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 2020 && year <= 2099 && month >= 1 && month <= 12;
}

export function isSafeIntegerPaise(value) {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_EXPENSE_AMOUNT_PAISE
  );
}
