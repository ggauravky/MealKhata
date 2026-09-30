import { PushDelivery as PushDeliveryModel } from './pushDelivery.model.js';

export function createPushDeliveryRepository({ model = PushDeliveryModel } = {}) {
  return Object.freeze({
    async claimDispatch({ dispatchKey, memberId, mealType, logicalDate, subscriptionId }) {
      try {
        const created = await model.create({
          dispatchKey,
          memberId,
          mealType,
          logicalDate,
          subscriptionId,
          status: 'claimed',
        });
        return created.toObject ? created.toObject() : created;
      } catch (error) {
        if (error?.code === 11000) {
          // Already claimed / delivered
          return null;
        }
        throw error;
      }
    },

    async markSent(dispatchKey, sentAt = new Date()) {
      return model.updateOne(
        { dispatchKey },
        {
          $set: { status: 'sent', sentAt },
        },
      );
    },

    async markFailed(dispatchKey, error = null) {
      return model.updateOne(
        { dispatchKey },
        {
          $set: { status: 'failed', error: error?.slice?.(0, 500) || null },
        },
      );
    },

    async markGone(dispatchKey) {
      return model.updateOne(
        { dispatchKey },
        {
          $set: { status: 'gone', error: 'Subscription expired (404/410)' },
        },
      );
    },

    async findByDispatchKey(dispatchKey) {
      return model.findOne({ dispatchKey }).lean();
    },
  });
}

export const pushDeliveryRepository = createPushDeliveryRepository();
