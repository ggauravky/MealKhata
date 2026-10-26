/**
 * MealKhata 2.0 - Security Deposit Domain Service
 * Manages refundable deposit accounts, receipts, refunds, and damage deductions.
 */

import { createHash, randomUUID } from 'node:crypto';
import { stayRepository } from './stay.repository.js';
import {
  DEPOSIT_ACCOUNT_STATUSES,
  DEPOSIT_METHODS,
  DEPOSIT_TRANSACTION_TYPES,
  MAX_DEPOSIT_PAISE,
  MAX_NOTE_LENGTH,
} from './stay.constants.js';

export class DepositDomainError extends Error {
  constructor(message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'DepositDomainError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function createDepositService({ repository = stayRepository } = {}) {
  function normalizeReclassificationRequest({
    stayId,
    sourceDepositTransactionId,
    expectedAccountRevision,
    allocations,
    reason,
    idempotencyKey,
  }) {
    const normalizedAllocations = Array.isArray(allocations)
      ? allocations.map((allocation) => ({
        category: allocation?.category,
        memberId: allocation?.memberId,
        targetAccount: typeof allocation?.targetAccount === 'string'
          ? allocation.targetAccount.trim()
          : '',
        amountPaise: allocation?.amountPaise,
      }))
      : [];
    const normalized = {
      stayId,
      sourceDepositTransactionId,
      expectedAccountRevision,
      allocations: normalizedAllocations,
      reason: typeof reason === 'string' ? reason.trim().slice(0, MAX_NOTE_LENGTH) : '',
      idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '',
    };
    return {
      ...normalized,
      requestFingerprint: createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
    };
  }

  return {
    /**
     * Compute current authoritative deposit balance for a stay
     */
    async getDepositSummary(stayId) {
      const [account, transactions, reclassifications, unallocatedCredits] = await Promise.all([
        repository.findDepositAccountByStayId(stayId),
        repository.listDepositTransactionsByStayId(stayId, { includeVoided: true }),
        typeof repository.listPaymentReclassificationsByStayId === 'function'
          ? repository.listPaymentReclassificationsByStayId(stayId)
          : [],
        typeof repository.listUnallocatedCreditsByStayId === 'function'
          ? repository.listUnallocatedCreditsByStayId(stayId)
          : [],
      ]);
      if (!account) {
        return {
          account: null,
          summary: {
            expectedPaise: 0,
            receivedPaise: 0,
            refundedPaise: 0,
            deductedPaise: 0,
            heldPaise: 0,
          },
          transactions,
          reclassifications,
          unallocatedCredits,
        };
      }

      let receivedPaise = 0;
      let refundedPaise = 0;
      let deductedPaise = 0;

      for (const tx of transactions) {
        if (tx.status !== 'recorded') continue;
        if (tx.type === DEPOSIT_TRANSACTION_TYPES.RECEIVED) {
          receivedPaise += tx.amountPaise;
        } else if (tx.type === DEPOSIT_TRANSACTION_TYPES.REFUNDED) {
          refundedPaise += tx.amountPaise;
        } else if (tx.type === DEPOSIT_TRANSACTION_TYPES.DEDUCTED) {
          deductedPaise += tx.amountPaise;
        }
      }

      const heldPaise = receivedPaise - refundedPaise - deductedPaise;

      // Hard financial invariant
      if (heldPaise < 0) {
        throw new DepositDomainError(
          `Critical deposit invariant violation: held deposit is negative (${heldPaise} paise).`,
          500,
          { receivedPaise, refundedPaise, deductedPaise, heldPaise },
        );
      }

      return {
        account,
        summary: {
          expectedPaise: account.expectedDepositPaise || 0,
          receivedPaise,
          refundedPaise,
          deductedPaise,
          heldPaise,
        },
        transactions,
        reclassifications,
        unallocatedCredits,
      };
    },

    async configureRequirement({
      stayId,
      required,
      expectedDepositPaise = 0,
      expectedRevision,
      reason,
      actorRole,
    }) {
      if (actorRole !== 'superadmin') {
        throw new DepositDomainError('Only Super Admin can configure deposit requirements.', 403);
      }
      if (!stayId) throw new DepositDomainError('Stay ID required.', 400);
      if (typeof required !== 'boolean') {
        throw new DepositDomainError('required must be a boolean.', 400);
      }
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new DepositDomainError('expectedRevision must be a non-negative integer.', 400);
      }
      if (!reason || reason.trim().length < 3) {
        throw new DepositDomainError('A deposit configuration reason is required.', 400);
      }
      if (
        !Number.isInteger(expectedDepositPaise)
        || expectedDepositPaise < 0
        || expectedDepositPaise > MAX_DEPOSIT_PAISE
      ) {
        throw new DepositDomainError('Expected deposit must be a non-negative integer in paise.', 400);
      }
      if (required && expectedDepositPaise <= 0) {
        throw new DepositDomainError('A required deposit must have a positive expected amount.', 400);
      }
      if (typeof repository.executeAtomicDepositConfiguration !== 'function') {
        throw new DepositDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
      }

      try {
        return await repository.executeAtomicDepositConfiguration({
          stayId,
          required,
          expectedDepositPaise,
          expectedRevision,
          reason: reason.trim().slice(0, 500),
          actorRole,
        });
      } catch (error) {
        throw new DepositDomainError(error.message, error.statusCode || 400, error.details || {});
      }
    },

    async previewPaymentReclassification(params) {
      if (params.actorRole !== 'superadmin') {
        throw new DepositDomainError('Only Super Admin can reclassify a payment.', 403);
      }
      const normalized = normalizeReclassificationRequest(params);
      if (!normalized.stayId || !normalized.sourceDepositTransactionId) {
        throw new DepositDomainError('Stay ID and source receipt are required.', 400);
      }
      if (!Number.isInteger(normalized.expectedAccountRevision) || normalized.expectedAccountRevision < 0) {
        throw new DepositDomainError('expectedAccountRevision must be a non-negative integer.', 400);
      }
      if (normalized.reason.length < 3) {
        throw new DepositDomainError('A payment correction reason is required.', 400);
      }
      if (!normalized.idempotencyKey) {
        throw new DepositDomainError('Idempotency key required.', 400);
      }
      if (normalized.allocations.length === 0) {
        throw new DepositDomainError('At least one exact allocation is required.', 400);
      }

      const source = await repository.findDepositTransactionById(normalized.sourceDepositTransactionId);
      if (!source || source.stayId !== normalized.stayId) {
        throw new DepositDomainError('Source deposit receipt not found for this Stay.', 404);
      }
      const account = await repository.findDepositAccountByStayId(normalized.stayId);
      const stay = await repository.findStayById(normalized.stayId);
      if (!account || !stay) throw new DepositDomainError('Source Stay or deposit account not found.', 404);
      const activeTransactions = await repository.listDepositTransactionsByStayId(normalized.stayId, {
        includeVoided: false,
      });
      const conflicts = [];
      if (source.type !== DEPOSIT_TRANSACTION_TYPES.RECEIVED || source.status !== 'recorded') {
        conflicts.push({ code: 'SOURCE_RECEIPT_NOT_ACTIVE', message: 'Source is not an active deposit receipt.' });
      }
      if (account.revision !== normalized.expectedAccountRevision) {
        conflicts.push({ code: 'DEPOSIT_REVISION_CONFLICT', message: 'Deposit account changed since it was loaded.' });
      }
      if (stay.status === 'CHECKED_OUT' && !stay.clearanceReviewOpenedAt) {
        conflicts.push({
          code: 'CLEARANCE_REVIEW_REQUIRED',
          message: 'Open an audited clearance review before changing this completed Stay ledger.',
        });
      }

      for (const allocation of normalized.allocations) {
        if (allocation.category !== 'UNALLOCATED_CREDIT') {
          conflicts.push({
            code: 'UNSUPPORTED_DESTINATION',
            category: allocation.category,
            message: 'This destination is not supported without a verified outstanding obligation.',
          });
        }
        if (allocation.memberId !== source.memberId) {
          conflicts.push({ code: 'MEMBER_MISMATCH', message: 'Allocation member must match the original receipt.' });
        }
        if (!allocation.targetAccount) {
          conflicts.push({ code: 'TARGET_ACCOUNT_REQUIRED', message: 'A recognized target account label is required.' });
        }
        if (!Number.isInteger(allocation.amountPaise) || allocation.amountPaise <= 0) {
          conflicts.push({ code: 'INVALID_ALLOCATION_AMOUNT', message: 'Every allocation must be positive integer paise.' });
        }
      }
      const allocatedAmountPaise = normalized.allocations.reduce(
        (total, allocation) => total + (Number.isInteger(allocation.amountPaise) ? allocation.amountPaise : 0),
        0,
      );
      if (allocatedAmountPaise !== source.amountPaise) {
        conflicts.push({
          code: 'MONEY_CONSERVATION_FAILED',
          sourceAmountPaise: source.amountPaise,
          allocatedAmountPaise,
          message: 'Allocations must equal the original receipt exactly.',
        });
      }
      const totals = activeTransactions.reduce((sum, transaction) => {
        if (transaction.type === DEPOSIT_TRANSACTION_TYPES.RECEIVED) sum.received += transaction.amountPaise;
        if (transaction.type === DEPOSIT_TRANSACTION_TYPES.REFUNDED) sum.refunded += transaction.amountPaise;
        if (transaction.type === DEPOSIT_TRANSACTION_TYPES.DEDUCTED) sum.deducted += transaction.amountPaise;
        return sum;
      }, { received: 0, refunded: 0, deducted: 0 });
      const heldPaise = totals.received - totals.refunded - totals.deducted;
      if (totals.refunded > 0 || totals.deducted > 0 || heldPaise < source.amountPaise) {
        conflicts.push({
          code: 'SOURCE_FUNDS_ALREADY_DISPOSED',
          sourceAmountPaise: source.amountPaise,
          heldPaise,
          message: 'The deposit ledger contains a refund or deduction, so this receipt cannot be safely isolated for reclassification.',
        });
      }
      const duplicate = await repository.findDuplicatePaymentReference({
        reference: source.reference,
        memberId: source.memberId,
        sourceDepositTransactionId: source.depositTransactionId,
      });
      if (duplicate) {
        conflicts.push({
          code: 'DUPLICATE_PAYMENT_REFERENCE',
          duplicate,
          message: 'The source reference already exists in another active ledger.',
        });
      }

      const stateFingerprint = createHash('sha256').update(JSON.stringify({
        requestFingerprint: normalized.requestFingerprint,
        source: {
          depositTransactionId: source.depositTransactionId,
          status: source.status,
          amountPaise: source.amountPaise,
          updatedAt: source.updatedAt || null,
        },
        account: { revision: account.revision, status: account.status, updatedAt: account.updatedAt || null },
        stay: {
          revision: stay.revision,
          financialRevision: stay.financialRevision || 0,
          clearanceReviewOpenedAt: stay.clearanceReviewOpenedAt || null,
        },
        activeTransactions: activeTransactions.map((transaction) => ({
          depositTransactionId: transaction.depositTransactionId,
          type: transaction.type,
          amountPaise: transaction.amountPaise,
          status: transaction.status,
          updatedAt: transaction.updatedAt || null,
        })),
      })).digest('hex');

      return {
        canApply: conflicts.length === 0,
        conflicts,
        sourceReceipt: source,
        allocations: normalized.allocations,
        moneyConservation: { sourceAmountPaise: source.amountPaise, allocatedAmountPaise },
        depositAccountTransition: account.expectedDepositPaise === 0
          && activeTransactions.length === 1
          ? { currentStatus: account.status, proposedStatus: DEPOSIT_ACCOUNT_STATUSES.NOT_REQUIRED }
          : null,
        affectedRecords: [
          { collection: 'hostel_deposit_transactions', documentId: source.depositTransactionId },
          { collection: 'hostel_deposit_accounts', documentId: account.depositAccountId, revision: account.revision },
          { collection: 'payment_reclassifications', documentId: 'NEW' },
          ...normalized.allocations.map((allocation, index) => ({
            collection: 'unallocated_credits',
            documentId: `NEW:${index + 1}`,
            amountPaise: allocation.amountPaise,
          })),
        ],
        previewToken: stateFingerprint,
        requestFingerprint: normalized.requestFingerprint,
      };
    },

    async reclassifyPayment({ previewToken, ...params }) {
      const normalized = normalizeReclassificationRequest(params);
      const existing = await repository.findPaymentReclassificationByIdempotencyKey(normalized.idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== normalized.requestFingerprint) {
          throw new DepositDomainError('Idempotency key was reused with a different payload.', 409);
        }
        return {
          reclassificationId: existing.reclassificationId,
          journal: existing,
          credits: [],
        };
      }
      if (!previewToken || typeof previewToken !== 'string') {
        throw new DepositDomainError('A current payment reclassification preview token is required.', 400);
      }
      const preview = await this.previewPaymentReclassification(params);
      if (preview.previewToken !== previewToken) {
        throw new DepositDomainError('Financial records changed after preview. Refresh and retry.', 409, {
          code: 'PAYMENT_RECLASSIFICATION_PREVIEW_STALE',
        });
      }
      if (!preview.canApply) {
        throw new DepositDomainError('Payment reclassification has unresolved conflicts.', 409, {
          code: 'PAYMENT_RECLASSIFICATION_CONFLICT',
          conflicts: preview.conflicts,
        });
      }
      try {
        return await repository.executeAtomicPaymentReclassification({
          stayId: normalized.stayId,
          sourceDepositTransactionId: normalized.sourceDepositTransactionId,
          expectedAccountRevision: normalized.expectedAccountRevision,
          allocations: normalized.allocations,
          reason: normalized.reason,
          idempotencyKey: normalized.idempotencyKey,
          requestFingerprint: normalized.requestFingerprint,
          actorRole: params.actorRole,
        });
      } catch (error) {
        throw new DepositDomainError(error.message, error.statusCode || 409, error.details || {});
      }
    },

    /**
     * Record a new deposit transaction with database-backed concurrency & balance guard
     */
    async recordTransaction({
      stayId,
      type,
      amountPaise,
      method = DEPOSIT_METHODS.UPI,
      reference = null,
      reason = null,
      idempotencyKey,
      actorRole,
    }) {
      if (!stayId) throw new DepositDomainError('Stay ID required.', 400);
      if (!Object.values(DEPOSIT_TRANSACTION_TYPES).includes(type)) {
        throw new DepositDomainError(`Invalid deposit transaction type: ${type}`, 400);
      }
      if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > MAX_DEPOSIT_PAISE) {
        throw new DepositDomainError('Deposit amount must be a positive integer in paise.', 400);
      }
      if (type === DEPOSIT_TRANSACTION_TYPES.DEDUCTED && (!reason || !reason.trim())) {
        throw new DepositDomainError('Reason is required when recording a deposit deduction.', 400);
      }
      if (!idempotencyKey || !idempotencyKey.trim()) {
        throw new DepositDomainError('Idempotency key required.', 400);
      }

      // 1. Idempotency check: if key already processed, return existing or verify identical payload
      const existing = await repository.findDepositTransactionByIdempotencyKey(idempotencyKey.trim());
      if (existing) {
        if (
          existing.type !== type ||
          existing.amountPaise !== amountPaise ||
          existing.stayId !== stayId
        ) {
          throw new DepositDomainError(
            'Idempotency key has already been used with a different transaction payload.',
            409,
          );
        }
        return existing;
      }

      // Check account exists
      const account = await repository.findDepositAccountByStayId(stayId);
      if (!account) {
        throw new DepositDomainError('Deposit account not found for this stay.', 404);
      }

      // 2. Database-backed atomic transaction execution
      if (typeof repository.executeAtomicDepositTransaction === 'function') {
        const transactionId = randomUUID();
        const txData = {
          depositTransactionId: transactionId,
          depositAccountId: account.depositAccountId,
          stayId,
          memberId: account.memberId,
          type,
          amountPaise,
          method,
          reference: reference?.trim() || null,
          reason: reason?.trim() || null,
          idempotencyKey: idempotencyKey.trim(),
          recordedAt: new Date(),
          recordedByRole: actorRole,
          status: 'recorded',
        };

        return repository.executeAtomicDepositTransaction({
          stayId,
          type,
          amountPaise,
          transactionData: txData,
          actorRole,
        });
      }

      throw new DepositDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
    },

    /**
     * Void a recorded deposit transaction (Super Admin only with audit reason)
     */
    async voidTransaction({ stayId, depositTransactionId, reason, actorRole }) {
      if (actorRole !== 'superadmin') {
        throw new DepositDomainError('Only Super Admin can void deposit transactions.', 403);
      }
      if (!reason || !reason.trim()) {
        throw new DepositDomainError('Void reason is required.', 400);
      }

      if (typeof repository.executeAtomicDepositVoid === 'function') {
        return repository.executeAtomicDepositVoid({
          stayId,
          depositTransactionId,
          reason: reason.trim(),
          actorRole,
        });
      }

      throw new DepositDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
    },

    async recordDepositReceipt(params) {
      return this.recordTransaction({
        ...params,
        type: DEPOSIT_TRANSACTION_TYPES.RECEIVED,
      });
    },

    async recordDepositRefund(params) {
      return this.recordTransaction({
        ...params,
        type: DEPOSIT_TRANSACTION_TYPES.REFUNDED,
      });
    },

    async recordDepositDeduction(params) {
      return this.recordTransaction({
        ...params,
        type: DEPOSIT_TRANSACTION_TYPES.DEDUCTED,
      });
    },

    async voidDepositTransaction({ stayId, transactionId, depositTransactionId, reason, actorRole }) {
      const id = transactionId || depositTransactionId;
      return this.voidTransaction({
        stayId,
        depositTransactionId: id,
        reason,
        actorRole,
      });
    },
  };
}

export const depositService = createDepositService();
