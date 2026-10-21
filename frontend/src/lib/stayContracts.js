function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function parseMyStayResponse(payload) {
  const envelope = asObject(payload);
  const stay = envelope.data && typeof envelope.data === 'object' ? envelope.data : null;

  return {
    configured: Boolean(envelope.configured ?? stay),
    isActive: Boolean(envelope.isActive),
    stay,
  };
}

export function mapDepositSummary(payload) {
  const deposit = asObject(payload);
  const account = deposit.account && typeof deposit.account === 'object' ? deposit.account : null;
  const summary = asObject(deposit.summary);

  return {
    account,
    expectedDepositPaise: summary.expectedPaise ?? account?.expectedDepositPaise ?? 0,
    depositReceivedPaise: summary.receivedPaise ?? 0,
    depositDeductedPaise: summary.deductedPaise ?? 0,
    depositRefundedPaise: summary.refundedPaise ?? 0,
    depositHeldPaise: summary.heldPaise ?? 0,
    transactions: asArray(deposit.transactions),
  };
}

export function mapRoomHistory(payload) {
  const history = asObject(payload);
  const rows = Array.isArray(payload) ? payload : asArray(history.timeline);

  return rows.map((item) => {
    const row = asObject(item);
    const roomNumber = row.roomNumber ?? row.room?.roomNumber ?? row.roomId ?? 'Unknown';
    const startMonth = row.startMonth ?? row.effectiveFromMonth ?? row.effectiveFromDate?.slice(0, 7) ?? null;
    const endMonth = row.endMonth ?? row.effectiveUntilMonth ?? row.effectiveUntilDate?.slice(0, 7) ?? null;
    return {
      assignmentId: row.assignmentId ?? null,
      roomId: row.roomId ?? null,
      roomNumber,
      startMonth,
      endMonth,
      monthlyRentPaise: row.monthlyRentPaise ?? row.monthlyRatePaise ?? 0,
      occupancy: row.occupancy ?? null,
      reason: row.reason ?? null,
      isCurrent: row.isCurrent ?? !endMonth,
    };
  });
}

export function mapLifetimeSummary(payload) {
  const report = asObject(payload);
  const totals = asObject(report.lifetimeTotals);
  const mess = asObject(totals.mess);
  const room = asObject(totals.room);
  const expenses = asObject(totals.expenses);

  return {
    stayDurationMonths: report.summary?.totalMonths ?? report.duration?.totalMonths ?? 0,
    mess: {
      totalBilledPaise: mess.billedPaise ?? 0,
      totalPaidPaise: mess.paidPaise ?? 0,
      outstandingPaise: mess.remainingPaise ?? 0,
    },
    roomFees: {
      totalIssuedPaise: room.billedPaise ?? 0,
      totalPaidPaise: room.paidPaise ?? 0,
      outstandingPaise: room.remainingPaise ?? 0,
      monthsIssuedCount: room.issuedMonths ?? 0,
      fullyPaidMonthsCount: room.fullyPaidMonths ?? 0,
      partiallyPaidMonthsCount: room.partialMonths ?? 0,
      unpaidMonthsCount: room.unpaidMonths ?? 0,
    },
    expenses: {
      totalSharePaise: expenses.spendingSharePaise ?? 0,
      reimbursementsOwedPaise: expenses.owedToOthersPaise ?? 0,
      reimbursementsReceivablePaise: expenses.owedToMePaise ?? 0,
    },
    deposit: mapDepositSummary(report.depositOverview),
    attributionWarnings: asArray(report.attributionWarnings).map((warning) => ({
      domain: warning?.domain || 'UNKNOWN',
      month: warning?.month || null,
      message: warning?.message || 'This financial period requires manual review.',
    })),
    isAttributionComplete: report.isAttributionComplete !== false,
    monthlyBreakdown: asArray(report.monthlySummaries).map((item) => ({
      month: item?.month,
      messBilledPaise: item?.mess?.billPaise ?? 0,
      messPaidPaise: item?.mess?.paidPaise ?? 0,
      messDuePaise: item?.mess?.remainingPaise ?? 0,
      roomIssuedPaise: item?.room?.issuedChargePaise ?? 0,
      roomPaidPaise: item?.room?.paidPaise ?? 0,
      roomDuePaise: item?.room?.remainingPaise ?? 0,
      expenseSharePaise: item?.expenses?.spendingSharePaise ?? 0,
      expenseOwedPaise: item?.expenses?.owedToOthersPaise ?? 0,
    })),
  };
}

export function mapCheckoutReview(payload) {
  const review = asObject(payload);
  const overview = asObject(review.financialOverview);
  const mess = asObject(overview.mess);
  const room = asObject(overview.room);
  const expenses = asObject(overview.expenses);
  const warnings = asArray(review.attributionWarnings).map((warning) => ({
    domain: warning?.domain || 'UNKNOWN',
    month: warning?.month || null,
    message: warning?.message || 'This financial period requires manual review.',
  }));

  return {
    messSummary: {
      totalBilledPaise: review.totalMessBilledPaise ?? mess.billPaise ?? 0,
      totalPaidPaise: review.totalMessPaidPaise ?? mess.paidPaise ?? 0,
      outstandingPaise: review.totalMessRemainingPaise ?? mess.remainingPaise ?? 0,
    },
    roomFeeSummary: {
      totalIssuedPaise: review.totalRoomBilledPaise ?? room.issuedChargePaise ?? 0,
      totalPaidPaise: review.totalRoomPaidPaise ?? room.paidPaise ?? 0,
      outstandingPaise: review.totalRoomRemainingPaise ?? room.remainingPaise ?? 0,
    },
    expenseSummary: {
      totalSharePaise: review.totalExpenseSharePaise ?? expenses.spendingSharePaise ?? 0,
      reimbursementsOwedPaise: review.totalExpenseOwedPaise ?? expenses.owedToOthersPaise ?? 0,
      reimbursementsReceivablePaise:
        review.totalExpenseReceivablePaise ?? expenses.owedToMePaise ?? 0,
    },
    deposit: mapDepositSummary(review.depositOverview),
    attributionWarnings: warnings,
    isAttributionComplete: review.isAttributionComplete !== false && warnings.length === 0,
    isEligibleForNoDues: review.isEligibleForNoDues === true,
  };
}
