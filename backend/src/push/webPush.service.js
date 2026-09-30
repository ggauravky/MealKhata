import webpush from 'web-push';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let vapidConfigured = false;

export function configureVapidDetails({
  subject = env.vapidSubject,
  publicKey = env.vapidPublicKey,
  privateKey = env.vapidPrivateKey,
  client = webpush,
} = {}) {
  if (publicKey && privateKey && subject) {
    client.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  }
}

export function createWebPushService({ client = webpush } = {}) {
  // Ensure VAPID is configured if keys are available
  if (!vapidConfigured && env.vapidPublicKey && env.vapidPrivateKey) {
    configureVapidDetails({ client });
  }

  return Object.freeze({
    async sendNotification(subscription, payload) {
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        throw new TypeError('Invalid subscription structure');
      }

      const pushPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);

      try {
        const response = await client.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.keys.p256dh,
              auth: subscription.keys.auth,
            },
          },
          pushPayload,
          {
            TTL: 3600, // 1 hour TTL
            urgency: 'high',
          },
        );

        return {
          success: true,
          statusCode: response?.statusCode ?? 201,
        };
      } catch (error) {
        const statusCode = error?.statusCode ?? 500;
        const isGone = statusCode === 410 || statusCode === 404;

        if (isGone) {
          logger.info(`Web Push endpoint expired with status ${statusCode}`);
        } else {
          logger.warn(`Web Push notification delivery failed with status ${statusCode}`);
        }

        const deliveryError = new Error(`Push delivery failed: ${statusCode}`);
        deliveryError.statusCode = statusCode;
        deliveryError.isGone = isGone;
        throw deliveryError;
      }
    },
  });
}

export const webPushService = createWebPushService();
