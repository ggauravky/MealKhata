/**
 * MealKhata 2.0 - Hostel Stay, Deposit & Clearance Repository
 */

import mongoose from 'mongoose';
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

  async deleteStay(stayId) {
    return HostelStay.findOneAndDelete({ stayId }).lean();
  },

  // ----------------------------------------------------
  // Security Deposit Account Operations
  // ----------------------------------------------------
  async createDepositAccount(data) {
    const account = await HostelDepositAccount.create(data);
    return account.toObject();
  },

  async deleteDepositAccount(depositAccountId) {
    return HostelDepositAccount.findOneAndDelete({ depositAccountId }).lean();
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

  async executeAtomicDepositTransaction({
    stayId,
    type,
    amountPaise,
    transactionData,
    actorRole,
  }) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      let session = null;
      try {
        session = await mongoose.startSession();
        session.startTransaction();

        const account = await HostelDepositAccount.findOne({ stayId }).session(session);
        if (!account) {
          const err = new Error('Deposit account not found for this stay.');
          err.statusCode = 404;
          throw err;
        }

        const transactions = await HostelDepositTransaction.find({
          stayId,
          status: 'recorded',
        }).session(session);

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

        account.revision += 1;
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
        await account.save({ session });

        const created = await HostelDepositTransaction.create([transactionData], { session });
        await session.commitTransaction();
        return created[0].toObject();
      } catch (err) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }
        if (err.message && (err.message.includes('Transactions are not supported') || err.message.includes('replica set'))) {
          // Fall through to non-session fallback
        } else {
          throw err;
        }
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    }

    const account = await HostelDepositAccount.findOne({ stayId });
    if (!account) {
      const err = new Error('Deposit account not found for this stay.');
      err.statusCode = 404;
      throw err;
    }
    const transactions = await HostelDepositTransaction.find({ stayId, status: 'recorded' });
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
    account.revision += 1;
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
    await account.save();
    const created = await HostelDepositTransaction.create(transactionData);
    return created.toObject();
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
