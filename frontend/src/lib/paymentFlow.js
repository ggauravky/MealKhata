export const PAYMENT_STATUS_LABELS = Object.freeze({
  rates_missing: 'Rates not set',
  not_due_yet: 'Not due yet',
  no_due: 'No payment due',
  pending: 'Pending',
  partial: 'Partially paid',
  paid: 'Paid',
  overpaid: 'Overpaid',
});

export function canInitiatePayment({ role, member, currentMemberId }) {
  const isAllowedRole =
    ['admin', 'superadmin'].includes(role) ||
    (role === 'member' && Boolean(currentMemberId) && currentMemberId === member?.id);

  return (
    isAllowedRole &&
    Boolean(member) &&
    ['pending', 'partial'].includes(member.status) &&
    Number.isSafeInteger(member.remainingAmountPaise) &&
    member.remainingAmountPaise > 0
  );
}

export function createIdempotencyKey(cryptoSource = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === 'function') return cryptoSource.randomUUID();

  const bytes = new Uint8Array(16);
  cryptoSource.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getIndianMobileDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits.length === 10 ? digits : '';
}

export function formatReceiverMobile(value) {
  const digits = getIndianMobileDigits(value);
  return digits ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : String(value ?? '');
}

export function getReceiverMobileCopyValue(value) {
  const digits = getIndianMobileDigits(value);
  return digits ? `+91${digits}` : String(value ?? '');
}
