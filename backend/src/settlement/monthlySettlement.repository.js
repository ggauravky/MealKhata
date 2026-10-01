import mongoose from 'mongoose';
import { MonthlySettlement as MonthlySettlementModel } from './monthlySettlement.model.js';

export function createMonthlySettlementRepository({ model = MonthlySettlementModel } = {}) {
  const isConnected = () => mongoose.connection?.readyState === 1;

  return Object.freeze({
    async findActiveByMonth(month) {
      if (!isConnected()) return null;
      return model.findOne({ month, status: 'closed' }).lean();
    },

    async findLatestByMonth(month) {
      if (!isConnected()) return null;
      return model.findOne({ month }).sort({ sequence: -1 }).lean();
    },

    async findHistoryByMonth(month) {
      if (!isConnected()) return [];
      return model.find({ month }).sort({ sequence: -1 }).lean();
    },

    async findBySettlementId(settlementId) {
      if (!isConnected()) return null;
      return model.findOne({ settlementId }).lean();
    },

    async createSettlement({
      settlementId,
      month,
      sequence,
      snapshot,
      snapshotVersion = 2,
      closedAt = new Date(),
      closedByRole = 'superadmin',
    }) {
      const created = await model.create({
        settlementId,
        month,
        sequence,
        status: 'closed',
        snapshotVersion,
        snapshot,
        closedAt,
        closedByRole,
        reopenedAt: null,
        reopenedByRole: null,
        reopenReason: null,
      });

      return created.toObject ? created.toObject() : created;
    },

    async reopenSettlement({ settlementId, reopenedAt = new Date(), reopenedByRole = 'superadmin', reopenReason }) {
      return model
        .findOneAndUpdate(
          { settlementId, status: 'closed' },
          {
            $set: {
              status: 'reopened',
              reopenedAt,
              reopenedByRole,
              reopenReason,
            },
          },
          { new: true },
        )
        .lean();
    },
  });
}

export const monthlySettlementRepository = createMonthlySettlementRepository();
