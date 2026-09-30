function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export class InMemoryMonthlySettlementRepository {
  constructor() {
    this.documents = [];
    this.failWrites = false;
  }

  reset() {
    this.documents.length = 0;
    this.failWrites = false;
  }

  async findActiveByMonth(month) {
    const found = this.documents.find((doc) => doc.month === month && doc.status === 'closed');
    return clone(found ?? null);
  }

  async findLatestByMonth(month) {
    const list = this.documents
      .filter((doc) => doc.month === month)
      .sort((a, b) => b.sequence - a.sequence);
    return clone(list[0] ?? null);
  }

  async findHistoryByMonth(month) {
    return this.documents
      .filter((doc) => doc.month === month)
      .sort((a, b) => b.sequence - a.sequence)
      .map(clone);
  }

  async findBySettlementId(settlementId) {
    const found = this.documents.find((doc) => doc.settlementId === settlementId);
    return clone(found ?? null);
  }

  async createSettlement({
    settlementId,
    month,
    sequence,
    snapshot,
    closedAt = new Date(),
    closedByRole = 'superadmin',
  }) {
    if (this.failWrites) throw new Error('simulated settlement outage');

    // enforce uniqueness of active closed settlement for month
    const existingActive = this.documents.find((doc) => doc.month === month && doc.status === 'closed');
    if (existingActive) {
      const err = new Error('Month already has an active closed settlement');
      err.code = 11000;
      throw err;
    }

    const doc = {
      settlementId,
      month,
      sequence,
      status: 'closed',
      snapshotVersion: 1,
      snapshot: clone(snapshot),
      closedAt,
      closedByRole,
      reopenedAt: null,
      reopenedByRole: null,
      reopenReason: null,
      createdAt: closedAt,
      updatedAt: closedAt,
    };

    this.documents.push(doc);
    return clone(doc);
  }

  async reopenSettlement({ settlementId, reopenedAt = new Date(), reopenedByRole = 'superadmin', reopenReason }) {
    if (this.failWrites) throw new Error('simulated settlement outage');

    const index = this.documents.findIndex((doc) => doc.settlementId === settlementId && doc.status === 'closed');
    if (index === -1) return null;

    const doc = this.documents[index];
    doc.status = 'reopened';
    doc.reopenedAt = reopenedAt;
    doc.reopenedByRole = reopenedByRole;
    doc.reopenReason = reopenReason;
    doc.updatedAt = reopenedAt;

    return clone(doc);
  }
}
