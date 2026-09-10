import { Payment } from './payment.model.js';

function toPlainObject(document) {
  return document?.toObject ? document.toObject() : document;
}

export const paymentRepository = Object.freeze({
  async findByMonth(month) {
    return Payment.find({ month }).sort({ recordedAt: -1, paymentId: -1 }).lean().exec();
  },

  async findHistoryByMonth(month) {
    return Payment.find({ month })
      .select({
        _id: 0,
        paymentId: 1,
        month: 1,
        memberId: 1,
        amountPaise: 1,
        method: 1,
        upiReference: 1,
        recordedAt: 1,
        recordedByRole: 1,
        status: 1,
        voidedAt: 1,
        voidedByRole: 1,
        voidReason: 1,
      })
      .sort({ recordedAt: -1, paymentId: -1 })
      .lean()
      .exec();
  },

  async findSummaryByMonth(month) {
    return Payment.find({ month })
      .select({ _id: 0, memberId: 1, amountPaise: 1, status: 1 })
      .lean()
      .exec();
  },

  async findByPaymentId(paymentId) {
    return Payment.findOne({ paymentId }).lean().exec();
  },

  async findByIdempotencyKey(idempotencyKey) {
    return Payment.findOne({ idempotencyKey }).lean().exec();
  },

  async create(payment) {
    const document = await Payment.create(payment);
    return toPlainObject(document);
  },

  async voidIfRecorded({ paymentId, voidedAt, voidedByRole, voidReason }) {
    return Payment.findOneAndUpdate(
      { paymentId, status: 'recorded' },
      {
        $set: {
          status: 'voided',
          voidedAt,
          voidedByRole,
          voidReason,
        },
      },
      { new: true, runValidators: true },
    )
      .lean()
      .exec();
  },
});
