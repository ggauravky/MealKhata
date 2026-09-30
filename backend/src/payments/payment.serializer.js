function serializeDate(value) {
  return value ? new Date(value).toISOString() : null;
}

export function serializePayment(document, { includeReference = false } = {}) {
  const result = {
    paymentId: document.paymentId,
    month: document.month,
    memberId: document.memberId,
    amountPaise: document.amountPaise,
    method: document.method,
    recordedAt: serializeDate(document.recordedAt),
    status: document.status,
    voidedAt: serializeDate(document.voidedAt),
    voidReason: document.voidReason ?? null,
  };

  if (includeReference) {
    result.upiReference = document.upiReference ?? null;
    result.recordedByRole = document.recordedByRole;
    result.recordedByMemberId = document.recordedByMemberId ?? null;
    result.voidedByRole = document.voidedByRole ?? null;
  }

  return result;
}
