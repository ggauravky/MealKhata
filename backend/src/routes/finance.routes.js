/**
 * MealKhata 2.0 - Finance Routes
 * Read-only endpoints for unified financial dashboard, reports, and PDF statements.
 */

import { Router } from 'express';
import { ROLES } from '../auth/permissions.js';
import { MEMBER_IDS } from '../config/members.js';
import { requireAdminOrAbove, requireAuthenticated } from '../middleware/authorize.js';
import { isValidLogicalMonth } from '../utils/month.js';
import { financialOverviewService } from '../finance/financialOverview.service.js';
import { monthlyFinancialPdfService } from '../finance/monthlyFinancialPdf.service.js';

function validateMonthParam(req, res, next) {
  const month = req.params.month;
  if (!isValidLogicalMonth(month)) {
    return res.status(400).json({
      success: false,
      message: 'Month must be a valid calendar month in YYYY-MM format.',
    });
  }
  return next();
}

export function createFinanceRouter({
  overviewService = financialOverviewService,
  pdfService = monthlyFinancialPdfService,
} = {}) {
  const router = Router();

  // 1. Household Unified Overview (Admin / Super Admin only)
  router.get('/overview/:month', requireAdminOrAbove, validateMonthParam, async (req, res, next) => {
    try {
      const month = req.params.month;
      const data = await overviewService.getHouseholdFinancialOverview({
        month,
        actorRole: req.auth.role,
      });
      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  });

  // 2. Member Unified Overview for current user (Authenticated members)
  router.get('/me/:month', requireAuthenticated, validateMonthParam, async (req, res, next) => {
    try {
      const month = req.params.month;
      let targetMemberId = req.auth.memberId;

      // If Admin without member identity, allow query param override or default
      if (!targetMemberId && (req.auth.role === ROLES.ADMIN || req.auth.role === ROLES.SUPERADMIN)) {
        targetMemberId = req.query.memberId || MEMBER_IDS[0];
      }

      if (!targetMemberId || !MEMBER_IDS.includes(targetMemberId)) {
        return res.status(403).json({
          success: false,
          message: 'Member identity required to view personal financial overview.',
        });
      }

      const data = await overviewService.getMemberFinancialOverview({
        memberId: targetMemberId,
        month,
        actorRole: req.auth.role,
      });
      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  });

  // 3. Member Unified Overview by ID (Admin / Super Admin only)
  router.get('/members/:memberId/:month', requireAdminOrAbove, validateMonthParam, async (req, res, next) => {
    try {
      const { memberId, month } = req.params;
      if (!MEMBER_IDS.includes(memberId)) {
        return res.status(400).json({ success: false, message: `Invalid member ID: ${memberId}` });
      }

      const data = await overviewService.getMemberFinancialOverview({
        memberId,
        month,
        actorRole: req.auth.role,
      });
      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  });

  // 4. Download Personal Statement PDF (Authenticated Member)
  router.get('/monthly/:month/my-statement.pdf', requireAuthenticated, validateMonthParam, async (req, res, next) => {
    try {
      const month = req.params.month;
      let targetMemberId = req.auth.memberId;

      if (!targetMemberId && (req.auth.role === ROLES.ADMIN || req.auth.role === ROLES.SUPERADMIN)) {
        targetMemberId = req.query.memberId || MEMBER_IDS[0];
      }

      if (!targetMemberId || !MEMBER_IDS.includes(targetMemberId)) {
        return res.status(403).json({
          success: false,
          message: 'Member identity required to download personal statement.',
        });
      }

      const pdfDoc = await pdfService.generateMemberStatementPdf({
        memberId: targetMemberId,
        month,
        actorRole: req.auth.role,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="MealKhata-Personal-Statement-${targetMemberId}-${month}.pdf"`,
      );
      res.setHeader('Cache-Control', 'no-store');

      pdfDoc.pipe(res);
    } catch (error) {
      return next(error);
    }
  });

  // 5. Download Household Statement PDF (Admin / Super Admin only)
  router.get(
    '/monthly/:month/household-statement.pdf',
    requireAdminOrAbove,
    validateMonthParam,
    async (req, res, next) => {
      try {
        const month = req.params.month;
        const pdfDoc = await pdfService.generateHouseholdStatementPdf({
          month,
          actorRole: req.auth.role,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="MealKhata-Household-Statement-${month}.pdf"`,
        );
        res.setHeader('Cache-Control', 'no-store');

        pdfDoc.pipe(res);
      } catch (error) {
        return next(error);
      }
    },
  );

  // 6. Download Specific Member Statement PDF (Admin / Super Admin only)
  router.get(
    '/monthly/:month/members/:memberId/statement.pdf',
    requireAdminOrAbove,
    validateMonthParam,
    async (req, res, next) => {
      try {
        const { memberId, month } = req.params;
        if (!MEMBER_IDS.includes(memberId)) {
          return res.status(400).json({ success: false, message: `Invalid member ID: ${memberId}` });
        }

        const pdfDoc = await pdfService.generateMemberStatementPdf({
          memberId,
          month,
          actorRole: req.auth.role,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="MealKhata-Personal-Statement-${memberId}-${month}.pdf"`,
        );
        res.setHeader('Cache-Control', 'no-store');

        pdfDoc.pipe(res);
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

export const financeRouter = createFinanceRouter();
