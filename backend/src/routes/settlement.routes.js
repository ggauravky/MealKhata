import { Router } from 'express';
import { requireAuthenticated, requireSuperAdmin } from '../middleware/authorize.js';
import { settlementService } from '../settlement/settlement.service.js';
import { generateSettlementPdf } from '../settlement/statementPdf.service.js';
import { generateSettlementCsv } from '../settlement/statementCsv.service.js';
import { broadcastSettlementUpdated } from '../socket.js';
import { isValidLogicalMonth } from '../utils/month.js';

function validateMonth(req, res, next) {
  if (!isValidLogicalMonth(req.params.month)) {
    return res.status(400).json({
      success: false,
      message: 'Month must be a valid calendar month in YYYY-MM format.',
    });
  }
  return next();
}

export function createSettlementRouter({
  service = settlementService,
  broadcast = broadcastSettlementUpdated,
} = {}) {
  const router = Router();

  // Get settlement status & active settlement details (if closed)
  router.get('/:month', validateMonth, async (req, res, next) => {
    try {
      const status = await service.getSettlementStatus(req.params.month);
      res.json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
  });

  // Get historical settlement sequence records for audit
  router.get('/:month/history', validateMonth, async (req, res, next) => {
    try {
      const history = await service.getSettlementHistory(req.params.month);
      res.json({ success: true, data: history });
    } catch (error) {
      next(error);
    }
  });

  // Close month settlement (Super Admin only)
  router.post('/:month/close', requireSuperAdmin, validateMonth, async (req, res, next) => {
    try {
      const result = await service.closeMonth({
        month: req.params.month,
        actorRole: req.auth.role,
      });

      broadcast({
        month: result.month,
        state: 'closed',
        status: 'closed',
        sequence: result.sequence,
        updatedAt: result.updatedAt || result.closedAt,
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // Reopen closed month settlement (Super Admin only)
  router.post('/:month/reopen', requireSuperAdmin, validateMonth, async (req, res, next) => {
    try {
      const result = await service.reopenMonth({
        month: req.params.month,
        reason: req.body?.reason,
        actorRole: req.auth.role,
      });

      broadcast({
        month: result.month,
        state: 'reopened',
        status: 'reopened',
        sequence: result.sequence,
        updatedAt: result.updatedAt || result.reopenedAt,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // Download final PDF settlement statement (Authenticated members and admins)
  router.get('/:month/statement.pdf', requireAuthenticated, validateMonth, async (req, res, next) => {
    try {
      const settlement = await service.getActiveSettlement(req.params.month);
      if (!settlement) {
        return res.status(404).json({
          success: false,
          message: 'Settlement statement is only available for closed months.',
        });
      }

      const pdfBuffer = await generateSettlementPdf(settlement);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="MealKhata-Settlement-${req.params.month}.pdf"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.end(pdfBuffer);
    } catch (error) {
      next(error);
    }
  });

  // Download final CSV settlement statement (Authenticated members and admins)
  router.get('/:month/statement.csv', requireAuthenticated, validateMonth, async (req, res, next) => {
    try {
      const settlement = await service.getActiveSettlement(req.params.month);
      if (!settlement) {
        return res.status(404).json({
          success: false,
          message: 'Settlement statement is only available for closed months.',
        });
      }

      const csvContent = generateSettlementCsv(settlement);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="MealKhata-Settlement-${req.params.month}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(csvContent);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const settlementRouter = createSettlementRouter();
