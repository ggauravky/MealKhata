function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value);
}

export class InMemoryReminderSettingsRepository {
  constructor() {
    this.reset();
  }

  reset() {
    this.document = null;
  }

  async findPrimary() {
    return clone(this.document);
  }

  async create(settings) {
    if (this.document) {
      const error = new Error('duplicate singleton');
      error.code = 11000;
      throw error;
    }
    const now = new Date();
    this.document = { ...clone(settings), createdAt: now, updatedAt: now };
    return clone(this.document);
  }

  async updateIfCurrent({ current, reminders, change }) {
    if (!this.document || this.document.revision !== current.revision) return null;
    this.document.reminders = clone(reminders);
    this.document.revision += 1;
    this.document.changes.push(clone(change));
    this.document.updatedAt = new Date();
    return clone(this.document);
  }
}
