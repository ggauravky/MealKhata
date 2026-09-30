import crypto from 'node:crypto';

export class InMemoryPushSubscriptionRepository {
  constructor(initial = []) {
    this.subscriptions = new Map();
    for (const item of initial) {
      this.subscriptions.set(item.endpoint, { ...item });
    }
  }

  reset(initial = []) {
    this.subscriptions.clear();
    for (const item of initial) {
      this.subscriptions.set(item.endpoint, { ...item });
    }
  }

  async findByEndpoint(endpoint) {
    const sub = this.subscriptions.get(endpoint);
    return sub ? { ...sub } : null;
  }

  async findActiveByMemberId(memberId) {
    return Array.from(this.subscriptions.values())
      .filter((s) => s.memberId === memberId && s.active)
      .map((s) => ({ ...s }));
  }

  async findAllActive() {
    return Array.from(this.subscriptions.values())
      .filter((s) => s.active)
      .map((s) => ({ ...s }));
  }

  async upsertSubscription({
    memberId,
    endpoint,
    keys,
    expirationTime = null,
    preferences = { morning: true, night: true },
    userAgent = null,
  }) {
    const existing = this.subscriptions.get(endpoint);
    const subscriptionId = existing?.subscriptionId || crypto.randomUUID();

    const record = {
      subscriptionId,
      memberId,
      endpoint,
      keys: { ...keys },
      expirationTime,
      preferences: {
        morning: preferences?.morning !== false,
        night: preferences?.night !== false,
      },
      active: true,
      userAgent,
      lastSuccessAt: existing?.lastSuccessAt || null,
      lastFailureAt: null,
      failureCount: 0,
      createdAt: existing?.createdAt || new Date(),
      updatedAt: new Date(),
    };

    this.subscriptions.set(endpoint, record);
    return { ...record };
  }

  async updatePreferences({ endpoint, memberId, preferences }) {
    const existing = this.subscriptions.get(endpoint);
    if (!existing || existing.memberId !== memberId || !existing.active) {
      return null;
    }

    if (typeof preferences?.morning === 'boolean') {
      existing.preferences.morning = preferences.morning;
    }
    if (typeof preferences?.night === 'boolean') {
      existing.preferences.night = preferences.night;
    }
    existing.updatedAt = new Date();
    return { ...existing };
  }

  async deactivate(endpoint) {
    const existing = this.subscriptions.get(endpoint);
    if (!existing) return null;
    existing.active = false;
    existing.lastFailureAt = new Date();
    existing.updatedAt = new Date();
    return { ...existing };
  }

  async deleteByMemberAndEndpoint(memberId, endpoint) {
    const existing = this.subscriptions.get(endpoint);
    if (existing && existing.memberId === memberId) {
      this.subscriptions.delete(endpoint);
      return true;
    }
    return false;
  }

  async recordSuccess(subscriptionId) {
    for (const sub of this.subscriptions.values()) {
      if (sub.subscriptionId === subscriptionId) {
        sub.lastSuccessAt = new Date();
        sub.failureCount = 0;
        break;
      }
    }
  }

  async recordFailure(subscriptionId) {
    for (const sub of this.subscriptions.values()) {
      if (sub.subscriptionId === subscriptionId) {
        sub.lastFailureAt = new Date();
        sub.failureCount = (sub.failureCount || 0) + 1;
        break;
      }
    }
  }
}
