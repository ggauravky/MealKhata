import { PushSubscription as PushSubscriptionModel } from './pushSubscription.model.js';

export function createPushSubscriptionRepository({ model = PushSubscriptionModel } = {}) {
  return Object.freeze({
    async findByEndpoint(endpoint) {
      return model.findOne({ endpoint }).lean();
    },

    async findActiveByMemberId(memberId) {
      return model.find({ memberId, active: true }).lean();
    },

    async findAllActive() {
      return model.find({ active: true }).lean();
    },

    async upsertSubscription({
      memberId,
      endpoint,
      keys,
      expirationTime = null,
      preferences = { morning: true, night: true },
      userAgent = null,
    }) {
      return model
        .findOneAndUpdate(
          { endpoint },
          {
            $set: {
              memberId,
              keys,
              expirationTime,
              preferences: {
                morning: preferences?.morning !== false,
                night: preferences?.night !== false,
              },
              active: true,
              userAgent,
              lastFailureAt: null,
              failureCount: 0,
            },
          },
          {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true,
            runValidators: true,
          },
        )
        .lean();
    },

    async updatePreferences({ endpoint, memberId, preferences }) {
      const updateFields = {};
      if (typeof preferences?.morning === 'boolean') {
        updateFields['preferences.morning'] = preferences.morning;
      }
      if (typeof preferences?.night === 'boolean') {
        updateFields['preferences.night'] = preferences.night;
      }

      return model
        .findOneAndUpdate(
          { endpoint, memberId, active: true },
          { $set: updateFields },
          { new: true, runValidators: true },
        )
        .lean();
    },

    async deactivate(endpoint) {
      return model
        .findOneAndUpdate(
          { endpoint },
          { $set: { active: false, lastFailureAt: new Date() } },
          { new: true },
        )
        .lean();
    },

    async deleteByMemberAndEndpoint(memberId, endpoint) {
      const result = await model.deleteOne({ memberId, endpoint });
      return result.deletedCount > 0;
    },

    async recordSuccess(subscriptionId) {
      return model.updateOne(
        { subscriptionId },
        {
          $set: { lastSuccessAt: new Date(), failureCount: 0 },
        },
      );
    },

    async recordFailure(subscriptionId) {
      return model.updateOne(
        { subscriptionId },
        {
          $set: { lastFailureAt: new Date() },
          $inc: { failureCount: 1 },
        },
      );
    },
  });
}

export const pushSubscriptionRepository = createPushSubscriptionRepository();
