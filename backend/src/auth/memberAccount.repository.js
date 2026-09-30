import mongoose from 'mongoose';
import { MemberAccount } from './memberAccount.model.js';

function toPlainObject(document) {
  return document?.toObject ? document.toObject() : document;
}

export const memberAccountRepository = Object.freeze({
  async findByEmail(email) {
    const normalized = email?.trim().toLowerCase();
    if (!normalized || mongoose.connection.readyState === 0) {
      return null;
    }
    return MemberAccount.findOne({ email: normalized }).lean().exec();
  },

  async findByMemberId(memberId) {
    if (!memberId || mongoose.connection.readyState === 0) {
      return null;
    }
    return MemberAccount.findOne({ memberId }).lean().exec();
  },

  async findAll() {
    if (mongoose.connection.readyState === 0) {
      return [];
    }
    return MemberAccount.find({}).lean().exec();
  },

  async upsertAccount({ memberId, email, passwordHash, active = true }) {
    const normalizedEmail = email.trim().toLowerCase();
    const document = await MemberAccount.findOneAndUpdate(
      { memberId },
      {
        $set: {
          email: normalizedEmail,
          passwordHash,
          active,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    return toPlainObject(document);
  },
});
