function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export class InMemoryPaymentRepository {
  constructor() {
    this.documents = new Map();
    this.failWrites = false;
  }

  reset() {
    this.documents.clear();
    this.failWrites = false;
  }

  async findByMonth(month) {
    return [...this.documents.values()]
      .filter((payment) => payment.month === month)
      .sort((left, right) => new Date(right.recordedAt) - new Date(left.recordedAt))
      .map(clone);
  }

  async findHistoryByMonth(month) {
    return this.findByMonth(month);
  }

  async findSummaryByMonth(month) {
    return this.findByMonth(month);
  }

  async findByPaymentId(paymentId) {
    return clone([...this.documents.values()].find((payment) => payment.paymentId === paymentId) ?? null);
  }

  async findByIdempotencyKey(idempotencyKey) {
    return clone(this.documents.get(idempotencyKey) ?? null);
  }

  async create(payment) {
    if (this.failWrites) throw new Error('simulated payment outage');
    if (this.documents.has(payment.idempotencyKey)) {
      const error = new Error('duplicate idempotency key');
      error.code = 11000;
      throw error;
    }
    const timestamp = new Date();
    const document = clone({ ...payment, createdAt: timestamp, updatedAt: timestamp });
    this.documents.set(payment.idempotencyKey, document);
    return clone(document);
  }

  async voidIfRecorded({ paymentId, voidedAt, voidedByRole, voidReason }) {
    if (this.failWrites) throw new Error('simulated payment outage');
    const entry = [...this.documents.values()].find((payment) => payment.paymentId === paymentId);
    if (!entry || entry.status !== 'recorded') return null;
    Object.assign(entry, { status: 'voided', voidedAt, voidedByRole, voidReason, updatedAt: voidedAt });
    return clone(entry);
  }

  count() {
    return this.documents.size;
  }
}
