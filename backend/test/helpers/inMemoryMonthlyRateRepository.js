function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export class InMemoryMonthlyRateRepository {
  constructor() {
    this.documents = new Map();
    this.failWrites = false;
  }

  reset() {
    this.documents.clear();
    this.failWrites = false;
  }

  async findByMonth(month) {
    return clone(this.documents.get(month) ?? null);
  }

  async create(rate) {
    if (this.failWrites) {
      throw new Error('simulated rate database outage');
    }

    if (this.documents.has(rate.month)) {
      const error = new Error('duplicate logical month');
      error.code = 11000;
      throw error;
    }

    const timestamp = new Date();
    const document = clone({ ...rate, createdAt: timestamp, updatedAt: timestamp });
    this.documents.set(rate.month, document);
    return clone(document);
  }

  async updateIfCurrent({ month, current, prices, change }) {
    if (this.failWrites) {
      throw new Error('simulated rate database outage');
    }

    const document = this.documents.get(month);

    if (
      !document ||
      document.revision !== current.revision ||
      document.morningPricePaise !== current.morningPricePaise ||
      document.nightPricePaise !== current.nightPricePaise
    ) {
      return null;
    }

    Object.assign(document, clone(prices));
    document.revision += 1;
    document.changes.push(clone(change));
    document.updatedAt = new Date();
    return clone(document);
  }

  count() {
    return this.documents.size;
  }
}

