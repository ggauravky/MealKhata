import { Router } from 'express';
import { reportService } from '../reports/report.service.js';
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

export function createReportRouter({ service = reportService } = {}) {
  const router = Router();

  router.get('/monthly/:month', validateMonth, async (req, res) => {
    res.json({ success: true, data: await service.getMonthlyReport(req.params.month) });
  });

  return router;
}

export const reportRouter = createReportRouter();

