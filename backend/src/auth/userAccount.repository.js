import mongoose from 'mongoose';
import { UserAccount as UserAccountModel } from './userAccount.model.js';

export function createUserAccountRepository({ model = UserAccountModel } = {}) {
  const isConnected = () => mongoose.connection?.readyState === 1;

  return Object.freeze({
    async findByEmail(email, { includePasswordHash = false } = {}) {
      if (!isConnected()) return null;
      const normalizedEmail = email?.trim().toLowerCase();
      let query = model.findOne({ email: normalizedEmail });
      if (includePasswordHash) {
        query = query.select('+passwordHash');
      }
      return query.lean();
    },

    async findByUserId(userId, { includePasswordHash = false } = {}) {
      if (!isConnected()) return null;
      let query = model.findOne({ userId });
      if (includePasswordHash) {
        query = query.select('+passwordHash');
      }
      return query.lean();
    },

    async findByMemberId(memberId) {
      if (!isConnected()) return null;
      return model.findOne({ memberId }).lean();
    },

    async listAll() {
      if (!isConnected()) return [];
      return model.find({}).sort({ role: 1, memberId: 1 }).lean();
    },

    async count() {
      if (!isConnected()) return 0;
      return model.countDocuments();
    },

    async upsertUserAccount({
      userId,
      memberId = null,
      displayName,
      email,
      passwordHash,
      role,
      active = true,
      sessionVersion = 0,
    }) {
      const normalizedEmail = email.trim().toLowerCase();

      const updateData = {
        displayName,
        email: normalizedEmail,
        passwordHash,
        role,
        active,
        sessionVersion,
      };

      if (memberId !== undefined) {
        updateData.memberId = memberId;
      }

      const updated = await model.findOneAndUpdate(
        { email: normalizedEmail },
        {
          $set: updateData,
          $setOnInsert: { userId },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );

      return updated.toObject ? updated.toObject() : updated;
    },

    async updateLastLogin(userId, loginTime = new Date()) {
      if (!isConnected()) return null;
      return model.findOneAndUpdate(
        { userId },
        { $set: { lastLoginAt: loginTime } },
        { new: true },
      ).lean();
    },

    async incrementSessionVersion(userId) {
      if (!isConnected()) return null;
      return model.findOneAndUpdate(
        { userId },
        { $inc: { sessionVersion: 1 } },
        { new: true },
      ).lean();
    },

    async setActive(userId, active) {
      if (!isConnected()) return null;
      return model.findOneAndUpdate(
        { userId },
        { $set: { active: Boolean(active) } },
        { new: true },
      ).lean();
    },
  });
}

export const userAccountRepository = createUserAccountRepository();
