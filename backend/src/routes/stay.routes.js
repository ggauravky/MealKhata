import { Router } from 'express';
import { ROLES, roleMeetsRequirement } from '../auth/permissions.js';
import { MEMBER_IDS } from '../config/members.js';
import { requireAdminOrAbove, requireAuthenticated, requireSuperAdmin } from '../middleware/authorize.js';
import { stayService } from '../stays/stay.service.js';
import { depositService } from '../stays/deposit.service.js';
import { lifetimeReportService } from '../stays/lifetimeReport.service.js';
import { lifetimePdfService } from '../stays/lifetimePdf.service.js';
import {
  broadcastStayUpdated,
  broadcastDepositUpdated,
  broadcastClearanceUpdated,
} from '../socket.js';
import { DEPOSIT_TRANSACTION_TYPES, STAY_STATUSES } from '../stays/stay.constants.js';

export function createStayRouter({
  service = stayService,
  deposits = depositService,
  lifetimeReports = lifetimeReportService,
  pdfService = lifetimePdfService,
  broadcastStay = broadcastStayUpdated,
  broadcastDeposit = broadcastDepositUpdated,
  broadcastClearance = broadcastClearanceUpdated,
} = {}) {
  const router = Router();

  function notifyStayChange() {
    try {
      broadcastStay();
    } catch {
      // broadcast failure does not reject HTTP response
    }
  }

  function notifyDepositChange() {
    try {
      broadcastDeposit();
    } catch {
      // broadcast failure does not reject HTTP response
    }
  }

  function notifyClearanceChange() {
    try {
      broadcastClearance();
      broadcastStay();
    } catch {
      // broadcast failure does not reject HTTP response
    }
  }

  // Middleware to ensure a member can only access their own stay
  async function assertStayAccess(req, res, next) {
    try {
      const { stayId } = req.params;
      const stay = await service.getStayById(stayId);
      if (!stay) {
        return res.status(404).json({ success: false, message: 'Stay not found.' });
      }

      if (req.auth.role === ROLES.MEMBER && req.auth.memberId !== stay.memberId) {
        return res.status(403).json({ success: false, message: 'You cannot access another resident\'s stay records.' });
      }

      req.stay = stay;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  // ==========================================
  // Member Personal Endpoints (/api/stays/me)
  // ==========================================

  router.get('/me', requireAuthenticated, async (req, res, next) => {
    try {
      let targetMemberId = req.auth.memberId;
      if (!targetMemberId && (req.auth.role === ROLES.ADMIN || req.auth.role === ROLES.SUPERADMIN)) {
        targetMemberId = req.query.memberId || MEMBER_IDS[0];
      }

      if (!targetMemberId || !MEMBER_IDS.includes(targetMemberId)) {
        return res.status(403).json({ success: false, message: 'Valid member identity required.' });
      }

      const activeStay = await service.getActiveStayForMember(targetMemberId);
      if (!activeStay) {
        // Return latest completed stay or null if never configured
        const stays = await service.listStaysForMember(targetMemberId);
        const latest = stays.find((stay) => stay.status !== STAY_STATUSES.CANCELLED) || null;
        return res.json({
          success: true,
          configured: Boolean(latest),
          isActive: false,
          data: latest,
        });
      }

      return res.json({
        success: true,
        configured: true,
        isActive: true,
        data: activeStay,
      });
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
        return res.status(403).json({ success: false, message: 'Valid member identity required.' });
      }

      const stays = await service.listStaysForMember(targetMemberId);
      return res.json({ success: true, data: stays });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/me/checkout-request', requireAuthenticated, async (req, res, next) => {
    try {
      let targetMemberId = req.auth.memberId;
      if (!targetMemberId && (req.auth.role === ROLES.ADMIN || req.auth.role === ROLES.SUPERADMIN)) {
        targetMemberId = req.body?.memberId || req.query.memberId || MEMBER_IDS[0];
      }

      if (!targetMemberId || !MEMBER_IDS.includes(targetMemberId)) {
        return res.status(403).json({ success: false, message: 'Valid member identity required.' });
      }

      const activeStay = await service.getActiveStayForMember(targetMemberId);
      if (!activeStay) {
        return res.status(400).json({ success: false, message: 'No active stay found for this member.' });
      }

      const preferredLeaveDate = req.body?.preferredLeaveDate ?? req.body?.checkoutRequestedFor;
      const reason = req.body?.reason ?? req.body?.checkoutRequestNote;
      const updated = await service.requestCheckout({
        stayId: activeStay.stayId,
        preferredLeaveDate,
        reason,
        actorRole: req.auth.role,
        actorMemberId: req.auth.memberId || null,
      });

      notifyStayChange();
      return res.json({ success: true, data: updated });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/me/checkout-request', requireAuthenticated, async (req, res, next) => {
    try {
      let targetMemberId = req.auth.memberId;
      if (!targetMemberId && (req.auth.role === ROLES.ADMIN || req.auth.role === ROLES.SUPERADMIN)) {
        targetMemberId = req.query.memberId || MEMBER_IDS[0];
      }

      if (!targetMemberId || !MEMBER_IDS.includes(targetMemberId)) {
        return res.status(403).json({ success: false, message: 'Valid member identity required.' });
      }

      const activeStay = await service.getActiveStayForMember(targetMemberId);
      if (!activeStay) {
        return res.status(400).json({ success: false, message: 'No active stay found.' });
      }

      const updated = await service.cancelCheckoutRequest({
        stayId: activeStay.stayId,
        reason: req.body?.reason || 'Cancelled by member',
        actorRole: req.auth.role,
        actorMemberId: req.auth.memberId || null,
      });

      notifyStayChange();
      return res.json({ success: true, data: updated });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me/lifetime-summary', requireAuthenticated, async (req, res, next) => {
    try {
      let targetMemberId = req.auth.memberId;
      if (!targetMemberId && (req.auth.role === ROLES.ADMIN || req.auth.role === ROLES.SUPERADMIN)) {
        targetMemberId = req.query.memberId || MEMBER_IDS[0];
      }

      const activeStay = await service.getActiveStayForMember(targetMemberId);
      let targetStay = activeStay;
      if (!targetStay) {
        const history = await service.listStaysForMember(targetMemberId);
        targetStay = history.length > 0 ? history[0] : null;
      }

      if (!targetStay) {
        return res.status(404).json({ success: false, message: 'No stay record configured for member.' });
      }

      const report = await lifetimeReports.generateLifetimeReport(targetStay.stayId);
      return res.json({ success: true, data: report });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me/lifetime-statement.pdf', requireAuthenticated, async (req, res, next) => {
    try {
      let targetMemberId = req.auth.memberId;
      if (!targetMemberId && (req.auth.role === ROLES.ADMIN || req.auth.role === ROLES.SUPERADMIN)) {
        targetMemberId = req.query.memberId || MEMBER_IDS[0];
      }

      const activeStay = await service.getActiveStayForMember(targetMemberId);
      let targetStay = activeStay;
      if (!targetStay) {
        const history = await service.listStaysForMember(targetMemberId);
        targetStay = history.length > 0 ? history[0] : null;
      }

      if (!targetStay) {
        return res.status(404).json({ success: false, message: 'No stay record found for member.' });
      }

      const report = await lifetimeReports.generateLifetimeReport(targetStay.stayId);
      const filename = `MealKhata-Lifetime-Statement-${targetStay.memberId}-${report.summary.periodEndMonth}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

      const doc = pdfService.buildLifetimeStatementPdf(report);
      doc.pipe(res);
    } catch (error) {
      return next(error);
    }
  });

  // ==========================================
  // Admin Stay List & Registration
  // ==========================================

  router.get('/', requireAdminOrAbove, async (req, res, next) => {
    try {
      const { memberId, status } = req.query;
      const stays = await service.listStays({ memberId, status });
      return res.json({ success: true, data: stays });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', requireAdminOrAbove, async (req, res, next) => {
    try {
      const {
        memberId,
        joinedOn,
        initialRoomId,
        expectedDepositPaise,
        historicalReason,
        admissionMode,
        assignmentId,
        allowUnverifiedPreAssignmentPeriod,
      } = req.body || {};
      const monthlyFeePaise = req.body?.monthlyFeePaise ?? req.body?.monthlyRatePaise ?? req.body?.monthlyRentPaise;
      const newStay = await service.createStay({
        memberId,
        joinedOn,
        initialRoomId,
        monthlyFeePaise,
        monthlyRatePaise: monthlyFeePaise,
        expectedDepositPaise,
        actorRole: req.auth.role,
        actorMemberId: req.auth.memberId || null,
        historicalReason,
        admissionMode,
        assignmentId,
        allowUnverifiedPreAssignmentPeriod,
      });

      notifyStayChange();
      notifyDepositChange();
      return res.status(201).json({ success: true, data: newStay });
    } catch (error) {
      return next(error);
    }
  });

  // ==========================================
  // Stay Specific Endpoints (:stayId)
  // ==========================================

  router.get('/:stayId', requireAuthenticated, assertStayAccess, async (req, res) => {
    return res.json({ success: true, data: req.stay });
  });

  router.get('/:stayId/room-history', requireAuthenticated, assertStayAccess, async (req, res, next) => {
    try {
      const history = await service.getStayRoomHistory(req.stay.stayId);
      return res.json({ success: true, data: history });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:stayId/deposit', requireAuthenticated, assertStayAccess, async (req, res, next) => {
    try {
      const depositSummary = await deposits.getDepositSummary(req.stay.stayId);
      return res.json({ success: true, data: depositSummary });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:stayId/financial-review', requireAdminOrAbove, assertStayAccess, async (req, res, next) => {
    try {
      const review = await service.getCheckoutReview(req.stay.stayId);
      return res.json({ success: true, data: review });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:stayId/lifetime-summary', requireAuthenticated, assertStayAccess, async (req, res, next) => {
    try {
      const report = await lifetimeReports.generateLifetimeReport(req.stay.stayId);
      return res.json({ success: true, data: report });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:stayId/lifetime-statement.pdf', requireAuthenticated, assertStayAccess, async (req, res, next) => {
    try {
      const report = await lifetimeReports.generateLifetimeReport(req.stay.stayId);
      const filename = `MealKhata-Lifetime-Statement-${req.stay.memberId}-${report.summary.periodEndMonth}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

      const doc = pdfService.buildLifetimeStatementPdf(report);
      doc.pipe(res);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:stayId/clearances', requireAuthenticated, assertStayAccess, async (req, res, next) => {
    try {
      const clearances = await service.listClearances(req.stay.stayId);
      return res.json({ success: true, data: clearances });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:stayId/clearances/:clearanceId.pdf', requireAuthenticated, assertStayAccess, async (req, res, next) => {
    try {
      const clearances = await service.listClearances(req.stay.stayId);
      const clearance = clearances.find((c) => c.clearanceId === req.params.clearanceId);
      if (!clearance) {
        return res.status(404).json({ success: false, message: 'Clearance snapshot not found.' });
      }

      const filename = `MealKhata-Clearance-${req.stay.memberId}-${clearance.sequence}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

      const doc = pdfService.buildClearancePdf({ stay: req.stay, clearance });
      doc.pipe(res);
    } catch (error) {
      return next(error);
    }
  });

  // ==========================================
  // Lifecycle Management Actions
  // ==========================================

  router.post('/:stayId/cancel', requireSuperAdmin, assertStayAccess, async (req, res, next) => {
    try {
      const cancelled = await service.cancelIncorrectStay({
        stayId: req.stay.stayId,
        reason: req.body?.reason,
        expectedRevision: req.body?.expectedRevision,
        actorRole: req.auth.role,
      });
      notifyStayChange();
      notifyDepositChange();
      return res.json({ success: true, data: cancelled });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:stayId/correct-admission', requireSuperAdmin, assertStayAccess, async (req, res, next) => {
    try {
      const corrected = await service.correctAdmissionDetails({
        stayId: req.stay.stayId,
        joinedOn: req.body?.joinedOn,
        roomId: req.body?.roomId,
        reason: req.body?.reason,
        expectedRevision: req.body?.expectedRevision,
        actorRole: req.auth.role,
      });
      notifyStayChange();
      return res.json({ success: true, data: corrected });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:stayId/transfers', requireAdminOrAbove, assertStayAccess, async (req, res, next) => {
    try {
      const { newRoomId, effectiveDate, newMonthlyRatePaise, reason } = req.body || {};
      const updated = await service.transferRoom({
        stayId: req.stay.stayId,
        newRoomId,
        effectiveDate,
        newMonthlyRatePaise,
        reason,
        actorRole: req.auth.role,
        actorMemberId: req.auth.memberId || null,
      });

      notifyStayChange();
      return res.json({ success: true, data: updated });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:stayId/checkout-review', requireAdminOrAbove, assertStayAccess, async (req, res, next) => {
    try {
      const updated = await service.initiateCheckoutReview({
        stayId: req.stay.stayId,
        actorRole: req.auth.role,
      });

      notifyStayChange();
      return res.json({ success: true, data: updated });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:stayId/cancel-checkout', requireAdminOrAbove, assertStayAccess, async (req, res, next) => {
    try {
      const { reason } = req.body || {};
      const updated = await service.cancelCheckoutRequest({
        stayId: req.stay.stayId,
        reason: reason || 'Cancelled by admin',
        actorRole: req.auth.role,
        actorMemberId: req.auth.memberId || null,
      });

      notifyStayChange();
      return res.json({ success: true, data: updated });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:stayId/finalize-checkout', requireSuperAdmin, assertStayAccess, async (req, res, next) => {
    try {
      const { actualLeftOn, exceptionReason } = req.body || {};
      const isException = req.body?.isException ?? req.body?.allowWithDues ?? false;
      const result = await service.finalizeCheckout({
        stayId: req.stay.stayId,
        actualLeftOn,
        isException: Boolean(isException),
        exceptionReason,
        actorRole: req.auth.role,
      });

      notifyClearanceChange();
      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:stayId/clearance/reissue', requireSuperAdmin, assertStayAccess, async (req, res, next) => {
    try {
      const { reissueReason, reason } = req.body || {};
      const result = await service.reissueClearance({
        stayId: req.stay.stayId,
        reissueReason: reissueReason || reason,
        actorRole: req.auth.role,
      });

      notifyClearanceChange();
      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  // ==========================================
  // Deposit Management Actions
  // ==========================================

  router.post('/:stayId/deposit/transactions', requireAdminOrAbove, assertStayAccess, async (req, res, next) => {
    try {
      const { type, amountPaise, method, reference, reason, idempotencyKey } = req.body || {};

      // Refunds and Deductions are strictly Super Admin only
      if (
        (type === DEPOSIT_TRANSACTION_TYPES.REFUNDED || type === DEPOSIT_TRANSACTION_TYPES.DEDUCTED) &&
        !roleMeetsRequirement(req.auth.role, ROLES.SUPERADMIN)
      ) {
        return res.status(403).json({
          success: false,
          message: 'Only Super Admin can record deposit refunds and deductions.',
        });
      }

      let tx;
      if (type === DEPOSIT_TRANSACTION_TYPES.RECEIVED) {
        tx = await deposits.recordDepositReceipt({
          stayId: req.stay.stayId,
          amountPaise,
          method,
          reference,
          reason,
          idempotencyKey,
          actorRole: req.auth.role,
        });
      } else if (type === DEPOSIT_TRANSACTION_TYPES.REFUNDED) {
        tx = await deposits.recordDepositRefund({
          stayId: req.stay.stayId,
          amountPaise,
          method,
          reference,
          reason,
          idempotencyKey,
          actorRole: req.auth.role,
        });
      } else if (type === DEPOSIT_TRANSACTION_TYPES.DEDUCTED) {
        tx = await deposits.recordDepositDeduction({
          stayId: req.stay.stayId,
          amountPaise,
          reason,
          reference,
          idempotencyKey,
          actorRole: req.auth.role,
        });
      } else {
        return res.status(400).json({ success: false, message: `Invalid deposit transaction type: ${type}` });
      }

      notifyDepositChange();
      return res.status(201).json({ success: true, data: tx });
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    '/:stayId/deposit/transactions/:transactionId/void',
    requireSuperAdmin,
    assertStayAccess,
    async (req, res, next) => {
      try {
        const { reason } = req.body || {};
        const voided = await deposits.voidTransaction({
          stayId: req.stay.stayId,
          depositTransactionId: req.params.transactionId,
          reason,
          actorRole: req.auth.role,
        });

        notifyDepositChange();
        return res.json({ success: true, data: voided });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

export const stayRouter = createStayRouter();
