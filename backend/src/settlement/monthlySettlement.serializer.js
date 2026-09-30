export function serializeSettlement(doc) {
  if (!doc) return null;

  return {
    settlementId: doc.settlementId,
    month: doc.month,
    sequence: doc.sequence,
    status: doc.status,
    snapshotVersion: doc.snapshotVersion ?? 1,
    snapshot: doc.snapshot,
    closedAt: doc.closedAt ? new Date(doc.closedAt).toISOString() : null,
    closedByRole: doc.closedByRole,
    reopenedAt: doc.reopenedAt ? new Date(doc.reopenedAt).toISOString() : null,
    reopenedByRole: doc.reopenedByRole ?? null,
    reopenReason: doc.reopenReason ?? null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

export function serializeSettlementHistory(docs = []) {
  return docs.map(serializeSettlement);
}
