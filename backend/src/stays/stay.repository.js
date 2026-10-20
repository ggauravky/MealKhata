/**
 * MealKhata 2.0 - Hostel Stay, Deposit & Clearance Repository
 */

import {
  HostelClearance,
  HostelDepositAccount,
  HostelDepositTransaction,
  HostelStay,
} from './stay.model.js';
import { STAY_STATUSES } from './stay.constants.js';

export const stayRepository = {
  // ----------------------------------------------------
  // Hostel Stay Operations
  // ----------------------------------------------------
  async createStay(data) {
    const stay = await HostelStay.create(data);
    return stay.toObject();
  },

  async findStayById(stayId) {
    return HostelStay.findOne({ stayId }).lean();
  },

  async findActiveStayForMember(memberId) {
    return HostelStay.findOne({
      memberId,
      status: {
        $in: [
          STAY_STATUSES.ACTIVE,
          STAY_STATUSES.CHECKOUT_REQUESTED,
          STAY_STATUSES.CHECKOUT_PENDING,
        ],
      },
    }).lean();
  },

  async findStaysByMember(memberId) {
    return HostelStay.find({ memberId }).sort({ joinedOn: -1 }).lean();
  },

  async listAllStays({ status = null, memberId = null } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (memberId) filter.memberId = memberId;
    return HostelStay.find(filter).sort({ joinedOn: -1 }).lean();
  },

  async updateStay(stayId, updates, expectedRevision = null) {
    const query = { stayId };
    if (typeof expectedRevision === 'number') {
      query.revision = expectedRevision;
    }

    const doc = await HostelStay.findOneAndUpdate(
      query,
      {
        $set: updates,
        $inc: { revision: 1 },
      },
      { returnDocument: 'after', runValidators: true },
    ).lean();

    return doc;
  },

  async addStayHistory(stayId, entry) {
    return HostelStay.findOneAndUpdate(
      { stayId },
      { $push: { history: entry } },
      { returnDocument: 'after' },
    ).lean();
  },

  // ----------------------------------------------------
  // Security Deposit Account Operations
  // ----------------------------------------------------
  async createDepositAccount(data) {
    const account = await HostelDepositAccount.create(data);
    return account.toObject();
  },

  async findDepositAccountByStayId(stayId) {
    return HostelDepositAccount.findOne({ stayId }).lean();
  },

  async findDepositAccountById(depositAccountId) {
    return HostelDepositAccount.findOne({ depositAccountId }).lean();
  },

  async updateDepositAccount(depositAccountId, updates, expectedRevision = null) {
    const query = { depositAccountId };
    if (typeof expectedRevision === 'number') {
      query.revision = expectedRevision;
    }

    return HostelDepositAccount.findOneAndUpdate(
      query,
      {
        $set: updates,
        $inc: { revision: 1 },
      },
      { returnDocument: 'after', runValidators: true },
    ).lean();
  },

  async addDepositAccountHistory(depositAccountId, entry) {
    return HostelDepositAccount.findOneAndUpdate(
      { depositAccountId },
      { $push: { history: entry } },
      { returnDocument: 'after' },
    ).lean();
  },

  // ----------------------------------------------------
  // Security Deposit Transaction Operations
  // ----------------------------------------------------
  async createDepositTransaction(data) {
    const tx = await HostelDepositTransaction.create(data);
    return tx.toObject();
  },

  async findDepositTransactionById(depositTransactionId) {
    return HostelDepositTransaction.findOne({ depositTransactionId }).lean();
  },

  async findDepositTransactionByIdempotencyKey(idempotencyKey) {
    return HostelDepositTransaction.findOne({ idempotencyKey }).lean();
  },

  async listDepositTransactionsByStayId(stayId, { includeVoided = false } = {}) {
    const filter = { stayId };
    if (!includeVoided) filter.status = 'recorded';
    return HostelDepositTransaction.find(filter).sort({ recordedAt: -1 }).lean();
  },

  async voidDepositTransaction(depositTransactionId, { voidReason, voidedByRole, voidedAt = new Date() }) {
    return HostelDepositTransaction.findOneAndUpdate(
      { depositTransactionId, status: 'recorded' },
      {
        $set: {
          status: 'voided',
          voidReason,
          voidedByRole,
          voidedAt,
        },
      },
      { returnDocument: 'after' },
    ).lean();
  },

  // ----------------------------------------------------
  // Hostel Clearance Operations
  // ----------------------------------------------------
  async createClearance(data) {
    const clearance = await HostelClearance.create(data);
    return clearance.toObject();
  },

  async findClearancesByStayId(stayId) {
    return HostelClearance.find({ stayId }).sort({ sequence: -1 }).lean();
  },

  async findClearanceById(clearanceId) {
    return HostelClearance.findOne({ clearanceId }).lean();
  },

  async getNextClearanceSequence(stayId) {
    const latest = await HostelClearance.findOne({ stayId }).sort({ sequence: -1 }).lean();
    return latest ? latest.sequence + 1 : 1;
  },
};
