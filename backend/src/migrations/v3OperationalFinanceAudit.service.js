import { normalizeExternalPaymentReference } from '../finance/paymentReference.service.js';
import { getLogicalDateInTimeZone, isValidLogicalDate } from '../utils/date.js';
import { isValidLogicalMonth } from '../utils/month.js';

const COLLECTIONS = Object.freeze([
  'payments', 'room_charges', 'room_payments', 'room_fee_plans', 'monthly_settlements',
  'expenses', 'expense_reimbursements', 'hostel_stays', 'hostel_deposit_accounts',
  'hostel_deposit_transactions', 'hostel_clearances', 'payment_reclassifications', 'unallocated_credits',
  'credit_allocations', 'payment_reference_claims',
]);

function positivePaise(value) { return Number.isSafeInteger(value) && value > 0; }

function indiaDate(value) {
  if (typeof value === 'string' && isValidLogicalDate(value)) return value;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return getLogicalDateInTimeZone(value, 'Asia/Kolkata');
}

function recordMap(rows, key) { return new Map(rows.map(row => [row[key], row])); }

/** Read-only post-cutover audit of effective financial dates and linked obligations. */
export async function auditV3OperationalFinances(db, financialStartDate) {
  if (!db?.collection || !db.client?.startSession) {
    throw new Error('A connected replica-set target database is required for financial reconciliation');
  }
  const session = db.client.startSession();
  let rows;
  try {
    rows = await session.withTransaction(async () => {
      const snapshot = {};
      for (const name of COLLECTIONS) {
        snapshot[name] = await db.collection(name).find({}, { session }).toArray();
      }
      return snapshot;
    }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
  } finally { await session.endSession(); }
  const issues = [];
  const start = isValidLogicalDate(financialStartDate) ? financialStartDate : null;
  const startMonth = start?.slice(0, 7);
  const checkDate = (label, value) => {
    const date = indiaDate(value);
    if (!start || !date || date < start) issues.push(`${label}: invalid or pre-boundary effective date`);
  };
  const checkMonth = (label, value, fullMonth = false) => {
    if (!start || !isValidLogicalMonth(value) || value < startMonth
      || (fullMonth && value === startMonth && !start.endsWith('-01'))) {
      issues.push(`${label}: invalid or pre-boundary obligation month`);
    }
  };
  if (!start && COLLECTIONS.some(name => rows[name].length)) {
    issues.push('Operational financial records exist without a valid financial start boundary');
  }

  const charges = recordMap(rows.room_charges, 'chargeId');
  const expenses = recordMap(rows.expenses, 'expenseId');
  const stays = recordMap(rows.hostel_stays, 'stayId');
  const depositAccounts = recordMap(rows.hostel_deposit_accounts, 'depositAccountId');
  const deposits = recordMap(rows.hostel_deposit_transactions, 'depositTransactionId');
  const reclassifications = recordMap(rows.payment_reclassifications, 'reclassificationId');
  const credits = recordMap(rows.unallocated_credits, 'creditId');
  const payments = recordMap(rows.payments, 'paymentId');
  const roomPayments = recordMap(rows.room_payments, 'roomPaymentId');
  const reimbursements = recordMap(rows.expense_reimbursements, 'reimbursementId');

  const chargeKeys = new Set();
  for (const charge of rows.room_charges) {
    const label = `room_charges ${charge.chargeId}`;
    checkMonth(label, charge.month, true);
    const key = `${charge.memberId}:${charge.month}`;
    if (chargeKeys.has(key)) issues.push(`${label}: duplicate room charge obligation ${key}`);
    chargeKeys.add(key);
    const total = charge.baseAmountPaise + (charge.adjustments ?? [])
      .reduce((sum, adjustment) => sum + adjustment.amountPaise, 0);
    if (!Number.isSafeInteger(total) || total < 0) issues.push(`${label}: invalid integer-paise charge total`);
    for (const adjustment of charge.adjustments ?? []) {
      checkDate(`${label} adjustment ${adjustment.adjustmentId}`, adjustment.createdAt);
      if (!Number.isSafeInteger(adjustment.amountPaise)) {
        issues.push(`${label} adjustment ${adjustment.adjustmentId}: invalid integer-paise amount`);
      }
    }
  }
  for (const plan of rows.room_fee_plans) checkMonth(`room_fee_plans ${plan.feePlanId}`, plan.effectiveFromMonth, true);
  for (const settlement of rows.monthly_settlements) checkMonth(`monthly_settlements ${settlement.month}`, settlement.month, true);
  for (const payment of rows.payments) {
    checkMonth(`payments ${payment.paymentId}`, payment.month);
    checkDate(`payments ${payment.paymentId}`, payment.recordedAt);
    if (!positivePaise(payment.amountPaise)) issues.push(`payments ${payment.paymentId}: invalid integer-paise amount`);
  }
  const roomPaid = new Map();
  for (const payment of rows.room_payments) {
    const label = `room_payments ${payment.roomPaymentId}`;
    const charge = charges.get(payment.chargeId);
    if (!charge || charge.memberId !== payment.memberId || charge.month !== payment.month) {
      issues.push(`${label}: missing or mismatched charge obligation`);
    } else checkMonth(label, charge.month, true);
    checkDate(label, payment.recordedAt);
    if (!positivePaise(payment.amountPaise)) issues.push(`${label}: invalid integer-paise amount`);
    if (payment.status === 'verified') roomPaid.set(payment.chargeId,
      (roomPaid.get(payment.chargeId) ?? 0) + payment.amountPaise);
  }
  for (const [chargeId, paid] of roomPaid) {
    const charge = charges.get(chargeId);
    const due = charge?.baseAmountPaise + (charge?.adjustments ?? [])
      .reduce((sum, item) => sum + item.amountPaise, 0);
    if (!Number.isSafeInteger(paid) || !Number.isSafeInteger(due) || paid > due) {
      issues.push(`room_charges ${chargeId}: payment total exceeds exact charge balance`);
    }
  }
  for (const expense of rows.expenses) {
    const label = `expenses ${expense.expenseId}`;
    checkDate(label, expense.date);
    if (!positivePaise(expense.amountPaise)
      || (expense.allocations ?? []).reduce((sum, item) => sum + item.amountPaise, 0) !== expense.amountPaise) {
      issues.push(`${label}: expense allocations do not conserve exact integer paise`);
    }
  }
  const reimbursed = new Map();
  for (const reimbursement of rows.expense_reimbursements) {
    const label = `expense_reimbursements ${reimbursement.reimbursementId}`;
    const expense = expenses.get(reimbursement.expenseId);
    if (!expense) issues.push(`${label}: missing expense obligation`);
    else {
      checkDate(`${label} linked expense ${expense.expenseId}`, expense.date);
      if (reimbursement.expenseMonth !== expense.date?.slice(0, 7)
        || reimbursement.toMemberId !== expense.paidByMemberId
        || reimbursement.fromMemberId === expense.paidByMemberId
        || !(expense.allocations ?? []).some(item => item.memberId === reimbursement.fromMemberId)) {
        issues.push(`${label}: mismatched expense obligation`);
      }
    }
    checkDate(label, reimbursement.recordedAt);
    if (!positivePaise(reimbursement.amountPaise)) issues.push(`${label}: invalid integer-paise amount`);
    if (reimbursement.status === 'recorded') {
      const key = `${reimbursement.expenseId}:${reimbursement.fromMemberId}`;
      reimbursed.set(key, (reimbursed.get(key) ?? 0) + reimbursement.amountPaise);
    }
  }
  for (const [key, paid] of reimbursed) {
    const [expenseId, memberId] = key.split(':');
    const share = expenses.get(expenseId)?.allocations?.find(item => item.memberId === memberId)?.amountPaise;
    if (!Number.isSafeInteger(paid) || !Number.isSafeInteger(share) || paid > share) {
      issues.push(`expense_reimbursements ${key}: reimbursements exceed exact obligation share`);
    }
  }

  const depositTotals = new Map();
  for (const transaction of rows.hostel_deposit_transactions) {
    const label = `hostel_deposit_transactions ${transaction.depositTransactionId}`;
    checkDate(label, transaction.recordedAt);
    const account = depositAccounts.get(transaction.depositAccountId);
    const stay = stays.get(transaction.stayId);
    if (!account || !stay || account.stayId !== transaction.stayId
      || account.memberId !== transaction.memberId || stay.memberId !== transaction.memberId) {
      issues.push(`${label}: missing or mismatched deposit account/Stay`);
    }
    if (!positivePaise(transaction.amountPaise)) issues.push(`${label}: invalid integer-paise amount`);
    if (transaction.status === 'recorded') {
      const totals = depositTotals.get(transaction.depositAccountId) ?? { received: 0, spent: 0 };
      if (transaction.type === 'RECEIVED') totals.received += transaction.amountPaise;
      if (['REFUNDED', 'DEDUCTED'].includes(transaction.type)) totals.spent += transaction.amountPaise;
      depositTotals.set(transaction.depositAccountId, totals);
    }
  }
  for (const [accountId, totals] of depositTotals) {
    if (!Number.isSafeInteger(totals.received - totals.spent) || totals.spent > totals.received) {
      issues.push(`hostel_deposit_accounts ${accountId}: deposit balance is inconsistent`);
    }
  }
  for (const clearance of rows.hostel_clearances) {
    const label = `hostel_clearances ${clearance.clearanceId}`;
    checkDate(label, clearance.financialAsOf);
    const stay = stays.get(clearance.stayId);
    if (!stay || stay.memberId !== clearance.memberId) {
      issues.push(`${label}: missing or mismatched Stay context`);
    }
  }
  for (const journal of rows.payment_reclassifications) {
    const label = `payment_reclassifications ${journal.reclassificationId}`;
    const source = deposits.get(journal.sourceDepositTransactionId);
    checkDate(label, journal.paymentDate);
    if (!source || source.status !== 'reclassified' || source.type !== 'RECEIVED'
      || source.reclassificationId !== journal.reclassificationId
      || source.memberId !== journal.memberId || source.amountPaise !== journal.amountPaise
      || indiaDate(source.recordedAt) !== indiaDate(journal.paymentDate)) {
      issues.push(`${label}: missing or mismatched source receipt`);
    }
    if (!positivePaise(journal.amountPaise) || (journal.allocations ?? [])
      .reduce((sum, item) => sum + item.amountPaise, 0) !== journal.amountPaise) {
      issues.push(`${label}: reclassification does not conserve exact integer paise`);
    }
  }
  for (const credit of rows.unallocated_credits) {
    const label = `unallocated_credits ${credit.creditId}`;
    checkDate(label, credit.paymentDate);
    const journal = reclassifications.get(credit.reclassificationId);
    if (!journal || journal.sourceDepositTransactionId !== credit.sourceDepositTransactionId
      || journal.memberId !== credit.memberId || indiaDate(journal.paymentDate) !== indiaDate(credit.paymentDate)) {
      issues.push(`${label}: missing or mismatched source reclassification`);
    }
    if (!positivePaise(credit.amountPaise) || !Number.isSafeInteger(credit.allocatedAmountPaise)
      || !Number.isSafeInteger(credit.settledAmountPaise) || !Number.isSafeInteger(credit.remainingAmountPaise)
      || credit.allocatedAmountPaise < 0 || credit.settledAmountPaise < 0 || credit.remainingAmountPaise < 0
      || credit.allocatedAmountPaise + credit.settledAmountPaise + credit.remainingAmountPaise !== credit.amountPaise) {
      issues.push(`${label}: credit conservation differs by at least one paise`);
    }
  }
  for (const allocation of rows.credit_allocations) {
    const label = `credit_allocations ${allocation.creditAllocationId}`;
    checkDate(label, allocation.completedAt);
    const credit = credits.get(allocation.creditId);
    if (!credit || credit.reclassificationId !== allocation.reclassificationId
      || credit.sourceDepositTransactionId !== allocation.sourceDepositTransactionId
      || credit.memberId !== allocation.memberId) issues.push(`${label}: missing or mismatched source credit`);
    if (!positivePaise(allocation.amountPaise)) issues.push(`${label}: invalid integer-paise amount`);
    if (allocation.destinationType === 'ROOM_FEE') {
      const charge = charges.get(allocation.targetRecordId);
      if (!charge || charge.memberId !== allocation.memberId) issues.push(`${label}: missing or mismatched room charge`);
      else checkMonth(label, charge.month, true);
    } else if (allocation.destinationType === 'EXPENSE_REIMBURSEMENT') {
      const expense = expenses.get(allocation.targetRecordId);
      if (!expense || !(expense.allocations ?? []).some(item => item.memberId === allocation.memberId)) {
        issues.push(`${label}: missing or mismatched expense obligation`);
      } else checkDate(label, expense.date);
    } else if (allocation.destinationType === 'MESS') checkMonth(label, allocation.targetRecordId);
    else if (allocation.destinationType === 'EXTERNAL_SETTLEMENT') checkDate(label, allocation.settledAt);
    else issues.push(`${label}: unsupported destination`);
    if (allocation.targetLedgerRecordId) {
      const ledger = allocation.destinationType === 'ROOM_FEE' ? roomPayments
        : allocation.destinationType === 'EXPENSE_REIMBURSEMENT' ? reimbursements : payments;
      const record = ledger.get(allocation.targetLedgerRecordId);
      if (!record || record.sourceCreditAllocationId !== allocation.creditAllocationId
        || record.amountPaise !== allocation.amountPaise || record.memberId !== allocation.memberId
          && record.fromMemberId !== allocation.memberId) {
        issues.push(`${label}: missing or mismatched funded ledger entry`);
      }
    }
  }

  const claimTargets = {
    HOSTEL_DEPOSIT: [deposits, 'reference'], ROOM_PAYMENT: [roomPayments, 'reference'],
    MESS_PAYMENT: [payments, 'upiReference'], EXPENSE_REIMBURSEMENT: [reimbursements, 'reference'],
  };
  const seenClaims = new Set();
  for (const claim of rows.payment_reference_claims) {
    const label = `payment_reference_claims ${claim.normalizedReference}`;
    if (seenClaims.has(claim.normalizedReference)) issues.push(`${label}: duplicate payment reference claim`);
    seenClaims.add(claim.normalizedReference);
    const [ledger, field] = claimTargets[claim.ledger] ?? [];
    const record = ledger?.get(claim.documentId);
    if (!record || normalizeExternalPaymentReference(record[field]) !== claim.normalizedReference
      || record.memberId !== claim.memberId && record.fromMemberId !== claim.memberId) {
      issues.push(`${label}: missing or mismatched ledger reference`);
    }
  }
  return { passed: issues.length === 0, issues,
    counts: Object.fromEntries(COLLECTIONS.map(name => [name, rows[name].length])) };
}
