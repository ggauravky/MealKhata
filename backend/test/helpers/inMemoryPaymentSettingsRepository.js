function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export class InMemoryPaymentSettingsRepository {
  constructor() {
    this.document = null;
    this.failWrites = false;
  }

  reset() {
    this.document = null;
    this.failWrites = false;
  }

  async findPrimary() {
    return clone(this.document);
  }

  async create(settings) {
    if (this.failWrites) throw new Error('simulated settings outage');
    if (this.document) {
      const error = new Error('duplicate settings');
      error.code = 11000;
      throw error;
    }
    const timestamp = new Date();
    this.document = clone({ ...settings, createdAt: timestamp, updatedAt: timestamp });
    return clone(this.document);
  }

  async updateIfCurrent({ current, receiver, change }) {
    if (this.failWrites) throw new Error('simulated settings outage');
    if (!this.document || this.document.revision !== current.revision) return null;
    Object.assign(this.document, clone(receiver));
    this.document.revision += 1;
    this.document.changes.push(clone(change));
    this.document.updatedAt = new Date();
    return clone(this.document);
  }

  count() {
    return this.document ? 1 : 0;
  }
}

