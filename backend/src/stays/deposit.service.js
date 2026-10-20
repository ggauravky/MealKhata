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

      // Fallback concurrency retry loop for balance check
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const { account: freshAccount, summary } = await this.getDepositSummary(stayId);
        if (!freshAccount) {
          throw new DepositDomainError('Deposit account not found for this stay.', 404);
        }

        // Balance protection: refunds and deductions cannot exceed currently held balance
        if (
          (type === DEPOSIT_TRANSACTION_TYPES.REFUNDED ||
            type === DEPOSIT_TRANSACTION_TYPES.DEDUCTED) &&
          summary.heldPaise < amountPaise
        ) {
          const action = type === DEPOSIT_TRANSACTION_TYPES.REFUNDED ? 'refund' : 'deduct';
          throw new DepositDomainError(
            `Cannot ${action} ₹${(amountPaise / 100).toFixed(2)}: only ₹${(summary.heldPaise / 100).toFixed(2)} currently held.`,
            400,
            { heldPaise: summary.heldPaise, requestedPaise: amountPaise },
          );
        }

        // Optimistic locking update on deposit account revision
        const updatedAccount = await repository.updateDepositAccount(
          freshAccount.depositAccountId,
          {},
          freshAccount.revision,
        );

        if (!updatedAccount) {
          // Collision: retry
          continue;
        }

        // Account acquired: create the transaction
        const transactionId = randomUUID();
        const transaction = await repository.createDepositTransaction({
          depositTransactionId: transactionId,
          depositAccountId: freshAccount.depositAccountId,
          stayId,
          memberId: freshAccount.memberId,
          type,
          amountPaise,
          method,
          reference: reference?.trim() || null,
          reason: reason?.trim() || null,
          idempotencyKey: idempotencyKey.trim(),
          recordedAt: new Date(),
          recordedByRole: actorRole,
          status: 'recorded',
        });

        // Audit entry
        await repository.addDepositAccountHistory(freshAccount.depositAccountId, {
          event: `DEPOSIT_${type}`,
          timestamp: new Date(),
          actorRole,
          note: `Recorded ${type} transaction of ${amountPaise} paise`,
          details: { depositTransactionId: transactionId, amountPaise, method },
        });

        // Update settled status if balance now 0 and stay is checked out
        const postSummary = await this.getDepositSummary(stayId);
        if (postSummary.summary.heldPaise === 0 && postSummary.summary.receivedPaise > 0) {
          await repository.updateDepositAccount(freshAccount.depositAccountId, {
            status: DEPOSIT_ACCOUNT_STATUSES.SETTLED,
          });
        }

        return transaction;
      }

      throw new DepositDomainError('Could not record deposit transaction due to concurrent modification. Please retry.', 409);
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

      const tx = await repository.findDepositTransactionById(depositTransactionId);
      if (!tx || (stayId && tx.stayId !== stayId)) {
        throw new DepositDomainError('Deposit transaction not found or does not belong to this stay.', 404);
      }
      const targetStayId = tx.stayId || stayId;

      if (tx.status === 'voided') {
        throw new DepositDomainError('Deposit transaction is already voided.', 400);
      }

      // If voiding a RECEIVED transaction, verify that reducing received funds does not make heldPaise negative
      if (tx.type === DEPOSIT_TRANSACTION_TYPES.RECEIVED) {
        const { summary } = await this.getDepositSummary(targetStayId);
        if (summary.heldPaise < tx.amountPaise) {
          throw new DepositDomainError(
            `Cannot void receipt: ₹${((tx.amountPaise - summary.heldPaise) / 100).toFixed(2)} has already been refunded or deducted.`,
            400,
          );
        }
      }

      const voided = await repository.voidDepositTransaction(depositTransactionId, {
        voidReason: reason.trim(),
        voidedByRole: actorRole,
        voidedAt: new Date(),
      });

      // Audit entry on deposit account using authoritative targetStayId
      const account = await repository.findDepositAccountByStayId(targetStayId);
      if (account) {
        await repository.addDepositAccountHistory(account.depositAccountId, {
          event: 'DEPOSIT_TRANSACTION_VOIDED',
          timestamp: new Date(),
          actorRole,
          note: `Voided transaction ${depositTransactionId}: ${reason}`,
          details: { depositTransactionId, originalType: tx.type, amountPaise: tx.amountPaise },
        });
      }

      return voided;
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
