import { Router } from 'express';
import { env, isPushConfigured } from '../config/env.js';
import { requireMember } from '../middleware/memberAuthorization.js';
import { pushSubscriptionService } from '../push/pushSubscription.service.js';

export function createPushRouter({
  service = pushSubscriptionService,
  isConfigured = isPushConfigured,
  publicKey = env.vapidPublicKey,
} = {}) {
  const router = Router();

  function isPushAvailable() {
    return typeof isConfigured === 'function' ? isConfigured() : Boolean(isConfigured);
  }

  // Public: VAPID public key needed by frontend to subscribe
  router.get('/public-key', (req, res) => {
    const available = isPushAvailable();
    const key = available ? publicKey : null;
    res.json({
      success: true,
      enabled: available,
      publicKey: key,
      data: {
        enabled: available,
        publicKey: key,
        available,
      },
    });
  });

  // Authenticated Member: Check subscription status for the current browser endpoint
  router.post('/subscriptions/status', requireMember, async (req, res, next) => {
    try {
      if (!isPushAvailable()) {
        return res.json({
          success: true,
          enabled: false,
          registered: false,
          belongsToAnotherAccount: false,
          preferences: null,
          data: {
            enabled: false,
            registered: false,
            belongsToAnotherAccount: false,
            preferences: null,
          },
        });
      }

      const { endpoint } = req.body || {};
      const status = await service.getStatus({
        endpoint,
        memberId: req.auth.memberId,
      });

      res.json({
        success: true,
        enabled: true,
        ...status,
        data: {
          enabled: true,
          ...status,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Authenticated Member: Register or reassign device subscription
  router.post('/subscriptions', requireMember, async (req, res, next) => {
    try {
      if (!isPushAvailable()) {
        return res.status(503).json({
          success: false,
          message: 'Background push reminders are not configured on this deployment.',
        });
      }

      const { subscription, preferences } = req.body || {};
      const result = await service.register({
        memberId: req.auth.memberId,
        subscription,
        preferences,
        userAgent: req.headers['user-agent'],
      });

      res.status(201).json({
        success: true,
        ...result,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  });

  // Authenticated Member: Update device preferences (morning/night)
  router.patch('/subscriptions/preferences', requireMember, async (req, res, next) => {
    try {
      if (!isPushAvailable()) {
        return res.status(503).json({
          success: false,
          message: 'Background push reminders are not configured on this deployment.',
        });
      }

      const { endpoint, preferences } = req.body || {};
      const result = await service.updatePreferences({
        memberId: req.auth.memberId,
        endpoint,
        preferences,
      });

      res.json({
        success: true,
        ...result,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  });

  // Authenticated Member: Disable and delete device subscription
  router.delete('/subscriptions', requireMember, async (req, res, next) => {
    try {
      const { endpoint } = req.body || {};
      const result = await service.unsubscribe({
        memberId: req.auth.memberId,
        endpoint,
      });

      res.json({
        success: true,
        ...result,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const pushRouter = createPushRouter();
