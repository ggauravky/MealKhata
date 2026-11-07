import { MemberAccountAudit } from './memberAccountAudit.model.js';

export const memberAccountAuditRepository = Object.freeze({
  async create(data, { session = null } = {}) {
    if (session) {
      const created = await MemberAccountAudit.create([data], { session });
      return created[0].toObject();
    }
    const created = await MemberAccountAudit.create(data);
    return created.toObject();
  },

  async listForMember(memberId) {
    return MemberAccountAudit.find({ memberId }).sort({ occurredAt: -1 }).lean();
  },
});
