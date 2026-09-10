import { Router } from 'express';
import { requireAdminOrAbove, requireSuperAdmin } from '../middleware/authorize.js';
import {
  normalizeReceiverMobile,
  normalizeReceiverName,
  normalizeUpiId,
  paymentSettingsService,
} from '../payments/paymentSettings.service.js';
import { broadcastPaymentSettingsUpdated } from '../socket.js';

function validateSettings(req, res, next) {
  const body = req.body;
  const allowedKeys = new Set(['receiverName', 'upiId', 'receiverMobile', 'actorRole']);
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return res.status(400).json({ success: false, message: 'Invalid payment receiver settings.' });
  }

  const receiverName = normalizeReceiverName(body.receiverName);
  const upiId = normalizeUpiId(body.upiId);
  const receiverMobile = normalizeReceiverMobile(body.receiverMobile);
  if (!receiverName) return res.status(400).json({ success: false, message: 'Enter a valid receiver name.' });
  if (upiId === undefined) return res.status(400).json({ success: false, message: 'Enter a valid UPI ID containing exactly one @, or leave it blank.' });
  if (receiverMobile === undefined) return res.status(400).json({ success: false, message: 'Enter a valid Indian mobile number or leave it blank.' });
  if (!upiId && !receiverMobile) return res.status(400).json({ success: false, message: 'Enter either a UPI ID or an Indian mobile number.' });

  req.paymentSettingsInput = { receiverName, upiId, receiverMobile };
  return next();
}

export function createPaymentSettingsRouter({
  service = paymentSettingsService,
  broadcast = broadcastPaymentSettingsUpdated,
} = {}) {
  const router = Router();

  router.get('/', requireAdminOrAbove, async (req, res) => {
    res.json({ success: true, data: await service.getSettings() });
  });

  router.put('/', requireSuperAdmin, validateSettings, async (req, res) => {
    const result = await service.updateSettings({
      ...req.paymentSettingsInput,
      actorRole: req.auth.role,
    });
    if (result.changed) {
      broadcast({ revision: result.data.revision, updatedAt: result.data.updatedAt });
    }
    res.json({ success: true, changed: result.changed, data: result.data });
  });

  return router;
}

export const paymentSettingsRouter = createPaymentSettingsRouter();
