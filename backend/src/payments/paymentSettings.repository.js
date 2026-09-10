import { PaymentSettings } from './paymentSettings.model.js';
import { PAYMENT_SETTINGS_KEY } from './payment.constants.js';

function toPlainObject(document) {
  return document?.toObject ? document.toObject() : document;
}

export const paymentSettingsRepository = Object.freeze({
  async findPrimary() {
    return PaymentSettings.findOne({ key: PAYMENT_SETTINGS_KEY }).lean().exec();
  },

  async create(settings) {
    const document = await PaymentSettings.create(settings);
    return toPlainObject(document);
  },

  async updateIfCurrent({ current, receiver, change }) {
    return PaymentSettings.findOneAndUpdate(
      {
        key: PAYMENT_SETTINGS_KEY,
        revision: current.revision,
        receiverName: current.receiverName,
        upiId: current.upiId ?? null,
        receiverMobile: current.receiverMobile ?? null,
      },
      {
        $set: receiver,
        $inc: { revision: 1 },
        $push: { changes: change },
      },
      { new: true, runValidators: true },
    )
      .lean()
      .exec();
  },
});
