import { Router } from 'express';
import { requireAuthenticated } from '../middleware/authorize.js';
import { monthlyReportPdfService } from '../reports/monthlyReportPdf.service.js';
import { reportService } from '../reports/report.service.js';
import { isValidLogicalMonth } from '../utils/month.js';
import { logger } from '../utils/logger.js';

function validateMonth(req, res, next) {
  if (!isValidLogicalMonth(req.params.month)) {
    return res.status(400).json({
      success: false,
      message: 'Month must be a valid calendar month in YYYY-MM format.',
    });
  }

  return next();
}

export function createReportRouter({
  service = reportService,
  pdfService = monthlyReportPdfService,
} = {}) {
  const router = Router();

  router.get('/monthly/:month', validateMonth, async (req, res, next) => {
    try {
      res.json({ success: true, data: await service.getMonthlyReport(req.params.month) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/monthly/:month/report.pdf', requireAuthenticated, validateMonth, async (req, res, next) => {
    const startTime = Date.now();
    const month = req.params.month;
    const role = req.auth?.role ?? 'unknown';

    try {
      const pdfBuffer = await pdfService.generateMonthlyReportPdf(month);
      const durationMs = Date.now() - startTime;

      logger.info('monthly_report_pdf.generated', {
        month,
        role,
        durationMs,
        sizeBytes: pdfBuffer.length,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="MealKhata-Monthly-Report-${month}.pdf"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.end(pdfBuffer);
    } catch (error) {
      logger.error('monthly_report_pdf.failed', {
        month,
        role,
        requestId: req.id ?? null,
        message: error.message,
      });
      next(error);
    }
  });

  return router;
}

export const reportRouter = createReportRouter();
