export const ROOM_PAYMENT_METHODS = Object.freeze(['upi', 'cash', 'bank_transfer', 'other']);

export const ROOM_CHARGE_STATUSES = Object.freeze({
  ISSUED: 'issued',
  CANCELLED: 'cancelled',
});

export const ROOM_PAYMENT_STATUSES = Object.freeze({
  VERIFIED: 'verified',
  VOIDED: 'voided',
});

export const ROOM_PAYMENT_SUMMARY_STATUSES = Object.freeze({
  NOT_ISSUED: 'not_issued',
  UPCOMING: 'upcoming',
  DUE: 'due',
  PARTIAL: 'partial',
  PAID: 'paid',
  OVERDUE: 'overdue',
  OVERPAID: 'overpaid',
  CANCELLED: 'cancelled',
});

export const RECIPIENT_MODES = Object.freeze({
  HOSTEL_OWNER: 'hostel_owner',
  ADMIN_COLLECTOR: 'admin_collector',
});

export const ROOM_SETTINGS_KEY = 'singleton';

export const MIN_ROOM_CAPACITY = 1;
export const MAX_ROOM_CAPACITY = 10;
export const DEFAULT_ROOM_CAPACITY = 2;

export const DEFAULT_DUE_DAY = 5;
export const MIN_DUE_DAY = 1;
export const MAX_DUE_DAY = 28;

export const MAX_ROOM_FEE_PAISE = 50_000_000; // ₹5,00,000 max fee
export const MAX_ROOM_PAYMENT_PAISE = 100_000_000; // ₹10,00,000 max payment

export const MAX_ROOM_NUMBER_LENGTH = 20;
export const MAX_ROOM_LABEL_LENGTH = 50;
export const MAX_REASON_LENGTH = 200;
export const MAX_REFERENCE_LENGTH = 100;
export const MAX_RECIPIENT_NAME_LENGTH = 100;
export const MAX_UPI_ID_LENGTH = 100;
export const MAX_INSTRUCTIONS_LENGTH = 500;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isValidRoomFeeAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_ROOM_FEE_PAISE;
}

export function isValidRoomPaymentAmount(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_ROOM_PAYMENT_PAISE;
}
