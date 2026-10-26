import { PaymentReferenceClaim } from './paymentReference.model.js';
import { HostelDepositTransaction } from '../stays/stay.model.js';
import { RoomPayment } from '../roomFees/roomPayment.model.js';
import { Payment } from '../payments/payment.model.js';
import { ExpenseReimbursement } from '../expenses/expenseReimbursement.model.js';
import { UnallocatedCredit } from '../stays/paymentReclassification.model.js';

export function normalizeExternalPaymentReference(reference) {
  if (typeof reference !== 'string') return null;
  const normalized = reference.trim().replace(/\s+/g, ' ').toUpperCase();
  return normalized || null;
}

function exactReferencePattern(normalizedReference) {
  return new RegExp(
    `^${normalizedReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}$`,
    'i',
  );
}

async function findLegacyDuplicate({ normalizedReference, ledger, documentId, session }) {
  const reference = exactReferencePattern(normalizedReference);
  const queries = [
    ['HOSTEL_DEPOSIT', HostelDepositTransaction.findOne({
      reference,
      status: { $in: ['recorded', 'reclassified'] },
      depositTransactionId: { $ne: ledger === 'HOSTEL_DEPOSIT' ? documentId : null },
    }).session(session).lean(), 'depositTransactionId', 'hostel_deposit_transactions'],
    ['ROOM_PAYMENT', RoomPayment.findOne({
      reference,
      status: 'verified',
      roomPaymentId: { $ne: ledger === 'ROOM_PAYMENT' ? documentId : null },
    }).session(session).lean(), 'roomPaymentId', 'room_payments'],
    ['MESS_PAYMENT', Payment.findOne({
      upiReference: reference,
      status: 'recorded',
      paymentId: { $ne: ledger === 'MESS_PAYMENT' ? documentId : null },
    }).session(session).lean(), 'paymentId', 'payments'],
    ['EXPENSE_REIMBURSEMENT', ExpenseReimbursement.findOne({
      reference,
      status: 'recorded',
      reimbursementId: { $ne: ledger === 'EXPENSE_REIMBURSEMENT' ? documentId : null },
    }).session(session).lean(), 'reimbursementId', 'expense_reimbursements'],
    ['UNALLOCATED_CREDIT', UnallocatedCredit.findOne({ reference }).session(session).lean(), 'creditId', 'unallocated_credits'],
  ];
  for (const [, query, idField, collection] of queries) {
    const duplicate = await query;
    if (duplicate) return { collection, documentId: duplicate[idField] };
  }
  return null;
}

export async function claimExternalPaymentReference({
  reference,
  ledger,
  documentId,
  memberId = null,
  session,
}) {
  const normalizedReference = normalizeExternalPaymentReference(reference);
  if (!normalizedReference) return null;
  if (!session) {
    const error = new Error('Database transaction support is required to claim a payment reference.');
    error.statusCode = 503;
    error.details = { code: 'TRANSACTION_REQUIRED' };
    throw error;
  }

  const legacyDuplicate = await findLegacyDuplicate({ normalizedReference, ledger, documentId, session });
  if (legacyDuplicate) {
    const error = new Error('This external payment reference already exists in another active ledger.');
    error.statusCode = 409;
    error.details = { code: 'DUPLICATE_PAYMENT_REFERENCE', duplicate: legacyDuplicate };
    throw error;
  }

  const claim = await PaymentReferenceClaim.findOneAndUpdate(
    { normalizedReference },
    {
      $setOnInsert: {
        normalizedReference,
        originalReference: reference.trim(),
        ledger,
        documentId,
        memberId,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true, session },
  );

  if (claim.ledger !== ledger || claim.documentId !== documentId) {
    const error = new Error('This external payment reference is already claimed by another ledger record.');
    error.statusCode = 409;
    error.details = {
      code: 'DUPLICATE_PAYMENT_REFERENCE',
      duplicate: { ledger: claim.ledger, documentId: claim.documentId },
    };
    throw error;
  }
  return claim.toObject();
}
