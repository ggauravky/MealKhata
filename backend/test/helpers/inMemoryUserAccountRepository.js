function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export class InMemoryUserAccountRepository {
  constructor() {
    this.accounts = new Map();
  }

  reset() {
    this.accounts.clear();
  }

  async create(user) {
    const doc = clone({
      userId: user.userId,
      email: user.email.toLowerCase(),
      passwordHash: user.passwordHash,
      role: user.role,
      memberId: user.memberId ?? null,
      displayName: user.displayName ?? null,
      active: user.active !== false,
      sessionVersion: user.sessionVersion ?? 0,
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.accounts.set(doc.userId, doc);
    return clone(doc);
  }

  async findByEmail(email) {
    const normalized = email?.toLowerCase().trim();
    for (const doc of this.accounts.values()) {
      if (doc.email.toLowerCase() === normalized) {
        return clone(doc);
      }
    }
    return null;
  }

  async findByUserId(userId) {
    const doc = this.accounts.get(userId);
    return doc ? clone(doc) : null;
  }

  async findByMemberId(memberId) {
    for (const doc of this.accounts.values()) {
      if (doc.memberId === memberId) {
        return clone(doc);
      }
    }
    return null;
  }

  async listAll() {
    return Array.from(this.accounts.values()).map(clone);
  }

  async count() {
    return this.accounts.size;
  }

  async updateLastLogin(userId, loginTime = new Date()) {
    const doc = this.accounts.get(userId);
    if (!doc) return null;
    doc.lastLoginAt = loginTime;
    return clone(doc);
  }

  async incrementSessionVersion(userId) {
    const doc = this.accounts.get(userId);
    if (!doc) return null;
    doc.sessionVersion = (doc.sessionVersion ?? 0) + 1;
    return clone(doc);
  }

  async setActive(userId, active) {
    const doc = this.accounts.get(userId);
    if (!doc) return null;
    doc.active = Boolean(active);
    return clone(doc);
  }
}
