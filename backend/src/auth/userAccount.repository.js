import mongoose from 'mongoose';
import { UserAccount as UserAccountModel } from './userAccount.model.js';

export function createUserAccountRepository({ model = UserAccountModel } = {}) {
  const isConnected = () => mongoose.connection?.readyState === 1;
  const createAccount = async (data, { session = null } = {}) => {
    const normalized = { ...data, email: data.email.trim().toLowerCase() };
    if (session) {
      const created = await model.create([normalized], { session });
      return created[0].toObject();
    }
    const created = await model.create(normalized);
    return created.toObject();
  };

  return Object.freeze({
    async findByEmail(email, { includePasswordHash = false, session = null } = {}) {
      if (!isConnected()) return null;
      const normalizedEmail = email?.trim().toLowerCase();
      let query = model.findOne({ email: normalizedEmail });
      if (includePasswordHash) {
        query = query.select('+passwordHash');
      }
      if (session) query = query.session(session);
      return query.lean();
    },

    async findByUserId(userId, { includePasswordHash = false, session = null } = {}) {
      if (!isConnected()) return null;
      let query = model.findOne({ userId });
      if (includePasswordHash) {
        query = query.select('+passwordHash');
      }
      if (session) query = query.session(session);
      return query.lean();
    },

    async findByMemberId(memberId, { includePasswordHash = false, session = null } = {}) {
      if (!isConnected()) return null;
      let query = model.findOne({ memberId });
      if (includePasswordHash) query = query.select('+passwordHash');
      if (session) query = query.session(session);
      return query.lean();
    },

    async listAll() {
      if (!isConnected()) return [];
      return model.find({}).sort({ role: 1, memberId: 1 }).lean();
    },

    async count() {
      if (!isConnected()) return 0;
      return model.countDocuments();
    },

    createAccount,

    async updateEmail(userId, email, { session = null } = {}) {
      const options = { new: true, runValidators: true };
      if (session) options.session = session;
      return model.findOneAndUpdate(
        { userId },
        { $set: { email: email.trim().toLowerCase() }, $inc: { sessionVersion: 1 } },
        options,
      ).lean();
    },

    async updatePassword(userId, passwordHash, passwordChangedAt, { session = null } = {}) {
      const options = { new: true, runValidators: true };
      if (session) options.session = session;
      return model.findOneAndUpdate(
        { userId },
        {
          $set: { passwordHash, passwordChangedAt },
          $inc: { sessionVersion: 1 },
        },
        options,
      ).lean();
    },

    async listByRoles(roles) {
      if (!isConnected()) return [];
      return model.find({ role: { $in: roles } }).sort({ role: -1, createdAt: 1 }).lean();
    },

    async updateDisplayName(userId, displayName, { session = null } = {}) {
      const options = { new: true, runValidators: true };
      if (session) options.session = session;
      return model.findOneAndUpdate({ userId }, { $set: { displayName } }, options).lean();
    },

    createMemberAccount: createAccount,

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

    async setActive(userId, active, { session = null } = {}) {
      if (!isConnected()) return null;
      const options = { new: true };
      if (session) options.session = session;
      return model.findOneAndUpdate(
        { userId },
        { $set: { active: Boolean(active) }, $inc: { sessionVersion: 1 } },
        options,
      ).lean();
    },
  });
}

export const userAccountRepository = createUserAccountRepository();
