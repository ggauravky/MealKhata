import { createHash } from 'node:crypto';
import { MEMBER_IDS } from '../config/members.js';
import { HttpError } from '../utils/HttpError.js';
import { isValidLogicalMonth } from '../utils/month.js';
import { financialOverviewService } from './financialOverview.service.js';
import { creditAllocationRepository } from './creditAllocation.repository.js';

const DESTINATIONS = Object.freeze([
  'ROOM_FEE',
  'MESS',
  'EXPENSE_REIMBURSEMENT',
  'EXTERNAL_SETTLEMENT',
]);

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeRequest(input) {
  const normalized = {
    creditId: typeof input.creditId === 'string' ? input.creditId.trim() : '',
    expectedRevision: input.expectedRevision,
    destinationType: typeof input.destinationType === 'string' ? input.destinationType.trim().toUpperCase() : '',
    targetRecordId: typeof input.targetRecordId === 'string' ? input.targetRecordId.trim() : '',
    amountPaise: input.amountPaise,
    reason: typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '',
    settlementReference: typeof input.settlementReference === 'string'
      ? input.settlementReference.trim().slice(0, 100)
      : '',
    settledAt: typeof input.settledAt === 'string' ? input.settledAt : null,
    idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '',
  };
  return { ...normalized, requestFingerprint: fingerprint(normalized) };
}

function validateRequest(request, actorRole) {
  if (actorRole !== 'superadmin') throw new HttpError(403, 'Only Super Admin can allocate unallocated credit.');
  if (!request.creditId) throw new HttpError(400, 'Valid creditId is required.');
  if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new HttpError(400, 'expectedRevision must be a non-negative integer.');
  }
  if (!DESTINATIONS.includes(request.destinationType)) {
    throw new HttpError(400, 'A supported credit destination is required.');
  }
  if (!request.targetRecordId) throw new HttpError(400, 'A verified target record is required.');
  if (!Number.isSafeInteger(request.amountPaise) || request.amountPaise <= 0) {
    throw new HttpError(400, 'Allocation amount must be positive integer paise.');
  }
  if (request.reason.length < 3) throw new HttpError(400, 'A mandatory audit reason is required.');
  if (!request.idempotencyKey) throw new HttpError(400, 'Idempotency key is required.');
  if (request.destinationType === 'MESS' && !isValidLogicalMonth(request.targetRecordId)) {
    throw new HttpError(400, 'Mess targetRecordId must be a valid YYYY-MM month.');
  }
  if (request.destinationType === 'EXTERNAL_SETTLEMENT') {
    if (!request.settlementReference || !request.settledAt || Number.isNaN(Date.parse(request.settledAt))) {
      throw new HttpError(400, 'External settlement requires a reference and valid settlement timestamp as evidence.');
    }
  }
}

export function createCreditAllocationService({
  repository = creditAllocationRepository,
  overview = financialOverviewService,
} = {}) {
  async function loadMessSnapshot(credit, request, actorRole) {
    if (request.destinationType !== 'MESS') return null;
    const data = await overview.getMemberFinancialOverview({
      memberId: credit.memberId,
      month: request.targetRecordId,
      actorRole,
    });
    return {
      memberId: credit.memberId,
      month: request.targetRecordId,
      billAmountPaise: data.mess.billPaise,
      paidAmountPaise: data.mess.paidPaise,
      outstandingAmountPaise: data.mess.remainingPaise,
      periodType: data.periodType,
      targetRevision: fingerprint({
        billAmountPaise: data.mess.billPaise,
        paidAmountPaise: data.mess.paidPaise,
        remainingAmountPaise: data.mess.remainingPaise,
        status: data.mess.status,
      }),
    };
  }

  return Object.freeze({
    async listCredits({ memberId = null, status = null, actorRole }) {
      if (actorRole !== 'superadmin') throw new HttpError(403, 'Only Super Admin can review unallocated credits.');
      if (memberId && !MEMBER_IDS.includes(memberId)) throw new HttpError(400, 'Invalid member ID.');
      const credits = await repository.listCredits({ memberId, status });
      return Promise.all(credits.map(async (credit) => ({
        ...credit,
        allocatedAmountPaise: credit.allocatedAmountPaise || 0,
        settledAmountPaise: credit.settledAmountPaise || 0,
        revision: credit.revision || 0,
        allocations: await repository.listAllocationsByCreditId(credit.creditId),
      })));
    },

    async previewAllocation(input) {
      const request = normalizeRequest(input);
      validateRequest(request, input.actorRole);
      const credit = await repository.findCreditById(request.creditId);
      if (!credit) throw new HttpError(404, 'Unallocated credit not found.');
      const conflicts = [];
      const revision = credit.revision || 0;
      if (revision !== request.expectedRevision) {
        conflicts.push({ code: 'CREDIT_REVISION_CONFLICT', message: 'Credit changed since it was loaded.' });
      }
      if (credit.status !== 'OPEN' || credit.remainingAmountPaise <= 0) {
        conflicts.push({ code: 'CREDIT_NOT_OPEN', message: 'Credit has no open balance to allocate.' });
      }
      if (request.amountPaise > credit.remainingAmountPaise) {
        conflicts.push({
          code: 'CREDIT_BALANCE_EXCEEDED',
          message: 'Allocation exceeds the remaining credit.',
          remainingAmountPaise: credit.remainingAmountPaise,
        });
      }

      const messSnapshot = await loadMessSnapshot(credit, request, input.actorRole);
      let target;
      try {
        target = await repository.getTargetSnapshot({
          destinationType: request.destinationType,
          targetRecordId: request.targetRecordId,
          memberId: credit.memberId,
          messSnapshot,
        });
      } catch (error) {
        conflicts.push({
          code: error.details?.code || 'TARGET_VALIDATION_FAILED',
          message: error.message,
        });
        target = messSnapshot || null;
      }
      if (target && request.destinationType !== 'EXTERNAL_SETTLEMENT'
        && request.amountPaise > target.outstandingAmountPaise) {
        conflicts.push({
          code: 'TARGET_AMOUNT_EXCEEDED',
          message: 'Allocation exceeds the verified target obligation.',
          targetOutstandingPaise: target.outstandingAmountPaise,
        });
      }

      const state = {
        requestFingerprint: request.requestFingerprint,
        credit: {
          creditId: credit.creditId,
          revision,
          status: credit.status,
          remainingAmountPaise: credit.remainingAmountPaise,
          updatedAt: credit.updatedAt || null,
        },
        target: target ? {
          destinationType: request.destinationType,
          targetRecordId: request.targetRecordId,
          billAmountPaise: target.billAmountPaise,
          paidAmountPaise: target.paidAmountPaise,
          outstandingAmountPaise: target.outstandingAmountPaise,
          targetRevision: target.targetRevision,
        } : null,
      };
      return {
        canApply: conflicts.length === 0,
        conflicts,
        credit: {
          creditId: credit.creditId,
          memberId: credit.memberId,
          originalAmountPaise: credit.amountPaise,
          allocatedAmountPaise: credit.allocatedAmountPaise || 0,
          settledAmountPaise: credit.settledAmountPaise || 0,
          remainingAmountPaise: credit.remainingAmountPaise,
          revision,
        },
        target: target ? {
          destinationType: request.destinationType,
          targetRecordId: request.targetRecordId,
          billAmountPaise: target.billAmountPaise,
          paidAmountPaise: target.paidAmountPaise,
          outstandingBeforePaise: target.outstandingAmountPaise,
          outstandingAfterPaise: target.outstandingAmountPaise === null
            ? null
            : Math.max(0, target.outstandingAmountPaise - request.amountPaise),
        } : null,
        allocationAmountPaise: request.amountPaise,
        creditRemainingBeforePaise: credit.remainingAmountPaise,
        creditRemainingAfterPaise: Math.max(0, credit.remainingAmountPaise - request.amountPaise),
        cashReceiptCountBefore: 1,
        cashReceiptCountAfter: 1,
        messSnapshot,
        requestFingerprint: request.requestFingerprint,
        previewToken: fingerprint(state),
      };
    },

    async allocate({ previewToken, ...input }) {
      const request = normalizeRequest(input);
      validateRequest(request, input.actorRole);
      const existing = await repository.findAllocationByIdempotencyKey(request.idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== request.requestFingerprint) {
          throw new HttpError(409, 'Idempotency key was reused with a different allocation payload.');
        }
        return { allocation: existing, credit: await repository.findCreditById(existing.creditId) };
      }
      if (!previewToken) throw new HttpError(400, 'A current allocation preview token is required.');
      const preview = await this.previewAllocation(input);
      if (preview.previewToken !== previewToken) {
        const error = new HttpError(409, 'Credit or target obligation changed after preview. Refresh and retry.');
        error.details = { code: 'CREDIT_ALLOCATION_PREVIEW_STALE' };
        throw error;
      }
      if (!preview.canApply) {
        const error = new HttpError(409, 'Credit allocation has unresolved conflicts.');
        error.details = { code: 'CREDIT_ALLOCATION_CONFLICT', conflicts: preview.conflicts };
        throw error;
      }
      return repository.executeAtomicAllocation({
        ...request,
        actorRole: input.actorRole,
        settledAt: request.settledAt ? new Date(request.settledAt) : null,
        messSnapshot: preview.messSnapshot,
      });
    },
  });
}

export const creditAllocationService = createCreditAllocationService();
