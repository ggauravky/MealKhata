import { Router } from 'express';
import { monthlyRateService } from '../billing/monthlyRate.service.js';
import { requireSuperAdmin } from '../middleware/authorize.js';
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

export function createBillingRouter({ service = monthlyRateService } = {}) {
  const router = Router();

  router.get('/rates/:month', validateMonth, async (req, res) => {
    res.json({ success: true, data: await service.getRate(req.params.month) });
  });

  router.put('/rates/:month', validateMonth, requireSuperAdmin, async (req, res) => {
    return res.status(405).json({
      success: false,
      message: 'Meal prices are fixed at ₹50 for Morning and ₹70 for Night.',
    });
  });

  return router;
}

export const billingRouter = createBillingRouter();
