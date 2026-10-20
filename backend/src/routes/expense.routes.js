import { Router } from 'express';
import { ROLES } from '../auth/permissions.js';
import { MEMBER_IDS } from '../config/members.js';
import { ExpenseDomainError, defaultExpenseService } from '../expenses/expense.service.js';
import { isValidLogicalMonth } from '../utils/month.js';
import { getLogicalDateInTimeZone } from '../utils/date.js';
import { requireAdminOrAbove, requireAuthenticated, requireSuperAdmin } from '../middleware/authorize.js';

export function createExpenseRouter({ service = defaultExpenseService } = {}) {
  const router = Router();

  function getCurrentMonth() {
    return getLogicalDateInTimeZone(new Date()).slice(0, 7);
  }

  // --- PREVIEW SPLIT (Admin or above) ---
  router.post('/preview', requireAdminOrAbove, async (req, res, next) => {
    try {
      const { amountPaise, paidByMemberId, splitType, participants, customAllocations } = req.body || {};
      const preview = await service.previewExpense({
        amountPaise,
        paidByMemberId,
        splitType,
        participants,
        customAllocations,
      });
      return res.json({ success: true, data: preview });
    } catch (error) {
      if (error instanceof ExpenseDomainError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return next(error);
    }
  });

  // --- CREATE EXPENSE (Admin or above) ---
  router.post('/', requireAdminOrAbove, async (req, res, next) => {
    try {
      const body = req.body || {};
      const idempotencyKey = body.idempotencyKey || req.headers['x-idempotency-key'] || null;

      const created = await service.createExpense({
        date: body.date,
        title: body.title,
        category: body.category,
        description: body.description,
        amountPaise: body.amountPaise,
        paidByMemberId: body.paidByMemberId,
        splitType: body.splitType,
        participants: body.participants,
        customAllocations: body.customAllocations,
        idempotencyKey,
        actorRole: req.auth.role,
        actorMemberId: req.auth.memberId || null,
      });

      return res.status(201).json({ success: true, data: created });
    } catch (error) {
      if (error instanceof ExpenseDomainError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return next(error);
    }
  });

  // --- LIST EXPENSES (Authenticated: Member sees involved, Admin sees all) ---
  router.get('/', requireAuthenticated, async (req, res, next) => {
    try {
      const targetMonth = req.query.month || getCurrentMonth();
      if (!isValidLogicalMonth(targetMonth)) {
        return res.status(400).json({ success: false, message: 'Invalid month format (YYYY-MM).' });
      }

      if (req.auth.role === ROLES.VIEWER) {
        return res.status(403).json({ success: false, message: 'Viewer role cannot access expense records.' });
      }

      const expenses = await service.listExpensesByMonth(targetMonth, {
        actorRole: req.auth.role,
        actorMemberId: req.auth.memberId || null,
        category: req.query.category || null,
        status: req.query.status || null,
      });

      return res.json({ success: true, data: expenses });
    } catch (error) {
      if (error instanceof ExpenseDomainError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return next(error);
    }
  });

  // --- GET EXPENSE SUMMARY FOR MONTH ---
  router.get('/summary/:month', requireAuthenticated, async (req, res, next) => {
    try {
      const { month } = req.params;
      if (!isValidLogicalMonth(month)) {
        return res.status(400).json({ success: false, message: 'Invalid month format (YYYY-MM).' });
      }

      if (req.auth.role === ROLES.VIEWER) {
        return res.status(403).json({ success: false, message: 'Viewer role cannot access expense summaries.' });
      }

      // If user is Member, return only their personal summary
      if (req.auth.role === ROLES.MEMBER) {
        const summary = await service.getMemberExpenseSummary(month, req.auth.memberId);
        return res.json({ success: true, data: summary });
      }

      // If Admin or Super Admin, check if memberId is specifically requested
      if (req.query.memberId) {
        if (!MEMBER_IDS.includes(req.query.memberId)) {
          return res.status(400).json({ success: false, message: 'Invalid member ID.' });
        }
        const summary = await service.getMemberExpenseSummary(month, req.query.memberId);
        return res.json({ success: true, data: summary });
      }

      // Otherwise return complete household summary
      const householdSummary = await service.getHouseholdExpenseSummary(month, { actorRole: req.auth.role });
      return res.json({ success: true, data: householdSummary });
    } catch (error) {
      if (error instanceof ExpenseDomainError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return next(error);
    }
  });

  // --- LIST REIMBURSEMENTS ---
  router.get('/reimbursements', requireAuthenticated, async (req, res, next) => {
    try {
      const targetMonth = req.query.month || getCurrentMonth();
      if (!isValidLogicalMonth(targetMonth)) {
        return res.status(400).json({ success: false, message: 'Invalid month format (YYYY-MM).' });
      }

      if (req.auth.role === ROLES.VIEWER) {
        return res.status(403).json({ success: false, message: 'Viewer role cannot access reimbursements.' });
      }

      let reimbursements = [];
      if (req.auth.role === ROLES.MEMBER) {
        reimbursements = await service.repository.findReimbursementsForMemberByMonth(req.auth.memberId, targetMonth, {
          includeVoided: false,
        });
      } else {
        reimbursements = await service.repository.findReimbursementsByMonth(targetMonth, {
          includeVoided: req.query.includeVoided === 'true',
        });
      }

      if (req.query.expenseId) {
        reimbursements = reimbursements.filter((r) => r.expenseId === req.query.expenseId);
      }

      return res.json({ success: true, data: reimbursements });
    } catch (error) {
      if (error instanceof ExpenseDomainError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return next(error);
    }
  });

  // --- GET SINGLE EXPENSE DETAILS ---
  router.get('/:expenseId', requireAuthenticated, async (req, res, next) => {
    try {
      if (req.auth.role === ROLES.VIEWER) {
        return res.status(403).json({ success: false, message: 'Viewer role cannot access expense records.' });
      }

      const expense = await service.getExpenseById(req.params.expenseId, {
        actorRole: req.auth.role,
        actorMemberId: req.auth.memberId || null,
      });

      return res.json({ success: true, data: expense });
    } catch (error) {
      if (error instanceof ExpenseDomainError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return next(error);
    }
  });

  // --- VOID EXPENSE (Super Admin only) ---
  router.post('/:expenseId/void', requireSuperAdmin, async (req, res, next) => {
    try {
      const { reason } = req.body || {};
      const result = await service.voidExpense(req.params.expenseId, {
        reason,
        actorRole: req.auth.role,
      });
      return res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof ExpenseDomainError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return next(error);
    }
  });

  // --- RECORD REIMBURSEMENT (Admin or above) ---
  router.post('/:expenseId/reimbursements', requireAdminOrAbove, async (req, res, next) => {
    try {
      const body = req.body || {};
      const idempotencyKey = body.idempotencyKey || req.headers['x-idempotency-key'] || null;

      const result = await service.recordReimbursement({
        expenseId: req.params.expenseId,
        fromMemberId: body.fromMemberId,
        amountPaise: body.amountPaise,
        method: body.method || 'upi',
        reference: body.reference || null,
        idempotencyKey,
        actorRole: req.auth.role,
      });

      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof ExpenseDomainError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return next(error);
    }
  });

  // --- VOID REIMBURSEMENT (Super Admin only) ---
  router.post('/reimbursements/:reimbursementId/void', requireSuperAdmin, async (req, res, next) => {
    try {
      const { reason } = req.body || {};
      const result = await service.voidReimbursement(req.params.reimbursementId, {
        reason,
        actorRole: req.auth.role,
      });
      return res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof ExpenseDomainError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return next(error);
    }
  });

  return router;
}

export const expenseRouter = createExpenseRouter();
