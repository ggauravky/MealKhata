import { Router } from 'express';
import { ROLES, isAuthenticatedRole } from '../auth/permissions.js';
import { MEMBER_IDS } from '../config/members.js';
import { requireAuthenticated, requireSuperAdmin } from '../middleware/authorize.js';
import { authorizeMemberResource } from '../middleware/memberAuthorization.js';
import {
  isValidPaymentAmount,
  isValidUuid,
} from '../payments/payment.constants.js';
import {
  normalizeUpiReference,
  normalizeVoidReason,
  paymentService,
} from '../payments/payment.service.js';
import { paymentSummaryService } from '../payments/paymentSummary.service.js';
import { broadcastPaymentUpdated } from '../socket.js';
import { isValidLogicalMonth } from '../utils/month.js';

function validateMonth(req, res, next) {
  if (!isValidLogicalMonth(req.params.month)) {
    return res.status(400).json({ success: false, message: 'Month must be a valid calendar month in YYYY-MM format.' });
  }
  return next();
}

function validatePaymentInput({ requireIdempotency }) {
  return function validate(req, res, next) {
    const body = req.body;
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      return res.status(400).json({ success: false, message: 'Payment details are required.' });
    }
    if (!isValidLogicalMonth(body.month)) return res.status(400).json({ success: false, message: 'Invalid payment month.' });
    if (!MEMBER_IDS.includes(body.memberId)) return res.status(400).json({ success: false, message: 'Invalid member.' });
    if (!isValidPaymentAmount(body.amountPaise)) return res.status(400).json({ success: false, message: 'Invalid payment amount.' });
    if (requireIdempotency && !isValidUuid(body.idempotencyKey)) {
      return res.status(400).json({ success: false, message: 'A valid idempotency key is required.' });
    }
    const upiReference = normalizeUpiReference(body.upiReference);
    if (requireIdempotency && upiReference === undefined) {
      return res.status(400).json({ success: false, message: 'UPI reference is invalid.' });
    }
    req.paymentInput = {
      month: body.month,
      memberId: body.memberId,
      amountPaise: body.amountPaise,
      ...(requireIdempotency ? { idempotencyKey: body.idempotencyKey, upiReference } : {}),
    };
    return next();
  };
}

function validatePrepareInput(req, res, next) {
  const body = req.body;
  const allowedKeys = new Set(['month', 'memberId']);
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return res.status(400).json({ success: false, message: 'Payment month and member are required.' });
  }
  if (!isValidLogicalMonth(body.month)) return res.status(400).json({ success: false, message: 'Invalid payment month.' });
  if (!MEMBER_IDS.includes(body.memberId)) return res.status(400).json({ success: false, message: 'Invalid member.' });
  req.paymentInput = { month: body.month, memberId: body.memberId };
  return next();
}

export function createPaymentRouter({
  service = paymentService,
  summaries = paymentSummaryService,
  broadcast = broadcastPaymentUpdated,
} = {}) {
  const router = Router();

  router.get('/summary/:month', validateMonth, async (req, res) => {
    res.json({ success: true, data: await summaries.getSummary(req.params.month) });
  });

  router.get('/history/:month', validateMonth, async (req, res) => {
    const includeReference = isAuthenticatedRole(req.auth?.role);
    res.json({ success: true, data: await service.getHistory(req.params.month, { includeReference }) });
  });

  router.post(
    '/prepare',
    requireAuthenticated,
    validatePrepareInput,
    authorizeMemberResource({ source: 'paymentInput', field: 'memberId' }),
    async (req, res) => {
      res.json({ success: true, data: await service.preparePayment(req.paymentInput) });
    },
  );

  router.post(
    '/',
    requireAuthenticated,
    validatePaymentInput({ requireIdempotency: true }),
    authorizeMemberResource({ source: 'paymentInput', field: 'memberId' }),
    async (req, res) => {
      const result = await service.recordPayment({
        ...req.paymentInput,
        actorRole: req.auth.role,
        actorMemberId: req.auth.role === ROLES.MEMBER ? req.auth.memberId : null,
      });
      if (result.created) {
        broadcast({
          month: result.data.month,
          memberId: result.data.memberId,
          paymentId: result.data.paymentId,
          action: 'recorded',
          updatedAt: result.data.recordedAt,
        });
      }
      res.status(result.created ? 201 : 200).json({ success: true, created: result.created, data: result.data });
    },
  );

  router.post('/:paymentId/void', requireSuperAdmin, async (req, res) => {
    const reason = normalizeVoidReason(req.body?.reason);
    if (!reason) return res.status(400).json({ success: false, message: 'A short reason is required to void a payment.' });

    const result = await service.voidPayment({ paymentId: req.params.paymentId, reason, actorRole: req.auth.role });
    if (result.changed) {
      broadcast({
        month: result.data.month,
        memberId: result.data.memberId,
        paymentId: result.data.paymentId,
        action: 'voided',
        updatedAt: result.data.voidedAt,
      });
    }
    res.json({ success: true, changed: result.changed, data: result.data });
  });

  return router;
}

export const paymentRouter = createPaymentRouter();
