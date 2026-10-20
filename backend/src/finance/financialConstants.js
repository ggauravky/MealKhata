/**
 * MealKhata 2.0 - Phase 3 Financial Constants & Enums
 */

export const FINANCIAL_DOMAINS = Object.freeze({
  MESS: 'mess',
  ROOM_FEES: 'room_fees',
  EXPENSES: 'expenses',
});

export const OVERALL_PAYMENT_STATUSES = Object.freeze({
  PAID: 'paid',
  PARTIAL: 'partial',
  PENDING: 'pending',
  NO_DUE: 'no_due',
  NOT_ISSUED: 'not_issued',
});

export const FINANCIAL_TIMEZONE = 'Asia/Kolkata';
export const FINANCIAL_CURRENCY = 'INR';

export function formatRupees(amountPaise) {
  if (typeof amountPaise !== 'number' || isNaN(amountPaise)) {
    return '₹0.00';
  }
  const isNegative = amountPaise < 0;
  const absPaise = Math.abs(amountPaise);
  const rupees = (absPaise / 100).toFixed(2);
  return `${isNegative ? '-' : ''}₹${rupees}`;
}

export function formatPdfCurrency(amountPaise) {
  if (typeof amountPaise !== 'number' || isNaN(amountPaise)) {
    return 'Rs. 0.00';
  }
  const isNegative = amountPaise < 0;
  const absPaise = Math.abs(amountPaise);
  const rupees = (absPaise / 100).toFixed(2);
  return `${isNegative ? '-' : ''}Rs. ${rupees}`;
}
