/**
 * In-Memory Hostel Stay, Deposit & Clearance Repository for unit/integration testing
 */

import { STAY_STATUSES } from '../../src/stays/stay.constants.js';

export class InMemoryStayRepository {
  constructor() {
    this.stays = [];
    this.accounts = [];
    this.transactions = [];
    this.clearances = [];
  }

  reset() {
    this.stays = [];
    this.accounts = [];
    this.transactions = [];
    this.clearances = [];
  }

  // --- Stay Operations ---
  async createStay(data) {
    const doc = {
      ...data,
      revision: data.revision || 1,
      history: data.history || [],
      createdAt: data.createdAt || new Date(),
      updatedAt: data.updatedAt || new Date(),
    };
    this.stays.push(doc);
    return JSON.parse(JSON.stringify(doc));
  }

  async findStayById(stayId) {
    const stay = this.stays.find((s) => s.stayId === stayId);
    return stay ? JSON.parse(JSON.stringify(stay)) : null;
  }

  async findActiveStayForMember(memberId) {
    const active = this.stays.find(
      (s) =>
        s.memberId === memberId &&
        [
          STAY_STATUSES.ACTIVE,
          STAY_STATUSES.CHECKOUT_REQUESTED,
          STAY_STATUSES.CHECKOUT_PENDING,
        ].includes(s.status),
    );
    return active ? JSON.parse(JSON.stringify(active)) : null;
  }

  async findStaysByMember(memberId) {
    return this.stays
      .filter((s) => s.memberId === memberId)
      .sort((a, b) => (b.joinedOn || '').localeCompare(a.joinedOn || ''))
      .map((s) => JSON.parse(JSON.stringify(s)));
  }

  async listAllStays({ status = null, memberId = null } = {}) {
    return this.stays
      .filter((s) => {
        if (status && s.status !== status) return false;
        if (memberId && s.memberId !== memberId) return false;
        return true;
      })
      .sort((a, b) => (b.joinedOn || '').localeCompare(a.joinedOn || ''))
      .map((s) => JSON.parse(JSON.stringify(s)));
  }

  async updateStay(stayId, updates, expectedRevision = null) {
    const index = this.stays.findIndex((s) => {
      if (s.stayId !== stayId) return false;
      if (typeof expectedRevision === 'number' && s.revision !== expectedRevision) return false;
      return true;
    });

    if (index === -1) return null;

    this.stays[index] = {
      ...this.stays[index],
      ...updates,
      revision: (this.stays[index].revision || 1) + 1,
      updatedAt: new Date(),
    };
    return JSON.parse(JSON.stringify(this.stays[index]));
  }

  async addStayHistory(stayId, entry) {
    const index = this.stays.findIndex((s) => s.stayId === stayId);
    if (index === -1) return null;

    this.stays[index].history = this.stays[index].history || [];
    this.stays[index].history.push(entry);
    return JSON.parse(JSON.stringify(this.stays[index]));
  }

  async cancelStay(stayId, { reason, actorRole, expectedRevision, cancelledAt }) {
    const stay = this.stays.find((item) => item.stayId === stayId && item.revision === expectedRevision);
    if (!stay) return null;
    stay.status = STAY_STATUSES.CANCELLED;
    stay.currentRoomId = null;
    stay.cancelledAt = cancelledAt;
    stay.cancelledByRole = actorRole;
    stay.cancelReason = reason;
    stay.revision += 1;
    stay.history.push({
      event: 'STAY_CANCELLED',
      timestamp: cancelledAt,
      actorRole,
      note: reason,
      details: { expectedRevision },
    });
    return JSON.parse(JSON.stringify(stay));
  }

  async deleteStay(stayId) {
    const idx = this.stays.findIndex((s) => s.stayId === stayId);
    if (idx === -1) return null;
    const [deleted] = this.stays.splice(idx, 1);
    return JSON.parse(JSON.stringify(deleted));
  }

  // --- Deposit Account Operations ---
  async createDepositAccount(data) {
    const doc = {
      ...data,
      revision: data.revision || 1,
      history: data.history || [],
      createdAt: data.createdAt || new Date(),
      updatedAt: data.updatedAt || new Date(),
    };
    this.accounts.push(doc);
    return JSON.parse(JSON.stringify(doc));
  }

  async deleteDepositAccount(depositAccountId) {
    const idx = this.accounts.findIndex((a) => a.depositAccountId === depositAccountId);
    if (idx === -1) return null;
    const [deleted] = this.accounts.splice(idx, 1);
    return JSON.parse(JSON.stringify(deleted));
  }

  async findDepositAccountByStayId(stayId) {
    const acc = this.accounts.find((a) => a.stayId === stayId);
    return acc ? JSON.parse(JSON.stringify(acc)) : null;
  }

  async findDepositAccountById(depositAccountId) {
    const acc = this.accounts.find((a) => a.depositAccountId === depositAccountId);
    return acc ? JSON.parse(JSON.stringify(acc)) : null;
  }

  async updateDepositAccount(depositAccountId, updates, expectedRevision = null) {
    const index = this.accounts.findIndex((a) => {
      if (a.depositAccountId !== depositAccountId) return false;
      if (typeof expectedRevision === 'number' && a.revision !== expectedRevision) return false;
      return true;
    });

    if (index === -1) return null;

    this.accounts[index] = {
      ...this.accounts[index],
      ...updates,
      revision: (this.accounts[index].revision || 1) + 1,
      updatedAt: new Date(),
    };
    return JSON.parse(JSON.stringify(this.accounts[index]));
  }

  async addDepositAccountHistory(depositAccountId, entry) {
    const index = this.accounts.findIndex((a) => a.depositAccountId === depositAccountId);
    if (index === -1) return null;

    this.accounts[index].history = this.accounts[index].history || [];
    this.accounts[index].history.push(entry);
    return JSON.parse(JSON.stringify(this.accounts[index]));
  }

  // --- Deposit Transaction Operations ---
  async createDepositTransaction(data) {
    const doc = {
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.transactions.push(doc);
    return JSON.parse(JSON.stringify(doc));
  }

  async findDepositTransactionById(depositTransactionId) {
    const tx = this.transactions.find((t) => t.depositTransactionId === depositTransactionId);
    return tx ? JSON.parse(JSON.stringify(tx)) : null;
  }

  async findDepositTransactionByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    const tx = this.transactions.find((t) => t.idempotencyKey === idempotencyKey);
    return tx ? JSON.parse(JSON.stringify(tx)) : null;
  }

  async listDepositTransactionsByStayId(stayId, { includeVoided = false } = {}) {
    return this.transactions
      .filter((t) => {
        if (t.stayId !== stayId) return false;
        if (!includeVoided && t.status !== 'recorded') return false;
        return true;
      })
      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
      .map((t) => JSON.parse(JSON.stringify(t)));
  }

  async voidDepositTransaction(depositTransactionId, { voidReason, voidedByRole, voidedAt = new Date() }) {
    const index = this.transactions.findIndex(
      (t) => t.depositTransactionId === depositTransactionId && t.status === 'recorded',
    );
    if (index === -1) return null;

    this.transactions[index] = {
      ...this.transactions[index],
      status: 'voided',
      voidReason,
      voidedByRole,
      voidedAt,
      updatedAt: new Date(),
    };
    return JSON.parse(JSON.stringify(this.transactions[index]));
  }

  async executeAtomicDepositTransaction({
    stayId,
    type,
    amountPaise,
    transactionData,
    actorRole,
  }) {
    const account = this.accounts.find((a) => a.stayId === stayId);
    if (!account) {
      const err = new Error('Deposit account not found for this stay.');
      err.statusCode = 404;
      throw err;
    }
    const transactions = this.transactions.filter((t) => t.stayId === stayId && t.status === 'recorded');
    let received = 0;
    let refunded = 0;
    let deducted = 0;
    for (const tx of transactions) {
      if (tx.type === 'RECEIVED') received += tx.amountPaise;
      else if (tx.type === 'REFUNDED') refunded += tx.amountPaise;
      else if (tx.type === 'DEDUCTED') deducted += tx.amountPaise;
    }
    const heldPaise = received - refunded - deducted;
    if ((type === 'REFUNDED' || type === 'DEDUCTED') && heldPaise < amountPaise) {
      const action = type === 'REFUNDED' ? 'refund' : 'deduct';
      const err = new Error(`Cannot ${action} ₹${(amountPaise / 100).toFixed(2)}: only ₹${(heldPaise / 100).toFixed(2)} currently held.`);
      err.statusCode = 400;
      err.details = { heldPaise, requestedPaise: amountPaise };
      throw err;
    }

    if (transactionData.idempotencyKey) {
      const dup = this.transactions.find((t) => t.idempotencyKey === transactionData.idempotencyKey);
      if (dup) {
        if (dup.type !== type || dup.amountPaise !== amountPaise || dup.stayId !== stayId) {
          const err = new Error('Idempotency key has already been used with a different transaction payload.');
          err.statusCode = 409;
          throw err;
        }
        return JSON.parse(JSON.stringify(dup));
      }
    }

    account.revision = (account.revision || 1) + 1;
    account.history = account.history || [];
    account.history.push({
      event: `DEPOSIT_${type}`,
      timestamp: new Date(),
      actorRole,
      note: `Recorded ${type} transaction of ${amountPaise} paise`,
      details: { depositTransactionId: transactionData.depositTransactionId, amountPaise, method: transactionData.method },
    });
    const nextHeld = heldPaise + (type === 'RECEIVED' ? amountPaise : -amountPaise);
    const nextReceived = received + (type === 'RECEIVED' ? amountPaise : 0);
    if (nextHeld === 0 && nextReceived > 0) {
      account.status = 'SETTLED';
    }

    const doc = {
      ...transactionData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.transactions.push(doc);
    return JSON.parse(JSON.stringify(doc));
  }

  async executeAtomicDepositVoid({
    stayId,
    depositTransactionId,
    reason,
    actorRole,
  }) {
    const tx = this.transactions.find((t) => t.depositTransactionId === depositTransactionId);
    if (!tx || (stayId && tx.stayId !== stayId)) {
      const err = new Error('Deposit transaction not found or does not belong to this stay.');
      err.statusCode = 404;
      throw err;
    }
    if (tx.status === 'voided') {
      const err = new Error('Deposit transaction is already voided.');
      err.statusCode = 400;
      throw err;
    }
    const targetStayId = tx.stayId || stayId;
    if (tx.type === 'RECEIVED') {
      const allActive = this.transactions.filter(
        (t) => t.stayId === targetStayId && t.status === 'recorded',
      );
      let received = 0;
      let refunded = 0;
      let deducted = 0;
      for (const item of allActive) {
        if (item.type === 'RECEIVED') received += item.amountPaise;
        else if (item.type === 'REFUNDED') refunded += item.amountPaise;
        else if (item.type === 'DEDUCTED') deducted += item.amountPaise;
      }
      const currentHeld = received - refunded - deducted;
      if (currentHeld < tx.amountPaise) {
        const err = new Error(`Cannot void receipt: ₹${((tx.amountPaise - currentHeld) / 100).toFixed(2)} has already been refunded or deducted.`);
        err.statusCode = 400;
        throw err;
      }
    }

    tx.status = 'voided';
    tx.voidReason = reason.trim();
    tx.voidedByRole = actorRole;
    tx.voidedAt = new Date();
    tx.updatedAt = new Date();

    const account = this.accounts.find((a) => a.stayId === targetStayId);
    if (account) {
      account.revision = (account.revision || 1) + 1;
      account.history = account.history || [];
      account.history.push({
        event: 'DEPOSIT_TRANSACTION_VOIDED',
        timestamp: new Date(),
        actorRole,
        note: `Voided transaction ${depositTransactionId}: ${reason}`,
        details: { depositTransactionId, originalType: tx.type, amountPaise: tx.amountPaise },
      });
    }

    return JSON.parse(JSON.stringify(tx));
  }

  // --- Clearance Operations ---
  async createClearance(data) {
    const doc = {
      ...data,
      createdAt: new Date(),
    };
    this.clearances.push(doc);
    return JSON.parse(JSON.stringify(doc));
  }

  async findClearancesByStayId(stayId) {
    return this.clearances
      .filter((c) => c.stayId === stayId)
      .sort((a, b) => b.sequence - a.sequence)
      .map((c) => JSON.parse(JSON.stringify(c)));
  }

  async findClearanceById(clearanceId) {
    const clearance = this.clearances.find((c) => c.clearanceId === clearanceId);
    return clearance ? JSON.parse(JSON.stringify(clearance)) : null;
  }

  async getNextClearanceSequence(stayId) {
    const list = this.clearances.filter((c) => c.stayId === stayId).sort((a, b) => b.sequence - a.sequence);
    return list.length > 0 ? list[0].sequence + 1 : 1;
  }
}
