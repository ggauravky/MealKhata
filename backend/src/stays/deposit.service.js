/**
 * MealKhata 2.0 - Security Deposit Domain Service
 * Manages refundable deposit accounts, receipts, refunds, and damage deductions.
 */

import { randomUUID } from 'node:crypto';
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
  return {
    /**
     * Compute current authoritative deposit balance for a stay
     */
    async getDepositSummary(stayId) {
      const account = await repository.findDepositAccountByStayId(stayId);
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
          transactions: [],
        };
      }

      const transactions = await repository.listDepositTransactionsByStayId(stayId, {
        includeVoided: false,
      });

      let receivedPaise = 0;
      let refundedPaise = 0;
      let deductedPaise = 0;

      for (const tx of transactions) {
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
