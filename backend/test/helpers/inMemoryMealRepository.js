function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function getPathValue(document, path) {
  return path.split('.').reduce((value, key) => value?.[key], document);
}

function setPathValue(document, path, value) {
  const keys = path.split('.');
  const finalKey = keys.pop();
  const target = keys.reduce((current, key) => current[key], document);
  target[finalKey] = value;
}

export class InMemoryMealRepository {
  constructor() {
    this.documents = new Map();
    this.failWrites = false;
    this.bulkFindCalls = 0;
  }

  reset() {
    this.documents.clear();
    this.failWrites = false;
    this.bulkFindCalls = 0;
  }

  async findByDate(date) {
    return clone(this.documents.get(date) ?? null);
  }

  async findInDateRange(startDate, endDate) {
    this.bulkFindCalls += 1;
    return [...this.documents.values()]
      .filter(({ date }) => date >= startDate && date <= endDate)
      .map(clone);
  }

  async create(day) {
    if (this.failWrites) {
      throw new Error('simulated database outage');
    }

    if (this.documents.has(day.date)) {
      const error = new Error('duplicate logical date');
      error.code = 11000;
      throw error;
    }

    const timestamp = new Date();
    const document = clone({ ...day, createdAt: timestamp, updatedAt: timestamp });
    this.documents.set(day.date, document);
    return clone(document);
  }

  async updateIfCurrent({ date, path, from, to, revision, change }) {
    if (this.failWrites) {
      throw new Error('simulated database outage');
    }

    const document = this.documents.get(date);

    if (!document || document.revision !== revision || getPathValue(document, path) !== from) {
      return null;
    }

    setPathValue(document, path, to);
    document.revision += 1;
    document.changes.push(clone(change));
    document.updatedAt = new Date();
    return clone(document);
  }

  count() {
    return this.documents.size;
  }
}
