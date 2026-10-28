/**
 * MealKhata 2.0 - Hostel Stay Lifecycle Domain Service
 * Manages admission, active stays, room history & transfers, checkout review, and final clearance.
 */

import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MEMBER_IDS } from '../config/members.js';
import { canEditDate, isValidLogicalDate, getLogicalDateInTimeZone, getPreviousLogicalDate } from '../utils/date.js';
import { ROLES } from '../auth/permissions.js';
import { isValidLogicalMonth, lastDateOfMonth } from '../utils/month.js';
import { roomFeeService } from '../roomFees/roomFee.service.js';
import { financialOverviewService } from '../finance/financialOverview.service.js';
import { depositService } from './deposit.service.js';
import { stayRepository } from './stay.repository.js';
import { createStayAttributionService, defaultStayAttributionService } from './stayAttribution.service.js';
import { guardCheckoutFinancialSnapshot } from '../finance/financialMutationGuard.js';
import {
  CLEARANCE_STATUSES,
  DEPOSIT_ACCOUNT_STATUSES,
  DEPOSIT_HOLDER_TYPES,
  MAX_DEPOSIT_PAISE,
  STAY_STATUSES,
} from './stay.constants.js';

function getMonthsRange(startMonth, endMonth) {
  const months = [];
  let current = startMonth;
  while (current <= endMonth) {
    months.push(current);
    const [yStr, mStr] = current.split('-');
    let y = parseInt(yStr, 10);
    let m = parseInt(mStr, 10);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    current = `${y}-${String(m).padStart(2, '0')}`;
  }
  return months;
}

export class StayDomainError extends Error {
  constructor(message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'StayDomainError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function createStayService({
  repository = stayRepository,
  roomFees = roomFeeService,
  finance = financialOverviewService,
  deposits = depositService,
  stayAttribution = null,
  now = () => new Date(),
  enforceHistoricalPolicy = process.env.NODE_ENV !== 'test',
  requiresTransactions = repository.requiresTransactions ?? (repository === stayRepository),
  startSession = () => mongoose.startSession(),
  isDatabaseReady = () => mongoose.connection?.readyState === 1,
} = {}) {
  const attributionService =
    stayAttribution ||
    createStayAttributionService({
      stayRepo: repository,
      finance,
      deposits,
      roomFees,
    });

  const startLifecycleTransaction = async () => {
    if (!requiresTransactions) return null;

    if (!isDatabaseReady()) {
      throw new StayDomainError(
        'Database transaction support is required. No records were changed.',
        503,
        { code: 'TRANSACTION_REQUIRED' },
      );
    }

    let session = null;
    try {
      session = await startSession();
      session.startTransaction();
      return session;
    } catch (_error) {
      if (session) await session.endSession();
      throw new StayDomainError(
        'Database transaction support is required. No records were changed.',
        503,
        { code: 'TRANSACTION_REQUIRED' },
      );
    }
  };

  const buildRestorePreview = async ({
    stayId,
    joinedOn,
    occupancyFromDate,
    roomId,
    assignmentAction,
    assignmentId = null,
    expectedRevision,
    reason,
    actorRole,
  }, { session = null } = {}) => {
    if (actorRole !== ROLES.SUPERADMIN) {
      throw new StayDomainError('Only Super Admin can restore an incorrectly checked-out resident.', 403);
    }
    if (!isValidLogicalDate(joinedOn) || !isValidLogicalDate(occupancyFromDate)) {
      throw new StayDomainError('Valid joining and continuous occupancy dates are required.', 400);
    }
    const currentDate = getLogicalDateInTimeZone(now());
    if (joinedOn > currentDate || occupancyFromDate > currentDate) {
      throw new StayDomainError('Joining and continuous occupancy dates cannot be in the future.', 400);
    }
    if (occupancyFromDate < joinedOn) {
      throw new StayDomainError('Continuous occupancy date cannot precede the joining date.', 400);
    }
    if (!roomId || !roomId.trim()) throw new StayDomainError('Room is required.', 400);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new StayDomainError('expectedRevision must be a non-negative integer.', 400);
    }
    const normalizedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    if (normalizedReason.length < 3) throw new StayDomainError('A restoration reason is required.', 400);

    const stay = await repository.findStayById(stayId, { session });
    if (!stay) throw new StayDomainError('Hostel stay not found.', 404);
    if (stay.status !== STAY_STATUSES.CHECKED_OUT) {
      throw new StayDomainError('Only a checked-out Stay can be restored.', 409);
    }

    // Mongoose does not support parallel operations on one transaction session.
    // Keep these reads sequential so apply-time preview validation is deterministic.
    const activeStay = await repository.findActiveStayForMember(stay.memberId, { session });
    const clearances = await repository.findClearancesByStayId(stayId, { session });
    const depositAccount = await repository.findDepositAccountByStayId(stayId, { session });
    const depositTransactions = await repository.listDepositTransactionsByStayId(
      stayId,
      { includeVoided: false, session },
    );
    const assignmentPreview = await roomFees.previewRestoreAssignment({
      memberId: stay.memberId,
      roomId: roomId.trim(),
      occupancyFromDate,
      assignmentAction,
      assignmentId,
      session,
    });

    const conflicts = [...assignmentPreview.conflicts];
    if (stay.revision !== expectedRevision) {
      conflicts.push({ code: 'STAY_REVISION_CONFLICT', message: 'Stay changed since it was loaded.' });
    }
    if (activeStay && activeStay.stayId !== stayId) {
      conflicts.push({
        code: 'ACTIVE_STAY_EXISTS',
        stayId: activeStay.stayId,
        message: 'Another active or pending Stay already exists for this resident.',
      });
    }

    const activeClearances = clearances.filter((clearance) => !clearance.validityStatus || clearance.validityStatus === 'ACTIVE');
    const depositLedger = depositTransactions.reduce((totals, transaction) => {
      if (transaction.type === 'RECEIVED') totals.receivedPaise += transaction.amountPaise;
      if (transaction.type === 'REFUNDED') totals.refundedPaise += transaction.amountPaise;
      if (transaction.type === 'DEDUCTED') totals.deductedPaise += transaction.amountPaise;
      return totals;
    }, { receivedPaise: 0, refundedPaise: 0, deductedPaise: 0 });
    const depositSummary = depositAccount
      ? {
        accountStatus: depositAccount.status,
        expectedDepositPaise: depositAccount.expectedDepositPaise,
        ...depositLedger,
        heldPaise: depositLedger.receivedPaise - depositLedger.refundedPaise - depositLedger.deductedPaise,
        transactionCount: depositTransactions.length,
      }
      : null;
    const warnings = [];
    if (depositTransactions.length > 0) {
      warnings.push({
        code: 'DEPOSIT_LEDGER_PRESERVED',
        message: 'Recorded deposit transactions will be preserved and are not changed by resident restoration.',
      });
    }
    if (depositAccount?.expectedDepositPaise === 0 && depositLedger.receivedPaise > 0) {
      warnings.push({
        code: 'DEPOSIT_EXPECTATION_MISMATCH',
        message: 'This Stay expects no deposit but has recorded receipts. Reconcile the deposit ledger separately; restoration will not rewrite it.',
      });
    }
    const changes = [
      {
        collection: 'hostel_stays',
        documentId: stay.stayId,
        revision: stay.revision,
        current: { status: stay.status, joinedOn: stay.joinedOn, actualLeftOn: stay.actualLeftOn },
        proposed: { status: STAY_STATUSES.ACTIVE, joinedOn, actualLeftOn: null, currentRoomId: assignmentPreview.room.roomId },
        reason: normalizedReason,
      },
    ];
    if (assignmentAction !== 'LINK_EXISTING') {
      changes.push({
        collection: 'room_assignments',
        documentId: assignmentPreview.currentAssignment?.assignmentId || 'NEW',
        revision: assignmentPreview.currentAssignment?.updatedAt || null,
        current: assignmentPreview.currentAssignment,
        proposed: assignmentPreview.proposedAssignment,
        reason: normalizedReason,
      });
    }
    for (const clearance of activeClearances) {
      changes.push({
        collection: 'hostel_clearances',
        documentId: clearance.clearanceId,
        revision: clearance.updatedAt || clearance.createdAt || null,
        current: { validityStatus: clearance.validityStatus || 'ACTIVE', clearanceStatus: clearance.clearanceStatus },
        proposed: { validityStatus: 'REVOKED' },
        reason: normalizedReason,
      });
    }

    const fingerprint = {
      request: {
        stayId,
        joinedOn,
        occupancyFromDate,
        roomId: assignmentPreview.room.roomId,
        assignmentAction,
        assignmentId,
        expectedRevision,
        reason: normalizedReason,
      },
      stay: {
        revision: stay.revision,
        financialRevision: stay.financialRevision || 0,
        status: stay.status,
        joinedOn: stay.joinedOn,
        actualLeftOn: stay.actualLeftOn,
        updatedAt: stay.updatedAt || null,
      },
      activeStayId: activeStay?.stayId || null,
      assignment: assignmentPreview.currentAssignment
        ? {
          assignmentId: assignmentPreview.currentAssignment.assignmentId,
          effectiveFromDate: assignmentPreview.currentAssignment.effectiveFromDate,
          effectiveUntilDate: assignmentPreview.currentAssignment.effectiveUntilDate,
          updatedAt: assignmentPreview.currentAssignment.updatedAt || null,
        }
        : null,
      deposit: depositAccount
        ? {
          depositAccountId: depositAccount.depositAccountId,
          revision: depositAccount.revision,
          status: depositAccount.status,
          expectedDepositPaise: depositAccount.expectedDepositPaise,
          transactions: [...depositTransactions]
            .sort((left, right) => left.depositTransactionId.localeCompare(right.depositTransactionId))
            .map((transaction) => ({
            depositTransactionId: transaction.depositTransactionId,
            type: transaction.type,
            amountPaise: transaction.amountPaise,
            status: transaction.status,
            updatedAt: transaction.updatedAt || transaction.createdAt || null,
            })),
        }
        : null,
      clearances: activeClearances.map((clearance) => ({
        clearanceId: clearance.clearanceId,
        validityStatus: clearance.validityStatus || 'ACTIVE',
        updatedAt: clearance.updatedAt || clearance.createdAt || null,
      })),
    };

    return {
      stayId,
      memberId: stay.memberId,
      expectedFinancialRevision: stay.financialRevision || 0,
      canApply: conflicts.length === 0,
      conflicts,
      warnings,
      changes,
      preservedFinancialRecords: {
        depositTransactionCount: depositTransactions.length,
        deposit: depositSummary,
        clearanceSnapshotCount: clearances.length,
      },
      previewToken: createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex'),
    };
  };

  const buildRoomAssignmentRepairPreview = async ({
    stayId,
    roomId,
    occupancyFromDate = null,
    assignmentAction,
    assignmentId = null,
    correctionMode = 'ASSIGNMENT_ONLY',
    expectedRevision,
    reason,
    actorRole,
  }, { session = null } = {}) => {
    if (actorRole !== ROLES.SUPERADMIN) {
      throw new StayDomainError('Only Super Admin can repair a Room Assignment.', 403);
    }
    if (!['ASSIGNMENT_ONLY', 'CORRECT_STAY_ROOM_REFERENCE'].includes(correctionMode)) {
      throw new StayDomainError('A valid room repair correctionMode is required.', 400);
    }
    if (!roomId || !roomId.trim()) throw new StayDomainError('Room is required.', 400);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new StayDomainError('expectedRevision must be a non-negative integer.', 400);
    }
    const normalizedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    if (normalizedReason.length < 3) throw new StayDomainError('A repair reason is required.', 400);
    const currentDate = getLogicalDateInTimeZone(now());
    if (occupancyFromDate && !isValidLogicalDate(occupancyFromDate)) {
      throw new StayDomainError('occupancyFromDate must be a valid YYYY-MM-DD date.', 400);
    }
    if (assignmentAction === 'CREATE_NEW_ASSIGNMENT' && !occupancyFromDate) {
      throw new StayDomainError('occupancyFromDate is required when creating an assignment.', 400);
    }
    if (occupancyFromDate && occupancyFromDate > currentDate) {
      throw new StayDomainError('occupancyFromDate cannot be in the future.', 400);
    }

    const stay = await repository.findStayById(stayId, { session });
    if (!stay) throw new StayDomainError('Hostel stay not found.', 404);
    if (stay.status !== STAY_STATUSES.ACTIVE) {
      throw new StayDomainError('Only an active Stay can have its Room Assignment repaired.', 409);
    }

    const assignmentPreview = await roomFees.previewActiveStayAssignmentRepair({
      memberId: stay.memberId,
      roomId: roomId.trim(),
      occupancyFromDate: occupancyFromDate || currentDate,
      assignmentAction,
      assignmentId,
      session,
    });
    const conflicts = [...assignmentPreview.conflicts];
    if (stay.revision !== expectedRevision) {
      conflicts.push({ code: 'STAY_REVISION_CONFLICT', message: 'Stay changed since it was loaded.' });
    }
    if (stay.currentRoomId !== assignmentPreview.room.roomId && correctionMode !== 'CORRECT_STAY_ROOM_REFERENCE') {
      conflicts.push({
        code: 'STAY_ROOM_MISMATCH',
        stayRoomId: stay.currentRoomId,
        requestedRoomId: assignmentPreview.room.roomId,
        message: 'The repair room does not match the active Stay current room.',
      });
    }
    const targetMonth = (occupancyFromDate || currentDate).slice(0, 7);
    const roomFinancialOverview = await roomFees.getMemberOverview({
      memberId: stay.memberId,
      targetMonth,
    });

    const fingerprint = {
      request: {
        stayId,
        roomId: assignmentPreview.room.roomId,
        occupancyFromDate: occupancyFromDate || null,
        assignmentAction,
        assignmentId,
        correctionMode,
        expectedRevision,
        reason: normalizedReason,
      },
      stay: {
        revision: stay.revision,
        financialRevision: stay.financialRevision || 0,
        status: stay.status,
        joinedOn: stay.joinedOn,
        currentRoomId: stay.currentRoomId,
        currentAssignmentId: stay.currentAssignmentId || null,
        updatedAt: stay.updatedAt || null,
      },
      room: {
        roomId: assignmentPreview.room.roomId,
        capacity: assignmentPreview.room.capacity,
        occupancyRevision: assignmentPreview.room.occupancyRevision || 0,
        updatedAt: assignmentPreview.room.updatedAt || null,
      },
      assignment: assignmentPreview.currentAssignment
        ? {
          assignmentId: assignmentPreview.currentAssignment.assignmentId,
          effectiveFromDate: assignmentPreview.currentAssignment.effectiveFromDate,
          effectiveFromMonth: assignmentPreview.currentAssignment.effectiveFromMonth,
          effectiveUntilDate: assignmentPreview.currentAssignment.effectiveUntilDate,
          effectiveUntilMonth: assignmentPreview.currentAssignment.effectiveUntilMonth,
          updatedAt: assignmentPreview.currentAssignment.updatedAt || null,
        }
        : null,
    };

    return {
      stayId,
      memberId: stay.memberId,
      canApply: conflicts.length === 0,
      conflicts,
      affectedRecords: [
        { collection: 'hostel_stays', documentId: stay.stayId, revision: stay.revision },
        {
          collection: 'room_assignments',
          documentId: assignmentPreview.currentAssignment?.assignmentId || 'NEW',
          revision: assignmentPreview.currentAssignment?.updatedAt || null,
        },
      ],
      currentAssignment: assignmentPreview.currentAssignment,
      proposedAssignment: assignmentPreview.proposedAssignment,
      currentRoom: {
        roomId: stay.currentRoomId,
      },
      proposedRoom: {
        roomId: assignmentPreview.room.roomId,
        roomNumber: assignmentPreview.room.roomNumber,
      },
      correctionMode,
      capacityValidation: {
        valid: !assignmentPreview.conflicts.some((conflict) => conflict.code === 'ROOM_CAPACITY_EXCEEDED'),
        roomCapacity: assignmentPreview.room.capacity,
      },
      overlappingAssignments: assignmentPreview.conflicts.filter(
        (conflict) => conflict.code?.includes('ASSIGNMENT') || conflict.code?.includes('OVERLAP'),
      ),
      financialRecordsPreserved: {
        policy: 'Issued Room Charges and Room Payments are not modified by this reference correction.',
        chargeId: roomFinancialOverview.currentMonthCharge?.chargeId || null,
        chargeAmountPaise: roomFinancialOverview.currentMonthCharge?.finalBillAmountPaise || 0,
        paidAmountPaise: roomFinancialOverview.currentMonthCharge?.paidAmountPaise || 0,
      },
      previewToken: createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex'),
    };
  };

  const buildHistoricalStayReconciliationPreview = async ({
    stayId,
    supersededByStayId,
    expectedRevision,
    reason,
    confirmFinancialAttribution = false,
    actorRole,
  }, { session = null } = {}) => {
    if (actorRole !== ROLES.SUPERADMIN) {
      throw new StayDomainError('Only Super Admin can reconcile a historical Stay.', 403);
    }
    if (!supersededByStayId || supersededByStayId === stayId) {
      throw new StayDomainError('A different active replacement Stay is required.', 400);
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new StayDomainError('expectedRevision must be a non-negative integer.', 400);
    }
    const normalizedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    if (normalizedReason.length < 3) throw new StayDomainError('A reconciliation reason is required.', 400);

    const stay = await repository.findStayById(stayId, { session });
    const replacement = await repository.findStayById(supersededByStayId, { session });
    if (!stay) throw new StayDomainError('Historical Stay not found.', 404);
    if (!replacement) throw new StayDomainError('Replacement Stay not found.', 404);
    if (stay.status !== STAY_STATUSES.CHECKED_OUT) {
      throw new StayDomainError('Only a checked-out Stay can be historically reconciled.', 409);
    }

    const clearances = await repository.findClearancesByStayId(stayId, { session });
    const account = await repository.findDepositAccountByStayId(stayId, { session });
    const transactions = await repository.listDepositTransactionsByStayId(stayId, {
      includeVoided: false,
      session,
    });
    const finances = await attributionService.getStayAttributedFinances({ stayId, session, actorRole });
    const conflicts = [];
    if (stay.revision !== expectedRevision) {
      conflicts.push({ code: 'STAY_REVISION_CONFLICT', message: 'Stay changed since it was loaded.' });
    }
    if (replacement.memberId !== stay.memberId || replacement.status !== STAY_STATUSES.ACTIVE) {
      conflicts.push({
        code: 'INVALID_REPLACEMENT_STAY',
        message: 'The replacement must be the same resident\'s active Stay.',
      });
    }
    if (replacement.joinedOn > (stay.actualLeftOn || '9999-12-31')) {
      conflicts.push({
        code: 'NON_OVERLAPPING_REPLACEMENT_STAY',
        message: 'The replacement Stay does not overlap the historical checkout period.',
      });
    }

    const heldPaise = finances.depositOverview?.summary?.heldPaise || 0;
    if (heldPaise !== 0) {
      conflicts.push({
        code: 'DEPOSIT_BALANCE_REMAINS',
        amountPaise: heldPaise,
        message: 'The historical Stay still holds deposit money that must be reconciled first.',
      });
    }
    if ((finances.totalOutstandingPayablePaise || 0) !== 0) {
      conflicts.push({
        code: 'FINANCIAL_OBLIGATIONS_REMAIN',
        amountPaise: finances.totalOutstandingPayablePaise,
        message: 'The historical Stay still has unresolved payable obligations.',
      });
    }
    if ((finances.attributionWarnings || []).length > 0 && !confirmFinancialAttribution) {
      conflicts.push({
        code: 'FINANCIAL_ATTRIBUTION_REVIEW_REQUIRED',
        warnings: finances.attributionWarnings,
        message: 'Overlapping monthly records require explicit Super Admin attribution confirmation.',
      });
    }

    const activeClearances = clearances.filter(
      (clearance) => !clearance.validityStatus || clearance.validityStatus === 'ACTIVE',
    );
    const affectedFinancialDomains = [
      finances.totalMessBilledPaise || finances.totalMessPaidPaise ? 'MESS' : null,
      finances.totalRoomBilledPaise || finances.totalRoomPaidPaise ? 'ROOM_FEES' : null,
      finances.totalExpenseSharePaise || finances.totalExpenseOwedPaise || finances.totalExpenseReceivablePaise
        ? 'OTHER_EXPENSES'
        : null,
      (transactions || []).length > 0 ? 'SECURITY_DEPOSIT' : null,
      finances.unallocatedCreditPaise > 0 ? 'UNALLOCATED_CREDIT' : null,
    ].filter(Boolean);
    const beforeState = {
      historicalStay: { status: stay.status, revision: stay.revision },
      replacementStay: { status: replacement.status, revision: replacement.revision },
      activeClearanceIds: activeClearances.map((clearance) => clearance.clearanceId),
    };
    const afterState = {
      historicalStay: { status: STAY_STATUSES.SUPERSEDED, supersededByStayId },
      replacementStay: { status: replacement.status },
      clearanceValidityStatus: activeClearances.length > 0 ? 'REVOKED' : 'UNCHANGED',
      attributionStatus: (finances.attributionWarnings || []).length > 0
        ? 'AMBIGUOUS_REVIEWED'
        : 'ATTRIBUTED_BY_EVIDENCE',
    };
    const fingerprint = {
      request: {
        stayId,
        supersededByStayId,
        expectedRevision,
        reason: normalizedReason,
        confirmFinancialAttribution,
      },
      stay: { revision: stay.revision, status: stay.status, updatedAt: stay.updatedAt || null },
      replacement: {
        stayId: replacement.stayId,
        revision: replacement.revision,
        status: replacement.status,
        updatedAt: replacement.updatedAt || null,
      },
      account: account
        ? { depositAccountId: account.depositAccountId, revision: account.revision, status: account.status }
        : null,
      transactions: transactions.map((transaction) => ({
        depositTransactionId: transaction.depositTransactionId,
        status: transaction.status,
        amountPaise: transaction.amountPaise,
        updatedAt: transaction.updatedAt || null,
      })),
      clearances: activeClearances.map((clearance) => ({
        clearanceId: clearance.clearanceId,
        validityStatus: clearance.validityStatus || 'ACTIVE',
        updatedAt: clearance.updatedAt || null,
      })),
    };

    return {
      stayId,
      memberId: stay.memberId,
      supersededByStayId,
      canApply: conflicts.length === 0,
      conflicts,
      warnings: finances.attributionWarnings || [],
      confirmationProvided: Boolean(confirmFinancialAttribution),
      affectedMonths: finances.months || [],
      attributionWarnings: finances.attributionWarnings || [],
      affectedFinancialDomains,
      beforeState,
      afterState,
      obligationMappings: (finances.outstandingObligations || []).map((obligation) => ({
        domain: obligation.domain,
        month: obligation.month || null,
        amountPaise: obligation.amountPaise,
        stayId: (finances.attributionWarnings || []).some(
          (warning) => warning.domain === obligation.domain && warning.month === obligation.month,
        ) ? null : stayId,
        attributionStatus: (finances.attributionWarnings || []).some(
          (warning) => warning.domain === obligation.domain && warning.month === obligation.month,
        ) ? 'AMBIGUOUS' : 'SUPPORTED',
      })),
      affectedRecords: [
        { collection: 'hostel_stays', documentId: stayId, revision: stay.revision },
        { collection: 'hostel_stays', documentId: supersededByStayId, revision: replacement.revision },
        ...activeClearances.map((clearance) => ({
          collection: 'hostel_clearances',
          documentId: clearance.clearanceId,
          revision: clearance.updatedAt || clearance.createdAt || null,
        })),
      ],
      preservedFinancialRecords: {
        depositAccountId: account?.depositAccountId || null,
        depositTransactionIds: transactions.map((transaction) => transaction.depositTransactionId),
        clearanceIds: clearances.map((clearance) => clearance.clearanceId),
      },
      expectedReplacementRevision: replacement.revision,
      previewToken: createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex'),
    };
  };

  return {
    /**
     * Create a new hostel stay (admission / onboarding)
     */
    async createStay({
      memberId,
      joinedOn,
      expectedLeaveOn = null,
      initialRoomId,
      monthlyFeePaise: rawMonthlyFee = null,
      monthlyRatePaise = null,
      expectedDepositPaise = 0,
      actorRole,
      actorMemberId = null,
      historicalReason = null,
      admissionMode = 'new_assignment',
      assignmentId = null,
      allowUnverifiedPreAssignmentPeriod = false,
    }) {
      const monthlyFeePaise = rawMonthlyFee ?? monthlyRatePaise ?? null;
      if (!MEMBER_IDS.includes(memberId)) {
        throw new StayDomainError(`Invalid member ID: ${memberId}`, 400);
      }
      if (!joinedOn || !isValidLogicalDate(joinedOn)) {
        throw new StayDomainError('Valid joining date in YYYY-MM-DD format is required.', 400);
      }
      if (expectedLeaveOn && !isValidLogicalDate(expectedLeaveOn)) {
        throw new StayDomainError('Expected leave date must be in YYYY-MM-DD format.', 400);
      }
      if (expectedLeaveOn && expectedLeaveOn < joinedOn) {
        throw new StayDomainError('Expected leave date cannot be earlier than joining date.', 400);
      }
      if (!initialRoomId || !initialRoomId.trim()) {
        throw new StayDomainError('Initial room is required.', 400);
      }
      if (!['new_assignment', 'link_existing_assignment'].includes(admissionMode)) {
        throw new StayDomainError('Admission mode must create a new assignment or link an existing assignment.', 400);
      }
      if (admissionMode === 'link_existing_assignment' && !assignmentId) {
        throw new StayDomainError('An existing room assignment must be selected for linking.', 400);
      }
      if (
        expectedDepositPaise !== undefined &&
        expectedDepositPaise !== null &&
        (!Number.isInteger(expectedDepositPaise) || expectedDepositPaise < 0 || expectedDepositPaise > MAX_DEPOSIT_PAISE)
      ) {
        throw new StayDomainError('Invalid expected security deposit amount.', 400);
      }
      if (monthlyFeePaise !== null && monthlyFeePaise !== undefined) {
        if (!Number.isInteger(monthlyFeePaise) || monthlyFeePaise <= 0) {
          throw new StayDomainError('Monthly fee must be a positive integer in paise.', 400);
        }
      }

      const today = getLogicalDateInTimeZone(now(), 'Asia/Kolkata');
      if (enforceHistoricalPolicy && !canEditDate({ role: actorRole, targetDate: joinedOn, now: now(), timeZone: 'Asia/Kolkata' })) {
        throw new StayDomainError('Only Super Admin can register a historical or future admission.', 403);
      }
      const isHistoricalAdmission = joinedOn < today;
      const normalizedHistoricalReason = typeof historicalReason === 'string'
        ? historicalReason.trim().slice(0, 500)
        : '';
      if (enforceHistoricalPolicy && isHistoricalAdmission && actorRole === ROLES.SUPERADMIN && !normalizedHistoricalReason) {
        throw new StayDomainError('A reason is required for historical admission.', 400);
      }

      // Invariant: At most ONE active or pending stay per member!
      const activeStay = await repository.findActiveStayForMember(memberId);
      if (activeStay) {
        throw new StayDomainError(
          `Member ${memberId} already has an active or pending hostel stay (${activeStay.stayId}).`,
          409,
          { activeStayId: activeStay.stayId },
        );
      }

      const joinMonth = joinedOn.slice(0, 7);
      const stayId = randomUUID();
      const depositAccountId = randomUUID();

      let createdAssignment = null;
      let admissionAssignment = null;
      let admissionAssignmentOwned = false;
      let createdStay = null;
      let createdDepositAccount = null;
      let createdFeePlan = null;
      let admissionFeePlan = null;
      let admissionFeePlanOwned = false;
      let unverifiedOccupancyUntil = null;
      const session = await startLifecycleTransaction();

      try {
        if (admissionMode === 'link_existing_assignment') {
          if (!roomFees || typeof roomFees.getAssignmentById !== 'function') {
            throw new StayDomainError('Existing Room Assignment linking is unavailable.', 503);
          }
          admissionAssignment = await roomFees.getAssignmentById(assignmentId);
          if (!admissionAssignment) {
            throw new StayDomainError('The selected Room Assignment does not exist or is no longer active.', 409, {
              code: 'ASSIGNMENT_NOT_AVAILABLE',
              assignmentId,
            });
          }
          if (admissionAssignment.memberId !== memberId || admissionAssignment.roomId !== initialRoomId.trim()) {
            throw new StayDomainError('The selected Room Assignment does not match this member and room.', 409, {
              code: 'ASSIGNMENT_MISMATCH',
              assignment: admissionAssignment,
            });
          }

          const assignmentStart = admissionAssignment.effectiveFromDate
            || `${admissionAssignment.effectiveFromMonth}-01`;
          const assignmentEnd = admissionAssignment.effectiveUntilDate
            || (admissionAssignment.effectiveUntilMonth ? lastDateOfMonth(admissionAssignment.effectiveUntilMonth) : null);
          if (assignmentEnd && joinedOn > assignmentEnd) {
            throw new StayDomainError('The selected Room Assignment ended before the requested joining date.', 409, {
              code: 'ASSIGNMENT_ENDED_BEFORE_STAY',
              assignment: admissionAssignment,
            });
          }
          if (joinedOn < assignmentStart) {
            if (
              actorRole !== ROLES.SUPERADMIN
              || allowUnverifiedPreAssignmentPeriod !== true
              || normalizedHistoricalReason.length < 3
            ) {
              throw new StayDomainError(
                `The selected Room Assignment begins on ${assignmentStart}, after the requested Stay date ${joinedOn}. Confirm the earlier occupancy as unverified or use the audited correction workflow.`,
                409,
                {
                  code: 'ASSIGNMENT_STARTS_AFTER_STAY',
                  assignment: admissionAssignment,
                  requestedJoinedOn: joinedOn,
                  requiresSuperAdminAcknowledgement: true,
                },
              );
            }
            unverifiedOccupancyUntil = getPreviousLogicalDate(assignmentStart);
          }
        } else if (roomFees && typeof roomFees.assignMemberToRoom === 'function') {
          createdAssignment = await roomFees.assignMemberToRoom({
            roomId: initialRoomId.trim(),
            memberId,
            effectiveFromMonth: joinMonth,
            effectiveFromDate: joinedOn,
            actorRole,
            isAdmission: true,
            session,
          });
          admissionAssignment = createdAssignment;
          admissionAssignmentOwned = true;
        }

        if (admissionMode === 'link_existing_assignment' && typeof roomFees?.getActiveFeePlan === 'function') {
          const planMonth = (admissionAssignment.effectiveFromDate || joinedOn).slice(0, 7);
          admissionFeePlan = await roomFees.getActiveFeePlan(memberId, planMonth);
          if (admissionFeePlan && monthlyFeePaise && admissionFeePlan.amountPaise !== monthlyFeePaise) {
            throw new StayDomainError(
              'The requested monthly fee conflicts with the member\'s existing Fee Plan. Reuse it or correct the plan separately.',
              409,
              { code: 'FEE_PLAN_CONFLICT', feePlan: admissionFeePlan },
            );
          }
        }

        if (!admissionFeePlan && monthlyFeePaise && roomFees && typeof roomFees.createFeePlan === 'function') {
          createdFeePlan = await roomFees.createFeePlan({
            memberId,
            effectiveFromMonth: joinMonth,
            amountPaise: monthlyFeePaise,
            reason: `Initial fee plan on admission in Room ${initialRoomId}`,
            actorRole,
            isAdmission: true,
            session,
          });
          admissionFeePlan = createdFeePlan;
          admissionFeePlanOwned = true;
        }

        createdStay = await repository.createStay({
          stayId,
          memberId,
          joinedOn,
          expectedLeaveOn: expectedLeaveOn || null,
          actualLeftOn: null,
          status: STAY_STATUSES.ACTIVE,
          initialRoomId: initialRoomId.trim(),
          currentRoomId: initialRoomId.trim(),
          admissionAssignmentId: admissionAssignment?.assignmentId || null,
          currentAssignmentId: admissionAssignment?.assignmentId || null,
          admissionAssignmentOwned,
          admissionFeePlanId: admissionFeePlan?.feePlanId || null,
          admissionFeePlanOwned,
          history: [
            {
              event: 'STAY_CREATED',
              timestamp: new Date(),
              actorRole,
              actorMemberId,
              note: isHistoricalAdmission
                ? `Historical hostel stay created from ${joinedOn} in Room ${initialRoomId}: ${normalizedHistoricalReason}`
                : `Hostel stay created from ${joinedOn} in Room ${initialRoomId}`,
              details: {
                initialRoomId,
                monthlyFeePaise,
                expectedDepositPaise: expectedDepositPaise || 0,
                historicalAdmission: isHistoricalAdmission,
                historicalReason: isHistoricalAdmission ? normalizedHistoricalReason : null,
                admissionMode,
                assignmentOwnership: admissionAssignmentOwned ? 'STAY_CREATED' : 'PRE_EXISTING',
                feePlanOwnership: admissionFeePlan
                  ? (admissionFeePlanOwned ? 'STAY_CREATED' : 'PRE_EXISTING')
                  : 'NONE',
                unverifiedOccupancyUntil,
              },
            },
          ],
        }, { session });

        createdDepositAccount = await repository.createDepositAccount({
          depositAccountId,
          stayId,
          memberId,
          expectedDepositPaise: expectedDepositPaise || 0,
          holderType: DEPOSIT_HOLDER_TYPES.ADMIN_COLLECTOR,
          holderName: 'Hostel Administration',
          status: expectedDepositPaise > 0
            ? DEPOSIT_ACCOUNT_STATUSES.OPEN
            : DEPOSIT_ACCOUNT_STATUSES.NOT_REQUIRED,
          history: [
            {
              event: expectedDepositPaise > 0
                ? 'DEPOSIT_ACCOUNT_OPENED'
                : 'DEPOSIT_NOT_REQUIRED',
              timestamp: new Date(),
              actorRole,
              note: `Deposit account initialized for stay ${stayId}`,
              details: { expectedDepositPaise: expectedDepositPaise || 0 },
            },
          ],
        }, { session });

        if (session) {
          await session.commitTransaction();
        }

        return createdStay;
      } catch (err) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }
        if (!session) {
          // Rollback all created entities on in-memory / non-transactional test environments
          if (createdFeePlan?.feePlanId && typeof roomFees?.deleteFeePlan === 'function') {
            try { await roomFees.deleteFeePlan(createdFeePlan.feePlanId); } catch (_err) { /* rollback best-effort */ }
          }
          if (createdDepositAccount && typeof repository?.deleteDepositAccount === 'function') {
            try { await repository.deleteDepositAccount(depositAccountId); } catch (_err) { /* rollback best-effort */ }
          }
          if (createdStay && typeof repository?.deleteStay === 'function') {
            try { await repository.deleteStay(stayId); } catch (_err) { /* rollback best-effort */ }
          }
          if (createdAssignment?.assignmentId && typeof roomFees?.rollbackCreatedAssignment === 'function') {
            try { await roomFees.rollbackCreatedAssignment(createdAssignment.assignmentId); } catch (_err) { /* rollback best-effort */ }
          }
        }
        if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
          throw new StayDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
        }
        if (
          admissionMode === 'new_assignment'
          && err.statusCode === 409
          && /active room assignment/i.test(err.message || '')
          && typeof roomFees?.getAssignmentsForMember === 'function'
        ) {
          const assignments = await roomFees.getAssignmentsForMember(memberId);
          const conflict = assignments.find((item) => !item.cancelledAt) || null;
          throw new StayDomainError(
            conflict?.roomNumber
              ? `${memberId} already occupies Room ${conflict.roomNumber}. Link the existing Room Assignment instead of creating another assignment.`
              : err.message,
            409,
            { code: 'EXISTING_ASSIGNMENT_CAN_BE_LINKED', assignment: conflict },
          );
        }
        throw err;
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    },

    /**
     * Get stay by ID
     */
    async getStayById(stayId) {
      const stay = await repository.findStayById(stayId);
      if (!stay) {
        throw new StayDomainError('Hostel stay not found.', 404);
      }
      return stay;
    },

    /**
     * Get active stay for a specific member
     */
    async getActiveStayForMember(memberId) {
      return repository.findActiveStayForMember(memberId);
    },

    /**
     * Return the resident's current Stay state together with the independent
     * Room Assignment state. A Room Assignment can legitimately exist before
     * a Stay record is registered, so callers must not infer one from the other.
     */
    async getMemberStayOverview(memberId) {
      if (!MEMBER_IDS.includes(memberId)) {
        throw new StayDomainError(`Invalid member ID: ${memberId}`, 400);
      }

      const activeStay = await repository.findActiveStayForMember(memberId);
      let stay = activeStay;
      if (!stay) {
        const stays = await repository.findStaysByMember(memberId);
        stay = stays.find(
          (candidate) => ![STAY_STATUSES.CANCELLED, STAY_STATUSES.SUPERSEDED].includes(candidate.status),
        ) || null;
      }

      const accommodation = typeof roomFees?.getMemberAccommodation === 'function'
        ? await roomFees.getMemberAccommodation(memberId)
        : { currentRoom: null, currentAssignment: null, currentFeePlan: null };

      return {
        memberId,
        configured: Boolean(stay),
        isActive: Boolean(activeStay),
        stay,
        ...accommodation,
      };
    },

    async previewRestoreResident(params) {
      return buildRestorePreview(params);
    },

    async previewRoomAssignmentRepair(params) {
      return buildRoomAssignmentRepairPreview(params);
    },

    async repairRoomAssignment({ previewToken, ...params }) {
      if (!previewToken || typeof previewToken !== 'string') {
        throw new StayDomainError('A current Room Assignment repair preview token is required.', 400);
      }
      const session = await startLifecycleTransaction();
      const repairedAt = now();
      try {
        const preview = await buildRoomAssignmentRepairPreview(params, { session });
        if (preview.previewToken !== previewToken) {
          throw new StayDomainError(
            'Residence records changed after the preview. Generate a new preview and retry.',
            409,
            { code: 'ROOM_REPAIR_PREVIEW_STALE' },
          );
        }
        if (!preview.canApply) {
          throw new StayDomainError('Room Assignment repair has unresolved conflicts.', 409, {
            code: 'ROOM_REPAIR_CONFLICT',
            conflicts: preview.conflicts,
          });
        }

        const stay = await repository.findStayById(params.stayId, { session });
        const assignment = await roomFees.repairActiveStayAssignment({
          memberId: stay.memberId,
          roomId: params.roomId,
          occupancyFromDate: params.occupancyFromDate || getLogicalDateInTimeZone(repairedAt),
          assignmentAction: params.assignmentAction,
          assignmentId: params.assignmentId || null,
          actorRole: params.actorRole,
          session,
        });
        const isReferenceCorrection = params.correctionMode === 'CORRECT_STAY_ROOM_REFERENCE';
        const updated = await repository.updateStay(
          stay.stayId,
          {
            currentAssignmentId: assignment.assignmentId,
            ...(isReferenceCorrection ? { currentRoomId: assignment.roomId } : {}),
          },
          params.expectedRevision,
          { session },
        );
        if (!updated) {
          throw new StayDomainError('Stay changed while the repair was being applied. Refresh and retry.', 409);
        }
        const withHistory = await repository.addStayHistory(stay.stayId, {
          event: isReferenceCorrection ? 'STAY_ROOM_REFERENCE_CORRECTED' : 'ROOM_ASSIGNMENT_REPAIRED',
          timestamp: repairedAt,
          actorRole: params.actorRole,
          note: params.reason.trim().slice(0, 500),
          details: {
            previousCurrentAssignmentId: stay.currentAssignmentId || null,
            currentAssignmentId: assignment.assignmentId,
            previousCurrentRoomId: stay.currentRoomId || null,
            currentRoomId: isReferenceCorrection ? assignment.roomId : stay.currentRoomId,
            correctionMode: params.correctionMode || 'ASSIGNMENT_ONLY',
            assignmentAction: params.assignmentAction,
            previousAssignment: preview.currentAssignment,
            repairedAssignment: assignment,
          },
        }, { session });
        if (session) await session.commitTransaction();
        return { stay: withHistory, assignment };
      } catch (error) {
        if (session?.inTransaction()) await session.abortTransaction();
        throw error;
      } finally {
        if (session) await session.endSession();
      }
    },

    async previewHistoricalStayReconciliation(params) {
      return buildHistoricalStayReconciliationPreview(params);
    },

    async reconcileHistoricalStay({ previewToken, ...params }) {
      if (!previewToken || typeof previewToken !== 'string') {
        throw new StayDomainError('A current historical reconciliation preview token is required.', 400);
      }
      const session = await startLifecycleTransaction();
      const reconciliationId = randomUUID();
      const reconciledAt = now();
      try {
        const preview = await buildHistoricalStayReconciliationPreview(params, { session });
        if (preview.previewToken !== previewToken) {
          throw new StayDomainError(
            'Historical records changed after the preview. Generate a new preview and retry.',
            409,
            { code: 'HISTORICAL_RECONCILIATION_PREVIEW_STALE' },
          );
        }
        if (!preview.canApply) {
          throw new StayDomainError('Historical Stay reconciliation has unresolved conflicts.', 409, {
            code: 'HISTORICAL_RECONCILIATION_CONFLICT',
            conflicts: preview.conflicts,
          });
        }
        const reason = params.reason.trim().slice(0, 500);
        const replacementLock = await repository.lockHistoricalReplacementStay(
          params.supersededByStayId,
          {
            memberId: preview.memberId,
            expectedRevision: preview.expectedReplacementRevision,
            historicalStayId: params.stayId,
            reconciliationId,
            reason,
            actorRole: params.actorRole,
            reconciledAt,
          },
          { session },
        );
        if (!replacementLock) {
          throw new StayDomainError(
            'The active replacement Stay changed while reconciliation was applied. Refresh and retry.',
            409,
            { code: 'REPLACEMENT_STAY_CONFLICT' },
          );
        }
        const revokedClearanceIds = await repository.revokeActiveClearances(
          params.stayId,
          {
            reason,
            actorRole: params.actorRole,
            revokedAt: reconciledAt,
            reconciliationId,
          },
          { session },
        );
        const reconciled = await repository.reconcileHistoricalStay(
          params.stayId,
          {
            supersededByStayId: params.supersededByStayId,
            reconciliationId,
            reason,
            actorRole: params.actorRole,
            expectedRevision: params.expectedRevision,
            reconciledAt,
            revokedClearanceIds,
            confirmationProvided: preview.confirmationProvided,
            affectedMonths: preview.affectedMonths,
            attributionWarnings: preview.attributionWarnings,
            affectedFinancialDomains: preview.affectedFinancialDomains,
            beforeState: preview.beforeState,
            afterState: preview.afterState,
            obligationMappings: preview.obligationMappings,
          },
          { session },
        );
        if (!reconciled) {
          throw new StayDomainError('Historical Stay changed while reconciliation was applied.', 409);
        }
        if (session) await session.commitTransaction();
        return { reconciliationId, stay: reconciled, replacementStay: replacementLock, revokedClearanceIds };
      } catch (error) {
        if (session?.inTransaction()) await session.abortTransaction();
        throw error;
      } finally {
        if (session) await session.endSession();
      }
    },

    async restoreResident({ previewToken, ...params }) {
      if (!previewToken || typeof previewToken !== 'string') {
        throw new StayDomainError('A current restoration preview token is required.', 400);
      }
      const session = await startLifecycleTransaction();
      const restorationId = randomUUID();
      const restoredAt = now();

      try {
        const preview = await buildRestorePreview(params, { session });
        if (preview.previewToken !== previewToken) {
          throw new StayDomainError(
            'Residence records changed after the preview. Generate a new preview and retry.',
            409,
            { code: 'RESTORATION_PREVIEW_STALE' },
          );
        }
        if (!preview.canApply) {
          throw new StayDomainError(
            'Resident restoration has unresolved conflicts.',
            409,
            { code: 'RESTORATION_CONFLICT', conflicts: preview.conflicts },
          );
        }

        const stay = await repository.findStayById(params.stayId, { session });
        if (requiresTransactions) {
          await guardCheckoutFinancialSnapshot({
            stayId: params.stayId,
            expectedFinancialRevision: preview.expectedFinancialRevision,
            session,
          });
        }
        const assignment = await roomFees.restoreAssignmentForResident({
          memberId: stay.memberId,
          roomId: params.roomId,
          occupancyFromDate: params.occupancyFromDate,
          assignmentAction: params.assignmentAction,
          assignmentId: params.assignmentId || null,
          actorRole: params.actorRole,
          session,
        });
        const revokedClearanceIds = await repository.revokeActiveClearances(
          params.stayId,
          {
            reason: params.reason.trim(),
            actorRole: params.actorRole,
            revokedAt: restoredAt,
            restorationId,
          },
          { session },
        );
        const restoredStay = await repository.restoreStay(
          params.stayId,
          {
            joinedOn: params.joinedOn,
            roomId: assignment.roomId,
            assignmentId: assignment.assignmentId,
            reason: params.reason.trim(),
            actorRole: params.actorRole,
            expectedRevision: params.expectedRevision,
            restoredAt,
            restorationId,
            previousActualLeftOn: stay.actualLeftOn,
            previousCheckoutFinalizedAt: stay.checkoutFinalizedAt,
            revokedClearanceIds,
          },
          { session },
        );
        if (!restoredStay) {
          throw new StayDomainError('Stay changed while restoration was being applied.', 409);
        }

        if (session) await session.commitTransaction();
        return { restorationId, stay: restoredStay, assignment, revokedClearanceIds };
      } catch (error) {
        if (session?.inTransaction()) await session.abortTransaction();
        const isConflict =
          error.code === 11000
          || error.code === 112
          || error.errorLabels?.has?.('TransientTransactionError')
          || error.errorLabelSet?.has?.('TransientTransactionError')
          || (typeof error.message === 'string' && error.message.includes('WriteConflict'));
        if (isConflict) {
          throw new StayDomainError(
            'Residence records changed while restoration was being applied. Generate a new preview and retry.',
            409,
            { code: 'RESTORATION_CONFLICT' },
          );
        }
        throw error;
      } finally {
        if (session) await session.endSession();
      }
    },

    /**
     * List all stays
     */
    async listStays({ status = null, memberId = null } = {}) {
      return repository.listAllStays({ status, memberId });
    },

    /**
     * List stays for a specific member
     */
    async listStaysForMember(memberId) {
      return repository.findStaysByMember(memberId);
    },

    async cancelIncorrectStay({ stayId, reason, expectedRevision, actorRole }) {
      if (actorRole !== ROLES.SUPERADMIN) {
        throw new StayDomainError('Only Super Admin can cancel an incorrect stay.', 403);
      }
      const normalizedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
      if (normalizedReason.length < 3) {
        throw new StayDomainError('A cancellation reason is required.', 400);
      }
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new StayDomainError('expectedRevision must be a non-negative integer.', 400);
      }

      const stay = await repository.findStayById(stayId);
      if (!stay) throw new StayDomainError('Hostel stay not found.', 404);
      if (stay.status === STAY_STATUSES.CANCELLED) {
        throw new StayDomainError('Hostel stay is already cancelled.', 409);
      }
      if (stay.status === STAY_STATUSES.CHECKED_OUT) {
        throw new StayDomainError('A checked-out stay cannot be cancelled.', 409);
      }
      if (!stay.admissionAssignmentId) {
        throw new StayDomainError(
          'The admission room assignment cannot be identified safely. Use the correction workflow.',
          409,
          { blockers: [{ type: 'ADMISSION_ASSIGNMENT', message: 'Missing admission assignment link.' }] },
        );
      }

      const [finances, clearances] = await Promise.all([
        attributionService.getStayAttributedFinances({ stayId, actorRole }),
        repository.findClearancesByStayId(stayId),
      ]);
      const blockers = [];
      if ((finances.totalMessBilledPaise || 0) !== 0 || (finances.totalMessPaidPaise || 0) !== 0) {
        blockers.push({ type: 'MESS_ACTIVITY', message: 'Mess obligations or payments are attributed to this stay.' });
      }
      if ((finances.totalRoomBilledPaise || 0) !== 0 || (finances.totalRoomPaidPaise || 0) !== 0) {
        blockers.push({ type: 'ROOM_CHARGES', message: 'Room charges or payments are attributed to this stay.' });
      }
      if (
        (finances.totalExpenseSharePaise || 0) !== 0
        || (finances.totalExpenseOwedPaise || 0) !== 0
        || (finances.totalExpenseReceivablePaise || 0) !== 0
      ) {
        blockers.push({ type: 'EXPENSE_ACTIVITY', message: 'Shared-expense obligations are attributed to this stay.' });
      }
      if ((finances.depositOverview?.transactions || []).length > 0) {
        blockers.push({ type: 'DEPOSIT_ACTIVITY', message: 'Deposit transactions exist for this stay.' });
      }
      if (clearances.length > 0) {
        blockers.push({ type: 'CLEARANCE', message: 'A clearance snapshot exists for this stay.' });
      }
      if ((finances.attributionWarnings || []).length > 0) {
        blockers.push({ type: 'AMBIGUOUS_ATTRIBUTION', message: 'Financial attribution is incomplete or ambiguous.' });
      }
      if (blockers.length > 0) {
        throw new StayDomainError(
          'This stay has financial or clearance activity and cannot be cancelled directly.',
          409,
          { blockers },
        );
      }

      const session = await startLifecycleTransaction();

      const cancelledAt = now();
      try {
        if (stay.admissionAssignmentOwned !== false || stay.admissionFeePlanOwned === true) {
          await roomFees.cancelAdmissionArtifacts({
            assignmentId: stay.admissionAssignmentOwned !== false ? stay.admissionAssignmentId : null,
            feePlanId: stay.admissionFeePlanOwned === true ? stay.admissionFeePlanId : null,
            reason: normalizedReason,
            actorRole,
            session,
          });
        }

        const depositAccount = await repository.findDepositAccountByStayId(stayId, { session });
        if (depositAccount) {
          await repository.updateDepositAccount(
            depositAccount.depositAccountId,
            { status: DEPOSIT_ACCOUNT_STATUSES.SETTLED },
            depositAccount.revision,
            { session },
          );
          await repository.addDepositAccountHistory(
            depositAccount.depositAccountId,
            {
              event: 'DEPOSIT_ACCOUNT_CANCELLED_EMPTY',
              timestamp: cancelledAt,
              actorRole,
              note: normalizedReason,
              details: { stayId },
            },
            { session },
          );
        }

        const cancelled = await repository.cancelStay(
          stayId,
          { reason: normalizedReason, actorRole, expectedRevision, cancelledAt },
          { session },
        );
        if (!cancelled) {
          throw new StayDomainError('Stay changed while cancellation was being processed. Refresh and retry.', 409);
        }
        if (session) await session.commitTransaction();
        return cancelled;
      } catch (error) {
        if (session?.inTransaction()) await session.abortTransaction();
        throw error;
      } finally {
        if (session) await session.endSession();
      }
    },

    async correctAdmissionDetails({
      stayId,
      joinedOn,
      roomId,
      reason,
      expectedRevision,
      actorRole,
    }) {
      if (actorRole !== ROLES.SUPERADMIN) {
        throw new StayDomainError('Only Super Admin can correct an admission.', 403);
      }
      if (!joinedOn || !isValidLogicalDate(joinedOn)) {
        throw new StayDomainError('Valid corrected joining date is required.', 400);
      }
      if (!roomId || !roomId.trim()) {
        throw new StayDomainError('Corrected room is required.', 400);
      }
      const normalizedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
      if (normalizedReason.length < 3) {
        throw new StayDomainError('A correction reason is required.', 400);
      }
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new StayDomainError('expectedRevision must be a non-negative integer.', 400);
      }

      const stay = await repository.findStayById(stayId);
      if (!stay) throw new StayDomainError('Hostel stay not found.', 404);
      if (stay.status !== STAY_STATUSES.ACTIVE) {
        throw new StayDomainError('Only an active Stay can have its admission corrected.', 409);
      }
      if (stay.expectedLeaveOn && joinedOn > stay.expectedLeaveOn) {
        throw new StayDomainError('Joining date cannot be after the expected departure date.', 400);
      }
      if (!stay.admissionAssignmentId) {
        throw new StayDomainError('The admission room assignment cannot be identified safely.', 409);
      }
      if (stay.admissionAssignmentOwned === false) {
        throw new StayDomainError(
          'This Stay links a pre-existing Room Assignment. Correct the assignment through the audited Room Fees workflow instead.',
          409,
          { code: 'PRE_EXISTING_ASSIGNMENT_REQUIRES_SEPARATE_CORRECTION' },
        );
      }

      const [finances, clearances] = await Promise.all([
        attributionService.getStayAttributedFinances({ stayId, actorRole }),
        repository.findClearancesByStayId(stayId),
      ]);
      const blockers = [];
      if ((finances.totalMessBilledPaise || 0) !== 0 || (finances.totalMessPaidPaise || 0) !== 0) {
        blockers.push({ type: 'MESS_ACTIVITY', message: 'Mess activity is attributed to this Stay.' });
      }
      if ((finances.totalRoomBilledPaise || 0) !== 0 || (finances.totalRoomPaidPaise || 0) !== 0) {
        blockers.push({ type: 'ROOM_CHARGES', message: 'Room fee activity is attributed to this Stay.' });
      }
      if (
        (finances.totalExpenseSharePaise || 0) !== 0
        || (finances.totalExpenseOwedPaise || 0) !== 0
        || (finances.totalExpenseReceivablePaise || 0) !== 0
      ) {
        blockers.push({ type: 'EXPENSE_ACTIVITY', message: 'Expense activity is attributed to this Stay.' });
      }
      if ((finances.depositOverview?.transactions || []).length > 0) {
        blockers.push({ type: 'DEPOSIT_ACTIVITY', message: 'Deposit transactions exist for this Stay.' });
      }
      if (clearances.length > 0) {
        blockers.push({ type: 'CLEARANCE', message: 'A clearance snapshot exists for this Stay.' });
      }
      if ((finances.attributionWarnings || []).length > 0) {
        blockers.push({ type: 'AMBIGUOUS_ATTRIBUTION', message: 'Financial attribution is incomplete or ambiguous.' });
      }
      if (blockers.length > 0) {
        throw new StayDomainError(
          'This admission has financial or clearance activity and cannot be corrected directly.',
          409,
          { blockers },
        );
      }

      const session = await startLifecycleTransaction();

      try {
        const correctedRoomId = roomId.trim();
        await roomFees.correctAdmissionArtifacts({
          assignmentId: stay.admissionAssignmentId,
          feePlanId: stay.admissionFeePlanId || null,
          memberId: stay.memberId,
          roomId: correctedRoomId,
          effectiveFromDate: joinedOn,
          actorRole,
          session,
        });
        const wasStillInAdmissionRoom = stay.currentRoomId === stay.initialRoomId;
        const corrected = await repository.updateStay(stayId, {
          joinedOn,
          initialRoomId: correctedRoomId,
          ...(wasStillInAdmissionRoom ? { currentRoomId: correctedRoomId } : {}),
        }, expectedRevision, { session });
        if (!corrected) {
          throw new StayDomainError('Stay changed while correction was being processed. Refresh and retry.', 409);
        }
        await repository.addStayHistory(stayId, {
          event: 'ADMISSION_CORRECTED',
          timestamp: now(),
          actorRole,
          note: normalizedReason,
          details: {
            previousJoinedOn: stay.joinedOn,
            joinedOn,
            previousRoomId: stay.initialRoomId,
            roomId: correctedRoomId,
            expectedRevision,
          },
        }, { session });
        if (session) await session.commitTransaction();
        return corrected;
      } catch (error) {
        if (session?.inTransaction()) await session.abortTransaction();
        throw error;
      } finally {
        if (session) await session.endSession();
      }
    },

    /**
     * Member requests checkout
     */
    async requestCheckout({
      stayId,
      memberId,
      actorMemberId,
      actorRole = 'member',
      preferredDate,
      preferredLeaveDate,
      reason,
      note = null,
    }) {
      const stay = await this.getStayById(stayId);
      const targetMemberId = memberId || actorMemberId || (actorRole !== 'member' ? stay.memberId : null);
      if (stay.memberId !== targetMemberId && actorRole === 'member') {
        throw new StayDomainError('You cannot request checkout for another member.', 403);
      }
      if (stay.status !== STAY_STATUSES.ACTIVE) {
        throw new StayDomainError(`Cannot request checkout when stay status is ${stay.status}.`, 400);
      }
      const leaveDate = preferredLeaveDate || preferredDate;
      if (!leaveDate || !isValidLogicalDate(leaveDate)) {
        throw new StayDomainError('Valid departure date in YYYY-MM-DD format is required.', 400);
      }
      if (leaveDate < stay.joinedOn) {
        throw new StayDomainError('Preferred departure date cannot precede joining date.', 400);
      }

      const requestNote = (reason || note)?.trim() || null;

      const updated = await repository.updateStay(
        stayId,
        {
          status: STAY_STATUSES.CHECKOUT_REQUESTED,
          checkoutRequestedAt: new Date(),
          checkoutRequestedFor: leaveDate,
          checkoutRequestNote: requestNote,
        },
        stay.revision,
      );

      if (!updated) {
        throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
      }

      await repository.addStayHistory(stayId, {
        event: 'CHECKOUT_REQUESTED',
        timestamp: new Date(),
        actorRole,
        actorMemberId: targetMemberId,
        note: `Checkout requested for ${leaveDate}${requestNote ? `: ${requestNote}` : ''}`,
      });

      return updated;
    },

    /**
     * Member or Admin cancels pending checkout request
     */
    async cancelCheckoutRequest({
      stayId,
      memberId,
      actorMemberId,
      actorRole = 'member',
      reason = null,
    }) {
      const stay = await this.getStayById(stayId);
      const targetMemberId = memberId || actorMemberId || (actorRole !== 'member' ? stay.memberId : null);
      if (stay.memberId !== targetMemberId && actorRole === 'member') {
        throw new StayDomainError('You cannot cancel another member’s checkout request.', 403);
      }
      if (stay.status !== STAY_STATUSES.CHECKOUT_REQUESTED && stay.status !== STAY_STATUSES.CHECKOUT_PENDING) {
        throw new StayDomainError('No pending checkout request to cancel.', 400);
      }

      const updated = await repository.updateStay(
        stayId,
        {
          status: STAY_STATUSES.ACTIVE,
          checkoutRequestedAt: null,
          checkoutRequestedFor: null,
          checkoutRequestNote: null,
        },
        stay.revision,
      );

      if (!updated) {
        throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
      }

      await repository.addStayHistory(stayId, {
        event: 'CHECKOUT_REQUEST_CANCELLED',
        timestamp: new Date(),
        actorRole,
        actorMemberId: targetMemberId,
        note: reason ? `Checkout request cancelled: ${reason}` : 'Checkout request cancelled',
      });

      return updated;
    },

    /**
     * Transfer member between rooms
     */
    async transferRoom({
      stayId,
      newRoomId,
      effectiveDate,
      newMonthlyRatePaise = null,
      monthlyFeePaise = null,
      reason = null,
      actorRole,
    }) {
      const finalMonthlyRate = monthlyFeePaise ?? newMonthlyRatePaise ?? null;
      if (actorRole !== 'admin' && actorRole !== 'superadmin') {
        throw new StayDomainError('Only administrators can perform room transfers.', 403);
      }
      const stay = await this.getStayById(stayId);
      if (stay.status === STAY_STATUSES.CHECKED_OUT) {
        throw new StayDomainError('Cannot transfer a member who is already checked out.', 400);
      }
      if (!newRoomId || !newRoomId.trim()) {
        throw new StayDomainError('Destination room ID required.', 400);
      }
      if (stay.currentRoomId === newRoomId.trim()) {
        throw new StayDomainError('Member is already assigned to this room.', 400);
      }
      if (!effectiveDate || !isValidLogicalDate(effectiveDate)) {
        throw new StayDomainError('Effective transfer date in YYYY-MM-DD format is required.', 400);
      }
      if (effectiveDate < stay.joinedOn) {
        throw new StayDomainError('Transfer date cannot precede admission date.', 400);
      }
      if (finalMonthlyRate !== null && (!Number.isInteger(finalMonthlyRate) || finalMonthlyRate <= 0)) {
        throw new StayDomainError('Monthly fee must be a positive integer in paise.', 400);
      }

      const transferMonth = effectiveDate.slice(0, 7);
      const oldRoomId = stay.currentRoomId || stay.initialRoomId;

      let newAssignment = null;
      let newPlan = null;
      const session = await startLifecycleTransaction();

      try {
        // 1. Assign to new room via roomFeeService (which validates capacity and closes old assignment)
        newAssignment = await roomFees.assignMemberToRoom({
          roomId: newRoomId.trim(),
          memberId: stay.memberId,
          effectiveFromMonth: transferMonth,
          effectiveFromDate: effectiveDate,
          actorRole,
          session,
        });

        // 2. Update fee plan if provided
        if (Number.isInteger(finalMonthlyRate) && finalMonthlyRate > 0) {
          newPlan = await roomFees.createFeePlan({
            memberId: stay.memberId,
            effectiveFromMonth: transferMonth,
            amountPaise: finalMonthlyRate,
            reason: `Updated rate upon room transfer from Room ${oldRoomId} to ${newRoomId}`,
            actorRole,
            session,
          });
        }

        // 3. Update stay currentRoomId
        const updated = await repository.updateStay(
          stayId,
          {
            currentRoomId: newRoomId.trim(),
            currentAssignmentId: newAssignment.assignmentId,
          },
          stay.revision,
          { session },
        );

        if (!updated) {
          throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
        }

        await repository.addStayHistory(stayId, {
          event: 'ROOM_TRANSFERRED',
          timestamp: new Date(),
          actorRole,
          note: `Transferred from Room ${oldRoomId} to Room ${newRoomId} effective ${effectiveDate}${reason ? `: ${reason}` : ''}`,
          details: { oldRoomId, newRoomId, effectiveDate, newMonthlyRatePaise: finalMonthlyRate },
        }, { session });

        if (session) {
          await session.commitTransaction();
        }

        return updated;
      } catch (err) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }
        if (!session) {
          // Rollback any partial updates on in-memory environments
          if (newPlan?.feePlanId && typeof roomFees?.deleteFeePlan === 'function') {
            try { await roomFees.deleteFeePlan(newPlan.feePlanId); } catch (_err) { /* rollback best-effort */ }
          }
          if (newAssignment?.assignmentId && typeof roomFees?.rollbackCreatedAssignment === 'function') {
            try { await roomFees.rollbackCreatedAssignment(newAssignment.assignmentId); } catch (_err) { /* rollback best-effort */ }
          }
        }
        if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
          throw new StayDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
        }
        throw err;
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    },

    /**
     * Initiate checkout review (transitions CHECKOUT_REQUESTED -> CHECKOUT_PENDING)
     */
    async initiateCheckoutReview({ stayId, actorRole }) {
      if (actorRole !== 'admin' && actorRole !== 'superadmin') {
        throw new StayDomainError('Only administrators can initiate checkout review.', 403);
      }
      const stay = await this.getStayById(stayId);
      if (stay.status !== STAY_STATUSES.CHECKOUT_REQUESTED && stay.status !== STAY_STATUSES.ACTIVE) {
        throw new StayDomainError(`Cannot initiate checkout review from status: ${stay.status}`, 400);
      }

      const updated = await repository.updateStay(
        stayId,
        {
          status: STAY_STATUSES.CHECKOUT_PENDING,
          checkoutReviewInitiatedAt: new Date(),
          checkoutReviewInitiatedByRole: actorRole,
        },
        stay.revision,
      );

      if (!updated) {
        throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
      }

      await repository.addStayHistory(stayId, {
        event: 'CHECKOUT_REVIEW_INITIATED',
        timestamp: new Date(),
        actorRole,
        note: `Checkout review initiated by ${actorRole}`,
        details: { previousStatus: stay.status, newStatus: STAY_STATUSES.CHECKOUT_PENDING },
      });

      return updated;
    },

    /**
     * Get room assignment timeline for a stay
     */
    async getStayRoomHistory(stayId) {
      const stay = await this.getStayById(stayId);
      const assignments = await roomFees.getAssignmentsForMember(stay.memberId);
      const joinMonth = stay.joinedOn.slice(0, 7);
      const exitMonth = stay.actualLeftOn ? stay.actualLeftOn.slice(0, 7) : null;

      const timeline = assignments
        .filter((a) => {
          if (exitMonth && a.effectiveFromMonth > exitMonth) return false;
          if (a.effectiveUntilMonth && a.effectiveUntilMonth < joinMonth) return false;
          return true;
        })
        .sort((a, b) => a.effectiveFromMonth.localeCompare(b.effectiveFromMonth));

      return {
        stayId,
        memberId: stay.memberId,
        currentRoomId: stay.currentRoomId,
        timeline,
      };
    },

    /**
     * Get 5-step Checkout Review data across all attributable stay months using canonical Stay Attribution
     */
    async getCheckoutReview(stayId, { session = null, actorRole = 'admin' } = {}) {
      const stay = await repository.findStayById(stayId, { session });
      if (!stay) {
        throw new StayDomainError('Hostel stay not found.', 404);
      }
      const memberId = stay.memberId;
      const currentMonth = getLogicalDateInTimeZone(new Date(), 'Asia/Kolkata').slice(0, 7);

      const attr = await attributionService.getStayAttributedFinances({
        stayId,
        session,
        actorRole,
      });

      const currentOverview =
        attr.monthlySummaries.find((m) => m.month === currentMonth) ||
        attr.monthlySummaries[attr.monthlySummaries.length - 1] ||
        null;

      return {
        stay,
        financialOverview: {
          month: currentOverview?.month || currentMonth,
          mess: {
            billPaise: attr.totalMessBilledPaise,
            paidPaise: attr.totalMessPaidPaise,
            remainingPaise: attr.totalMessRemainingPaise,
          },
          room: {
            issuedChargePaise: attr.totalRoomBilledPaise,
            paidPaise: attr.totalRoomPaidPaise,
            remainingPaise: attr.totalRoomRemainingPaise,
          },
          expenses: {
            spendingSharePaise: attr.totalExpenseSharePaise,
            owedToOthersPaise: attr.totalExpenseOwedPaise,
            owedToMePaise: attr.totalExpenseReceivablePaise,
            debtsOwed: currentOverview?.expenses?.debtsOwed || [],
            receivables: currentOverview?.expenses?.receivables || [],
          },
          combined: {
            outstandingPayablePaise: attr.totalOutstandingPayablePaise,
            receivablePaise: attr.memberReceivablePaise,
            depositHeldPaise: attr.depositHeldPaise,
            unallocatedCreditPaise: attr.unallocatedCreditPaise,
          },
        },
        monthlyOverviews: attr.monthlySummaries,
        totalMessBilledPaise: attr.totalMessBilledPaise,
        totalMessPaidPaise: attr.totalMessPaidPaise,
        totalMessRemainingPaise: attr.totalMessRemainingPaise,
        totalRoomBilledPaise: attr.totalRoomBilledPaise,
        totalRoomPaidPaise: attr.totalRoomPaidPaise,
        totalRoomRemainingPaise: attr.totalRoomRemainingPaise,
        totalExpenseSharePaise: attr.totalExpenseSharePaise,
        totalExpenseOwedPaise: attr.totalExpenseOwedPaise,
        totalExpenseReceivablePaise: attr.totalExpenseReceivablePaise,
        depositOverview: attr.depositOverview,
        outstandingObligations: attr.outstandingObligations,
        totalOutstandingPayablePaise: attr.totalOutstandingPayablePaise,
        depositHeldPaise: attr.depositHeldPaise,
        unallocatedCreditPaise: attr.unallocatedCreditPaise,
        unresolvedFinancialItems: attr.unresolvedFinancialItems || [],
        attributionWarnings: attr.attributionWarnings || [],
        isAttributionComplete: attr.isAttributionComplete !== false,
        isEligibleForNoDues: attr.isEligibleForNoDues,
      };
    },

    /**
     * Finalize checkout and issue clearance snapshot
     */
    async finalizeCheckout({
      stayId,
      actualLeftOn,
      isException = false,
      allowWithDues = false,
      exceptionReason = null,
      actorRole,
    }) {
      const stay = await this.getStayById(stayId);
      if (stay.status === STAY_STATUSES.CHECKED_OUT) {
        throw new StayDomainError('Stay has already been checked out.', 400);
      }
      if (!actualLeftOn || !isValidLogicalDate(actualLeftOn)) {
        throw new StayDomainError('Valid departure date in YYYY-MM-DD format is required.', 400);
      }
      if (actualLeftOn < stay.joinedOn) {
        throw new StayDomainError('Departure date cannot precede joining date.', 400);
      }

      const explicitException = Boolean(isException || allowWithDues);

      // Pre-review stay-wide obligations
      const initialReview = await this.getCheckoutReview(stayId);

      // If obligations or unrefunded deposit remain, only Super Admin can override
      let clearanceStatus = CLEARANCE_STATUSES.NO_DUES;
      if (!initialReview.isEligibleForNoDues) {
        if (actorRole !== 'superadmin') {
          throw new StayDomainError(
            'Cannot finalize checkout with pending dues or unrefunded deposit. Super Admin approval required.',
            403,
            { totalOutstandingPayablePaise: initialReview.totalOutstandingPayablePaise },
          );
        }
        if (!explicitException) {
          throw new StayDomainError(
            'Departure with unresolved obligations requires explicit exception authorization (isException: true).',
            400,
          );
        }
        if (!exceptionReason || !exceptionReason.trim()) {
          throw new StayDomainError(
            'Mandatory reason is required when finalizing departure with unresolved obligations.',
            400,
          );
        }
        clearanceStatus = CLEARANCE_STATUSES.OUTSTANDING_DUES;
      }

      const session = await startLifecycleTransaction();

      try {
        // Concurrency guard: verify fresh stay status inside session
        const freshStay = await repository.findStayById(stayId, { session });
        if (!freshStay || freshStay.status === STAY_STATUSES.CHECKED_OUT) {
          throw new StayDomainError('Stay has already been checked out.', 409);
        }
        if (freshStay.revision !== stay.revision) {
          throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
        }

        if (requiresTransactions) {
          await guardCheckoutFinancialSnapshot({
            stayId,
            expectedFinancialRevision: freshStay.financialRevision,
            session,
          });
        }

        // Re-evaluate while holding the Stay financial write lock so every guarded writer must serialize.
        const review = await this.getCheckoutReview(stayId, { session, actorRole });
        if (!review.isEligibleForNoDues && !explicitException) {
          throw new StayDomainError(
            'Outstanding dues or unrefunded deposits exist across the stay duration. Settle all obligations or provide exceptional checkout authorization.',
            400,
            { totalOutstandingPayablePaise: review.totalOutstandingPayablePaise },
          );
        }
        if (!review.isEligibleForNoDues) {
          clearanceStatus = CLEARANCE_STATUSES.OUTSTANDING_DUES;
        }

        // 1. End active room assignment and release capacity with exact departure date
        await roomFees.endActiveRoomAssignment({
          memberId: stay.memberId,
          endDate: actualLeftOn,
          endMonth: actualLeftOn.slice(0, 7),
          session,
        });

        // 2. Safely allocate clearance sequence
        const sequence = await repository.getNextClearanceSequence(stayId, { session });
        const clearanceId = randomUUID();

        // 3. Transition Stay to CHECKED_OUT with revision guard
        const updatedStay = await repository.updateStay(
          stayId,
          {
            status: STAY_STATUSES.CHECKED_OUT,
            actualLeftOn,
            checkoutFinalizedAt: new Date(),
            checkoutFinalizedByRole: actorRole,
          },
          freshStay.revision,
          { session },
        );

        if (!updatedStay) {
          throw new StayDomainError('Stay modified concurrently. Please retry.', 409);
        }

        // 4. Create Immutable Clearance Snapshot
        const clearance = await repository.createClearance({
          clearanceId,
          stayId,
          memberId: stay.memberId,
          sequence,
          snapshotVersion: sequence,
          joinedOn: stay.joinedOn,
          actualLeftOn,
          lastRoomId: stay.currentRoomId || stay.initialRoomId,
          financialAsOf: new Date(),
          messSummary: {
            billPaise: review.totalMessBilledPaise ?? review.financialOverview.mess.billPaise,
            paidPaise: review.totalMessPaidPaise ?? review.financialOverview.mess.paidPaise,
            remainingPaise: review.totalMessRemainingPaise ?? review.financialOverview.mess.remainingPaise,
          },
          roomFeeSummary: {
            issuedChargePaise: review.totalRoomBilledPaise ?? review.financialOverview.room.issuedChargePaise,
            paidPaise: review.totalRoomPaidPaise ?? review.financialOverview.room.paidPaise,
            remainingPaise: review.totalRoomRemainingPaise ?? review.financialOverview.room.remainingPaise,
          },
          expenseSummary: {
            spendingSharePaise: review.totalExpenseSharePaise ?? review.financialOverview.expenses.spendingSharePaise,
            owedToOthersPaise: review.totalExpenseOwedPaise ?? review.financialOverview.expenses.owedToOthersPaise,
            owedToMePaise: review.totalExpenseReceivablePaise ?? review.financialOverview.expenses.owedToMePaise,
          },
          depositSummary: review.depositOverview.summary,
          unallocatedCreditSummary: {
            remainingPaise: review.unallocatedCreditPaise || 0,
            unresolvedItems: review.unresolvedFinancialItems || [],
          },
          outstandingObligations: review.outstandingObligations,
          clearanceStatus,
          exceptionReason: exceptionReason?.trim() || null,
          finalizedAt: new Date(),
          finalizedByRole: actorRole,
        }, { session });

        // 5. Audit trail
        await repository.addStayHistory(stayId, {
          event: 'CHECKOUT_FINALIZED',
          timestamp: new Date(),
          actorRole,
          note: `Stay finalized as ${clearanceStatus} on ${actualLeftOn}${exceptionReason ? `: ${exceptionReason}` : ''}`,
          details: { clearanceId, sequence, clearanceStatus },
        }, { session });

        if (session) {
          await session.commitTransaction();
        }

        return {
          stay: updatedStay,
          clearance,
        };
      } catch (err) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }
        const isFinancialWriteConflict =
          err.errorLabels?.has?.('TransientTransactionError')
          || err.errorLabelSet?.has?.('TransientTransactionError')
          || err.code === 112
          || (typeof err.message === 'string' && err.message.includes('WriteConflict'));
        if (isFinancialWriteConflict) {
          throw new StayDomainError(
            'Financial records changed during checkout. Refresh the review and retry.',
            409,
            { code: 'CHECKOUT_FINANCIALS_CHANGED' },
          );
        }
        if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
          throw new StayDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
        }
        throw err;
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    },

    /**
     * Open an audited correction window for financial records attributed to a completed Stay.
     */
    async openClearanceReview({ stayId, reason, actorRole }) {
      if (actorRole !== 'superadmin') {
        throw new StayDomainError('Only Super Admin can open a completed-Stay clearance review.', 403);
      }
      if (!reason || !reason.trim()) {
        throw new StayDomainError('Mandatory clearance review reason is required.', 400);
      }

      const session = await startLifecycleTransaction();
      try {
        const stay = await repository.findStayById(stayId, { session });
        if (!stay) {
          throw new StayDomainError('Hostel stay not found.', 404);
        }
        if (stay.status !== STAY_STATUSES.CHECKED_OUT) {
          throw new StayDomainError('Clearance review can only be opened for a checked-out stay.', 400);
        }
        if (stay.clearanceReviewOpenedAt) {
          throw new StayDomainError('A clearance review is already open for this stay.', 409);
        }

        const opened = await repository.openClearanceReview(
          stayId,
          {
            reason: reason.trim(),
            actorRole,
            openedAt: new Date(),
          },
          { session },
        );
        if (!opened) {
          throw new StayDomainError('Stay changed while opening clearance review. Refresh and retry.', 409);
        }

        if (session) await session.commitTransaction();
        return opened;
      } catch (error) {
        if (session?.inTransaction()) await session.abortTransaction();
        if (
          error.message?.includes('Transactions are not supported')
          || error.message?.includes('replica set')
        ) {
          throw new StayDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
        }
        throw error;
      } finally {
        if (session) await session.endSession();
      }
    },

    /**
     * Reissue clearance certificate with fresh snapshot (Super Admin only)
     */
    async reissueClearance({ stayId, reissueReason, actorRole }) {
      if (actorRole !== 'superadmin') {
        throw new StayDomainError('Only Super Admin can reissue clearance certificates.', 403);
      }
      if (!reissueReason || !reissueReason.trim()) {
        throw new StayDomainError('Mandatory reissue reason is required.', 400);
      }

      const maxRetries = 5;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const session = await startLifecycleTransaction();

        try {
          const stay = await repository.findStayById(stayId, { session });
          if (!stay) {
            throw new StayDomainError('Hostel stay not found.', 404);
          }
          if (stay.status !== STAY_STATUSES.CHECKED_OUT) {
            throw new StayDomainError('Clearance can only be reissued for a checked-out stay.', 400);
          }

          if (requiresTransactions) {
            await guardCheckoutFinancialSnapshot({
              stayId,
              expectedFinancialRevision: stay.financialRevision,
              session,
            });
          }

          const review = await this.getCheckoutReview(stayId, { session, actorRole });
          const clearanceStatus = review.isEligibleForNoDues
            ? CLEARANCE_STATUSES.NO_DUES
            : CLEARANCE_STATUSES.OUTSTANDING_DUES;

          const sequence = await repository.getNextClearanceSequence(stayId, { session });
          const clearanceId = randomUUID();

          const clearance = await repository.createClearance({
            clearanceId,
            stayId,
            memberId: stay.memberId,
            sequence,
            snapshotVersion: sequence,
            joinedOn: stay.joinedOn,
            actualLeftOn: stay.actualLeftOn,
            lastRoomId: stay.currentRoomId || stay.initialRoomId,
            financialAsOf: new Date(),
            messSummary: {
              billPaise: review.totalMessBilledPaise ?? review.financialOverview.mess.billPaise,
              paidPaise: review.totalMessPaidPaise ?? review.financialOverview.mess.paidPaise,
              remainingPaise: review.totalMessRemainingPaise ?? review.financialOverview.mess.remainingPaise,
            },
            roomFeeSummary: {
              issuedChargePaise: review.totalRoomBilledPaise ?? review.financialOverview.room.issuedChargePaise,
              paidPaise: review.totalRoomPaidPaise ?? review.financialOverview.room.paidPaise,
              remainingPaise: review.totalRoomRemainingPaise ?? review.financialOverview.room.remainingPaise,
            },
            expenseSummary: {
              spendingSharePaise: review.totalExpenseSharePaise ?? review.financialOverview.expenses.spendingSharePaise,
              owedToOthersPaise: review.totalExpenseOwedPaise ?? review.financialOverview.expenses.owedToOthersPaise,
              owedToMePaise: review.totalExpenseReceivablePaise ?? review.financialOverview.expenses.owedToMePaise,
            },
            depositSummary: review.depositOverview.summary,
            unallocatedCreditSummary: {
              remainingPaise: review.unallocatedCreditPaise || 0,
              unresolvedItems: review.unresolvedFinancialItems || [],
            },
            outstandingObligations: review.outstandingObligations,
            clearanceStatus,
            exceptionReason: reissueReason.trim(),
            finalizedAt: new Date(),
            finalizedByRole: actorRole,
          }, { session });

          const supersededClearanceIds = typeof repository.supersedeActiveClearances === 'function'
            ? await repository.supersedeActiveClearances(
              stayId,
              {
                supersededByClearanceId: clearanceId,
                reason: reissueReason.trim(),
                actorRole,
                supersededAt: new Date(),
              },
              { session },
            )
            : [];

          await repository.addStayHistory(stayId, {
            event: 'CLEARANCE_REISSUED',
            timestamp: new Date(),
            actorRole,
            note: `Clearance #${sequence} reissued: ${reissueReason.trim()}`,
            details: {
              clearanceId,
              sequence,
              clearanceStatus,
              reissueReason: reissueReason.trim(),
              supersededClearanceIds,
            },
          }, { session });

          if (stay.clearanceReviewOpenedAt && typeof repository.closeClearanceReview === 'function') {
            await repository.closeClearanceReview(
              stayId,
              {
                clearanceId,
                sequence,
                actorRole,
                reason: `Clearance review closed by reissue #${sequence}: ${reissueReason.trim()}`,
                closedAt: new Date(),
              },
              { session },
            );
          }

          if (session) {
            await session.commitTransaction();
          }

          return clearance;
        } catch (err) {
          if (session && session.inTransaction()) {
            await session.abortTransaction();
          }
          const isTransient =
            err.errorLabels?.has?.('TransientTransactionError') ||
            err.errorLabelSet?.has?.('TransientTransactionError') ||
            err.code === 112 ||
            err.code === 11000 ||
            (typeof err.message === 'string' && (err.message.includes('WriteConflict') || err.message.includes('duplicate key')));

          if (isTransient && attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            continue;
          }

          if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
            throw new StayDomainError('Financial transaction unavailable. Database transaction support is required.', 503);
          }
          throw err;
        } finally {
          if (session) {
            await session.endSession();
          }
        }
      }
    },

    /**
     * List historical clearance records for a stay
     */
    async listClearances(stayId) {
      return repository.findClearancesByStayId(stayId);
    },
  };
}

export const stayService = createStayService();
