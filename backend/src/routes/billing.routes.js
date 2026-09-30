import { Router } from 'express';
import { monthlyRateService } from '../billing/monthlyRate.service.js';
import { isValidPricePaise } from '../billing/monthlyRate.constants.js';
import { requireSuperAdmin } from '../middleware/authorize.js';
import { settlementService } from '../settlement/settlement.service.js';
import { broadcastBillingRateUpdated } from '../socket.js';
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

function validateRateInput(req, res, next) {
  const body = req.body;

  if (
    !body ||
    Array.isArray(body) ||
    typeof body !== 'object' ||
    !isValidPricePaise(body.morningPricePaise) ||
    !isValidPricePaise(body.nightPricePaise)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Meal prices must be whole paise values from 0 to 10000000.',
    });
  }

  req.rateInput = {
    morningPricePaise: body.morningPricePaise,
    nightPricePaise: body.nightPricePaise,
  };
  return next();
}

export function createBillingRouter({
  service = monthlyRateService,
  settlements = settlementService,
  broadcast = broadcastBillingRateUpdated,
} = {}) {
  const router = Router();

  router.get('/rates/:month', validateMonth, async (req, res) => {
    res.json({ success: true, data: await service.getRate(req.params.month) });
  });

  router.put(
    '/rates/:month',
    requireSuperAdmin,
    validateMonth,
    validateRateInput,
    async (req, res, next) => {
      try {
        if (settlements && (await settlements.isMonthClosed(req.params.month))) {
          return res.status(409).json({
            success: false,
            message: 'This month is closed. Reopen the month before changing rates.',
          });
        }

        const result = await service.updateRate({
          month: req.params.month,
          ...req.rateInput,
          actorRole: req.auth.role,
        });

      if (result.changed) {
        broadcast({
          month: result.data.month,
          morningPricePaise: result.data.morningPricePaise,
          nightPricePaise: result.data.nightPricePaise,
          revision: result.data.revision,
          updatedAt: result.data.updatedAt,
        });
      }

        res.json({ success: true, changed: result.changed, data: result.data });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const billingRouter = createBillingRouter();

