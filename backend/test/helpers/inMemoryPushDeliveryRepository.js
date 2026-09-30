export class InMemoryPushDeliveryRepository {
  constructor() {
    this.deliveries = new Map();
  }

  reset() {
    this.deliveries.clear();
  }

  async claimDispatch({ dispatchKey, memberId, mealType, logicalDate, subscriptionId }) {
    if (this.deliveries.has(dispatchKey)) {
      return null; // Atomic duplicate check
    }

    const record = {
      dispatchKey,
      memberId,
      mealType,
      logicalDate,
      subscriptionId,
      status: 'claimed',
      sentAt: null,
      error: null,
      createdAt: new Date(),
    };

    this.deliveries.set(dispatchKey, record);
    return { ...record };
  }

  async markSent(dispatchKey, sentAt = new Date()) {
    const existing = this.deliveries.get(dispatchKey);
    if (existing) {
      existing.status = 'sent';
      existing.sentAt = sentAt;
    }
  }

  async markFailed(dispatchKey, error = null) {
    const existing = this.deliveries.get(dispatchKey);
    if (existing) {
      existing.status = 'failed';
      existing.error = error?.slice?.(0, 500) || null;
    }
  }

  async markGone(dispatchKey) {
    const existing = this.deliveries.get(dispatchKey);
    if (existing) {
      existing.status = 'gone';
      existing.error = 'Subscription expired (404/410)';
    }
  }

  async findByDispatchKey(dispatchKey) {
    const existing = this.deliveries.get(dispatchKey);
    return existing ? { ...existing } : null;
  }
}
