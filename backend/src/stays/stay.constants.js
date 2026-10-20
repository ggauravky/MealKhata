/**
 * MealKhata 2.0 - Hostel Stay Lifecycle & Deposit Constants
 */

export const STAY_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  CHECKOUT_REQUESTED: 'CHECKOUT_REQUESTED',
  CHECKOUT_PENDING: 'CHECKOUT_PENDING',
  CHECKED_OUT: 'CHECKED_OUT',
});

export const DEPOSIT_TRANSACTION_TYPES = Object.freeze({
  RECEIVED: 'RECEIVED',
  REFUNDED: 'REFUNDED',
  DEDUCTED: 'DEDUCTED',
});

export const DEPOSIT_ACCOUNT_STATUSES = Object.freeze({
  OPEN: 'OPEN',
  SETTLED: 'SETTLED',
});

export const DEPOSIT_METHODS = Object.freeze({
  UPI: 'upi',
  CASH: 'cash',
  BANK_TRANSFER: 'bank_transfer',
});

export const DEPOSIT_HOLDER_TYPES = Object.freeze({
  HOSTEL_OWNER: 'hostel_owner',
  ADMIN_COLLECTOR: 'admin_collector',
});

export const CLEARANCE_STATUSES = Object.freeze({
  NO_DUES: 'NO_DUES',
  OUTSTANDING_DUES: 'OUTSTANDING_DUES',
});

export const MAX_REASON_LENGTH = 500;
export const MAX_REFERENCE_LENGTH = 120;
export const MAX_NOTE_LENGTH = 500;
export const MAX_DEPOSIT_PAISE = 50_000_000; // ₹5,00,000 maximum deposit cap
