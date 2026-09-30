import { HttpError } from '../utils/HttpError.js';
import { pushSubscriptionRepository } from './pushSubscription.repository.js';

function isValidEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2000) {
    return false;
  }
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

function isValidKeyString(val) {
  return typeof val === 'string' && val.trim().length >= 10 && val.length <= 500;
}

export function createPushSubscriptionService({ repository = pushSubscriptionRepository } = {}) {
  return Object.freeze({
    async getStatus({ endpoint, memberId }) {
      if (!isValidEndpoint(endpoint)) {
        throw new HttpError(400, 'Invalid push subscription endpoint.');
      }

      const existing = await repository.findByEndpoint(endpoint);
      if (!existing || !existing.active) {
        return {
          registered: false,
          belongsToAnotherAccount: false,
          preferences: null,
        };
      }

      if (existing.memberId === memberId) {
        return {
          registered: true,
          belongsToAnotherAccount: false,
          preferences: existing.preferences,
        };
      }

      // Endpoint belongs to another account on this device; neutral response
      return {
        registered: false,
        belongsToAnotherAccount: true,
        preferences: null,
      };
    },

    async register({ memberId, subscription, preferences, userAgent = null }) {
      if (!subscription || typeof subscription !== 'object') {
        throw new HttpError(400, 'A valid push subscription object is required.');
      }

      const { endpoint, keys, expirationTime = null } = subscription;

      if (!isValidEndpoint(endpoint)) {
        throw new HttpError(400, 'Invalid push endpoint URL.');
      }

      if (!keys || !isValidKeyString(keys.p256dh) || !isValidKeyString(keys.auth)) {
        throw new HttpError(400, 'Subscription keys (p256dh and auth) are required.');
      }

      const normalizedPrefs = {
        morning: preferences?.morning !== false,
        night: preferences?.night !== false,
      };

      try {
        const record = await repository.upsertSubscription({
          memberId,
          endpoint,
          keys: {
            p256dh: keys.p256dh.trim(),
            auth: keys.auth.trim(),
          },
          expirationTime: typeof expirationTime === 'number' ? expirationTime : null,
          preferences: normalizedPrefs,
          userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
        });

        return {
          registered: true,
          preferences: record.preferences,
        };
      } catch (error) {
        throw new HttpError(500, 'Unable to register push subscription.', { cause: error });
      }
    },

    async updatePreferences({ memberId, endpoint, preferences }) {
      if (!isValidEndpoint(endpoint)) {
        throw new HttpError(400, 'Invalid push subscription endpoint.');
      }

      if (!preferences || typeof preferences !== 'object') {
        throw new HttpError(400, 'Preferences object is required.');
      }

      const existing = await repository.findByEndpoint(endpoint);
      if (!existing || existing.memberId !== memberId || !existing.active) {
        throw new HttpError(404, 'Subscription not found for this account.');
      }

      const updated = await repository.updatePreferences({
        endpoint,
        memberId,
        preferences,
      });

      return {
        registered: true,
        preferences: updated?.preferences ?? existing.preferences,
      };
    },

    async unsubscribe({ memberId, endpoint }) {
      if (!isValidEndpoint(endpoint)) {
        throw new HttpError(400, 'Invalid push subscription endpoint.');
      }

      await repository.deleteByMemberAndEndpoint(memberId, endpoint);
      return { unsubscribed: true };
    },
  });
}

export const pushSubscriptionService = createPushSubscriptionService();
