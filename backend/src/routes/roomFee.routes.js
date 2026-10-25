import { Router } from 'express';
import { ROLES, isAuthenticatedRole } from '../auth/permissions.js';
import { MEMBER_IDS } from '../config/members.js';
import { requireAdminOrAbove, requireAuthenticated, requireSuperAdmin } from '../middleware/authorize.js';
import { roomFeeService } from '../roomFees/roomFee.service.js';
import { broadcastRoomFeesUpdated } from '../socket.js';
import { isValidLogicalMonth } from '../utils/month.js';

function validateMonthParam(req, res, next) {
  if (!isValidLogicalMonth(req.params.month)) {
    return res.status(400).json({
      success: false,
      message: 'Month must be a valid calendar month in YYYY-MM format.',
    });
  }
  return next();
}

export function createRoomFeeRouter({
  service = roomFeeService,
  broadcast = broadcastRoomFeesUpdated,
} = {}) {
  const router = Router();

  // Helper for broadcasting invalidation
  function notifyChange(month = null) {
    try {
      broadcast({
        scope: 'room-fees',
        month: month || null,
        revision: Date.now().toString(),
      });
    } catch {
      // Broadcast failure should never fail the HTTP response
    }
  }

  // --- Member Endpoints (Isolated to authenticated member) ---
  router.get('/me', requireAuthenticated, async (req, res, next) => {
    try {
      // If member, strictly use req.auth.memberId. If Admin/Super Admin, allow ?memberId or first member.
      let targetMemberId = req.auth.memberId;
      if (!targetMemberId && (req.auth.role === ROLES.ADMIN || req.auth.role === ROLES.SUPERADMIN)) {
        targetMemberId = req.query.memberId || MEMBER_IDS[0];
      }

      if (!targetMemberId || !MEMBER_IDS.includes(targetMemberId)) {
        return res.status(403).json({ success: false, message: 'Member access required.' });
      }

      const month = req.query.month && isValidLogicalMonth(req.query.month) ? req.query.month : null;
      const overview = await service.getMemberOverview({ memberId: targetMemberId, targetMonth: month });
      return res.json({ success: true, data: overview });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me/history', requireAuthenticated, async (req, res, next) => {
    try {
      let targetMemberId = req.auth.memberId;
      if (!targetMemberId && (req.auth.role === ROLES.ADMIN || req.auth.role === ROLES.SUPERADMIN)) {
        targetMemberId = req.query.memberId || MEMBER_IDS[0];
      }

      if (!targetMemberId || !MEMBER_IDS.includes(targetMemberId)) {
        return res.status(403).json({ success: false, message: 'Member access required.' });
      }

      const history = await service.getMemberHistory(targetMemberId);
      return res.json({ success: true, data: history });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me/payments', requireAuthenticated, async (req, res, next) => {
    try {
      let targetMemberId = req.auth.memberId;
      if (!targetMemberId && (req.auth.role === ROLES.ADMIN || req.auth.role === ROLES.SUPERADMIN)) {
        targetMemberId = req.query.memberId || MEMBER_IDS[0];
      }

      if (!targetMemberId || !MEMBER_IDS.includes(targetMemberId)) {
        return res.status(403).json({ success: false, message: 'Member access required.' });
      }

      const payments = await service.getMemberPayments(targetMemberId);
      return res.json({ success: true, data: payments });
    } catch (error) {
      return next(error);
    }
  });

  // --- Member or Admin resource access with member isolation ---
  router.get('/members/:memberId', requireAuthenticated, async (req, res, next) => {
    try {
      const { memberId } = req.params;
      if (!MEMBER_IDS.includes(memberId)) {
        return res.status(400).json({ success: false, message: 'Invalid member ID.' });
      }

      if (req.auth.role === ROLES.MEMBER && req.auth.memberId !== memberId) {
        return res.status(403).json({ success: false, message: 'You do not have permission to view another member\'s room fees.' });
      }

      if (!isAuthenticatedRole(req.auth.role) || req.auth.role === ROLES.VIEWER) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
      }

      const month = req.query.month && isValidLogicalMonth(req.query.month) ? req.query.month : null;
      const overview = await service.getMemberOverview({ memberId, targetMonth: month });
      return res.json({ success: true, data: overview });
    } catch (error) {
      return next(error);
    }
  });

  // --- Admin Monthly Overview ---
  router.get('/summary/:month', requireAdminOrAbove, validateMonthParam, async (req, res, next) => {
    try {
      const summary = await service.getMonthlySummary(req.params.month, req.auth.role);
      return res.json({ success: true, data: summary });
    } catch (error) {
      return next(error);
    }
  });

  // --- Room Management Endpoints ---
  router.get('/rooms', requireAdminOrAbove, async (req, res, next) => {
    try {
      const rooms = await service.getRooms();
      return res.json({ success: true, data: rooms });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/rooms', requireAdminOrAbove, async (req, res, next) => {
    try {
      const { roomNumber, roomLabel, capacity } = req.body || {};
      const room = await service.createRoom({
        roomNumber,
        roomLabel,
        capacity,
        actorRole: req.auth.role,
      });
      notifyChange();
      return res.status(201).json({ success: true, data: room });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/rooms/:roomId', requireAdminOrAbove, async (req, res, next) => {
    try {
      const room = await service.updateRoom(req.params.roomId, req.body || {}, req.auth.role);
      notifyChange();
      return res.json({ success: true, data: room });
    } catch (error) {
      return next(error);
    }
  });

  // --- Room Assignments ---
  router.get('/assignments', requireAdminOrAbove, async (req, res, next) => {
    try {
      const assignments = await service.getAllAssignments();
      return res.json({ success: true, data: assignments });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/assignments/:memberId', requireAuthenticated, async (req, res, next) => {
    try {
      const { memberId } = req.params;
      if (req.auth.role === ROLES.MEMBER && req.auth.memberId !== memberId) {
        return res.status(403).json({ success: false, message: 'Permission denied.' });
      }
      const assignments = await service.getAssignmentsForMember(memberId);
      return res.json({ success: true, data: assignments });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/assignments', requireAdminOrAbove, async (req, res, next) => {
    try {
      const { memberId, roomId, effectiveFromMonth, effectiveUntilMonth, effectiveFromDate, effectiveUntilDate } = req.body || {};
      const assignment = await service.assignMemberToRoom({
        memberId,
        roomId,
        effectiveFromMonth,
        effectiveUntilMonth,
        effectiveFromDate,
        effectiveUntilDate,
        actorRole: req.auth.role,
      });
      notifyChange(effectiveFromMonth);
      return res.status(201).json({ success: true, data: assignment });
    } catch (error) {
      return next(error);
    }
  });

  // --- Fee Plans ---
  router.get('/plans/:memberId', requireAuthenticated, async (req, res, next) => {
    try {
      const { memberId } = req.params;
      if (req.auth.role === ROLES.MEMBER && req.auth.memberId !== memberId) {
        return res.status(403).json({ success: false, message: 'Permission denied.' });
      }
      const plans = await service.getFeePlansForMember(memberId);
      return res.json({ success: true, data: plans });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/plans', requireAdminOrAbove, async (req, res, next) => {
    try {
      const { memberId, amountPaise, effectiveFromMonth, effectiveUntilMonth, dueDay, reason } = req.body || {};
      const plan = await service.createFeePlan({
        memberId,
        amountPaise,
        effectiveFromMonth,
        effectiveUntilMonth,
        dueDay,
        reason,
        actorRole: req.auth.role,
      });
      notifyChange(effectiveFromMonth);
      return res.status(201).json({ success: true, data: plan });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/plans/:memberId/reconciliation-preview', requireSuperAdmin, async (req, res, next) => {
    try {
      const preview = await service.previewFeePlanReconciliation({
        memberId: req.params.memberId,
        schedule: req.body?.schedule,
        reason: req.body?.reason,
        actorRole: req.auth.role,
      });
      return res.json({ success: true, data: preview });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/plans/:memberId/reconcile', requireSuperAdmin, async (req, res, next) => {
    try {
      const result = await service.reconcileFeePlans({
        memberId: req.params.memberId,
        schedule: req.body?.schedule,
        reason: req.body?.reason,
        previewToken: req.body?.previewToken,
        actorRole: req.auth.role,
      });
      notifyChange();
      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  // --- Monthly Charges ---
  router.post('/charges/preview', requireAdminOrAbove, async (req, res, next) => {
    try {
      const { month } = req.body || {};
      const preview = await service.previewCharges(month, req.auth.role);
      return res.json({ success: true, data: preview });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/charges/issue', requireAdminOrAbove, async (req, res, next) => {
    try {
      const { month } = req.body || {};
      const result = await service.issueCharges(month, req.auth.role);
      notifyChange(month);
      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/charges/:month', requireAdminOrAbove, validateMonthParam, async (req, res, next) => {
    try {
      const charges = await service.getChargesForMonth(req.params.month, req.auth.role);
      return res.json({ success: true, data: charges });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/charges/:chargeId/adjustments', requireSuperAdmin, async (req, res, next) => {
    try {
      const { amountPaise, reason } = req.body || {};
      const adjusted = await service.adjustCharge({
        chargeId: req.params.chargeId,
        amountPaise,
        reason,
        actorRole: req.auth.role,
      });
      notifyChange(adjusted.month);
      return res.json({ success: true, data: adjusted });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/charges/:chargeId/cancel', requireSuperAdmin, async (req, res, next) => {
    try {
      const { reason } = req.body || {};
      const cancelled = await service.cancelCharge({
        chargeId: req.params.chargeId,
        reason,
        actorRole: req.auth.role,
      });
      notifyChange(cancelled.month);
      return res.json({ success: true, data: cancelled });
    } catch (error) {
      return next(error);
    }
  });

  // --- Payments ---
  router.get('/payments', requireAdminOrAbove, async (req, res, next) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const payments = await service.getAllPayments({ limit }, req.auth.role);
      return res.json({ success: true, data: payments });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/payments/:month', requireAdminOrAbove, validateMonthParam, async (req, res, next) => {
    try {
      const payments = await service.getPaymentsForMonth(req.params.month, req.auth.role);
      return res.json({ success: true, data: payments });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/payments', requireAdminOrAbove, async (req, res, next) => {
    try {
      const { chargeId, memberId, month, amountPaise, method, reference, idempotencyKey } = req.body || {};
      const payment = await service.recordPayment({
        chargeId,
        memberId,
        month,
        amountPaise,
        method,
        reference,
        idempotencyKey,
        actorRole: req.auth.role,
      });
      notifyChange(month);
      return res.status(201).json({ success: true, data: payment });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/payments/:paymentId/void', requireSuperAdmin, async (req, res, next) => {
    try {
      const { reason } = req.body || {};
      const voided = await service.voidPayment({
        roomPaymentId: req.params.paymentId,
        reason,
        actorRole: req.auth.role,
      });
      notifyChange(voided.month);
      return res.json({ success: true, data: voided });
    } catch (error) {
      return next(error);
    }
  });

  // --- Payment Settings ---
  router.get('/settings', requireAuthenticated, async (req, res, next) => {
    try {
      const settings = await service.getPaymentSettings();
      return res.json({ success: true, data: settings });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/settings', requireAdminOrAbove, async (req, res, next) => {
    try {
      const updated = await service.updatePaymentSettings(req.body || {}, req.auth.role);
      notifyChange();
      return res.json({ success: true, data: updated });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

// Sub-router for direct /api/rooms mounting
export function createRoomRouter({ service = roomFeeService, broadcast = broadcastRoomFeesUpdated } = {}) {
  const router = Router();

  function notifyChange() {
    try {
      broadcast({ scope: 'room-fees', revision: Date.now().toString() });
    } catch {
      // safe
    }
  }

  router.get('/', requireAdminOrAbove, async (req, res, next) => {
    try {
      const rooms = await service.getRooms();
      return res.json({ success: true, data: rooms });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', requireAdminOrAbove, async (req, res, next) => {
    try {
      const { roomNumber, roomLabel, capacity } = req.body || {};
      const room = await service.createRoom({
        roomNumber,
        roomLabel,
        capacity,
        actorRole: req.auth.role,
      });
      notifyChange();
      return res.status(201).json({ success: true, data: room });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:roomId', requireAdminOrAbove, async (req, res, next) => {
    try {
      const room = await service.updateRoom(req.params.roomId, req.body || {}, req.auth.role);
      notifyChange();
      return res.json({ success: true, data: room });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/:roomId', requireAdminOrAbove, async (req, res, next) => {
    try {
      const room = await service.updateRoom(req.params.roomId, req.body || {}, req.auth.role);
      notifyChange();
      return res.json({ success: true, data: room });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const roomFeeRouter = createRoomFeeRouter();
export const roomRouter = createRoomRouter();
