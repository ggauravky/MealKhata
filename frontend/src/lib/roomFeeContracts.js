function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

export function roomFeeRequestKey(memberId, month) {
  return `${memberId || 'self'}:${month || ''}`;
}

export function mapMemberRoomFeeOverview(payload) {
  const overview = asObject(payload);
  const charge = overview.currentMonthCharge && typeof overview.currentMonthCharge === 'object'
    ? overview.currentMonthCharge
    : null;

  return {
    memberId: overview.memberId ?? null,
    month: overview.month ?? null,
    room: overview.currentRoom ?? null,
    assignment: overview.currentAssignment ?? null,
    feePlan: overview.currentFeePlan ?? null,
    scheduledFeePaise: Number.isSafeInteger(overview.scheduledFeePaise)
      ? overview.scheduledFeePaise
      : null,
    statement: {
      month: overview.month ?? charge?.month ?? null,
      charge,
      payments: Array.isArray(charge?.payments) ? charge.payments : [],
      effectiveChargePaise: charge?.finalBillAmountPaise ?? 0,
      paidPaise: charge?.paidAmountPaise ?? 0,
      remainingPaise: charge?.remainingAmountPaise ?? 0,
      overpaidPaise: charge?.overpaidPaise ?? 0,
      status: charge?.paymentStatus ?? 'not_issued',
    },
    metrics: asObject(overview.summaryMetrics),
    settings: overview.recipientSettings ?? null,
  };
}
