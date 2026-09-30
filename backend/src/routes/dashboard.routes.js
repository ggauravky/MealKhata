import { Router } from 'express';
import { dashboardService } from '../dashboard/dashboard.service.js';
import { serializeDashboardSummary } from '../dashboard/dashboard.serializer.js';

export function createDashboardRouter({ service = dashboardService } = {}) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const summary = await service.getDashboardSummary({ auth: req.auth });
      return res.json({
        success: true,
        data: serializeDashboardSummary(summary),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/summary', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const summary = await service.getDashboardSummary({ auth: req.auth });
      return res.json({
        success: true,
        data: serializeDashboardSummary(summary),
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const dashboardRouter = createDashboardRouter();
