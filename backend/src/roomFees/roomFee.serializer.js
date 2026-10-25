import { MEMBER_NAMES } from '../config/members.js';
import { ROOM_CHARGE_STATUSES, ROOM_PAYMENT_STATUSES, ROOM_PAYMENT_SUMMARY_STATUSES } from './roomFee.constants.js';

function serializeDate(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function computeChargeFinancials({ charge, payments = [], now = new Date() }) {
  const baseAmount = charge.baseAmountPaise;
  const adjustments = Array.isArray(charge.adjustments) ? charge.adjustments : [];
  const adjustmentTotal = adjustments.reduce((sum, adj) => sum + adj.amountPaise, 0);
  const finalBillAmountPaise = Math.max(0, baseAmount + adjustmentTotal);

  const validPayments = payments.filter((p) => p.status === ROOM_PAYMENT_STATUSES.VERIFIED);
  const paidAmountPaise = validPayments.reduce((sum, p) => sum + p.amountPaise, 0);

  const remainingAmountPaise = Math.max(0, finalBillAmountPaise - paidAmountPaise);
  const overpaidAmountPaise = Math.max(0, paidAmountPaise - finalBillAmountPaise);

  let paymentStatus;
  if (charge.status === ROOM_CHARGE_STATUSES.CANCELLED) {
    paymentStatus = ROOM_PAYMENT_SUMMARY_STATUSES.CANCELLED;
  } else if (overpaidAmountPaise > 0) {
    paymentStatus = ROOM_PAYMENT_SUMMARY_STATUSES.OVERPAID;
  } else if (remainingAmountPaise === 0) {
    paymentStatus = ROOM_PAYMENT_SUMMARY_STATUSES.PAID;
  } else if (paidAmountPaise > 0) {
    paymentStatus = ROOM_PAYMENT_SUMMARY_STATUSES.PARTIAL;
  } else {
    // Check if overdue: dueDate is YYYY-MM-DD
    const dueTime = new Date(`${charge.dueDate}T23:59:59.999Z`).getTime();
    if (now.getTime() > dueTime) {
      paymentStatus = ROOM_PAYMENT_SUMMARY_STATUSES.OVERDUE;
    } else {
      paymentStatus = ROOM_PAYMENT_SUMMARY_STATUSES.DUE;
    }
  }

  return {
    finalBillAmountPaise,
    paidAmountPaise,
    remainingAmountPaise,
    overpaidAmountPaise,
    paymentStatus,
    adjustmentTotalPaise: adjustmentTotal,
  };
}

export function serializeRoom(room, { currentOccupants = [] } = {}) {
  if (!room) return null;
  return {
    roomId: room.roomId,
    roomNumber: room.roomNumber,
    roomLabel: room.roomLabel,
    capacity: room.capacity,
    active: room.active,
    currentOccupancyCount: currentOccupants.length,
    currentOccupants: currentOccupants.map((id) => ({
      memberId: id,
      name: MEMBER_NAMES[id] ?? id,
    })),
    createdAt: serializeDate(room.createdAt),
    updatedAt: serializeDate(room.updatedAt),
  };
}

export function serializeRoomAssignment(assignment, roomMap = new Map()) {
  if (!assignment) return null;
  const room = roomMap.get(assignment.roomId);
  return {
    assignmentId: assignment.assignmentId,
    roomId: assignment.roomId,
    roomNumber: room?.roomNumber ?? 'Unknown',
    roomLabel: room?.roomLabel ?? 'Unknown Room',
    memberId: assignment.memberId,
    memberName: MEMBER_NAMES[assignment.memberId] ?? assignment.memberId,
    effectiveFromMonth: assignment.effectiveFromMonth,
    effectiveUntilMonth: assignment.effectiveUntilMonth,
    effectiveFromDate: assignment.effectiveFromDate ?? (assignment.effectiveFromMonth ? `${assignment.effectiveFromMonth}-01` : null),
    effectiveUntilDate: assignment.effectiveUntilDate ?? null,
    assignedAt: serializeDate(assignment.assignedAt),
    assignedByRole: assignment.assignedByRole,
    cancelledAt: serializeDate(assignment.cancelledAt),
    cancelledByRole: assignment.cancelledByRole ?? null,
    cancelReason: assignment.cancelReason ?? null,
  };
}

export function serializeFeePlan(plan) {
  if (!plan) return null;
  return {
    feePlanId: plan.feePlanId,
    memberId: plan.memberId,
    memberName: MEMBER_NAMES[plan.memberId] ?? plan.memberId,
    amountPaise: plan.amountPaise,
    effectiveFromMonth: plan.effectiveFromMonth,
    effectiveUntilMonth: plan.effectiveUntilMonth,
    dueDay: plan.dueDay,
    reason: plan.reason,
    createdByRole: plan.createdByRole,
    createdAt: serializeDate(plan.createdAt),
    supersededAt: serializeDate(plan.supersededAt),
    supersededBy: plan.supersededBy,
    supersededReason: plan.supersededReason,
    supersededReconciliationId: plan.supersededReconciliationId,
    createdReconciliationId: plan.createdReconciliationId,
  };
}

export function serializeRoomPayment(payment) {
  if (!payment) return null;
  return {
    roomPaymentId: payment.roomPaymentId,
    chargeId: payment.chargeId,
    memberId: payment.memberId,
    memberName: MEMBER_NAMES[payment.memberId] ?? payment.memberId,
    month: payment.month,
    amountPaise: payment.amountPaise,
    method: payment.method,
    reference: payment.reference,
    recipientSnapshot: payment.recipientSnapshot,
    idempotencyKey: payment.idempotencyKey,
    status: payment.status,
    recordedAt: serializeDate(payment.recordedAt),
    recordedByRole: payment.recordedByRole,
    voidedAt: serializeDate(payment.voidedAt),
    voidedByRole: payment.voidedByRole,
    voidReason: payment.voidReason,
  };
}

export function serializeRoomCharge(charge, { payments = [], now = new Date() } = {}) {
  if (!charge) return null;
  const financials = computeChargeFinancials({ charge, payments, now });

  return {
    chargeId: charge.chargeId,
    memberId: charge.memberId,
    memberName: MEMBER_NAMES[charge.memberId] ?? charge.memberId,
    roomId: charge.roomId,
    roomNumber: charge.roomNumber,
    month: charge.month,
    feePlanId: charge.feePlanId,
    baseAmountPaise: charge.baseAmountPaise,
    dueDate: charge.dueDate,
    status: charge.status,
    adjustments: (charge.adjustments || []).map((adj) => ({
      adjustmentId: adj.adjustmentId,
      amountPaise: adj.amountPaise,
      reason: adj.reason,
      createdAt: serializeDate(adj.createdAt),
      createdByRole: adj.createdByRole,
    })),
    ...financials,
    issuedAt: serializeDate(charge.issuedAt),
    issuedByRole: charge.issuedByRole,
    cancelledAt: serializeDate(charge.cancelledAt),
    cancelReason: charge.cancelReason,
    payments: payments.map(serializeRoomPayment),
  };
}

export function serializePaymentSettings(settings) {
  if (!settings) return null;
  return {
    recipientMode: settings.recipientMode,
    recipientName: settings.recipientName,
    upiId: settings.upiId,
    paymentInstructions: settings.paymentInstructions,
    defaultDueDay: settings.defaultDueDay,
    updatedAt: serializeDate(settings.updatedAt),
    updatedByRole: settings.updatedByRole,
  };
}
