import { Router } from 'express';
import { checkDatabaseReadiness, getDatabaseState } from '../config/db.js';

export function createHealthRouter({ readiness = checkDatabaseReadiness } = {}) {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json({
      success: true,
      service: 'MealKhata',
      status: 'ok',
      database: getDatabaseState(),
    });
  });

  router.get('/ready', async (req, res) => {
    const ready = await readiness();
    res.status(ready ? 200 : 503).json({
      success: ready,
      status: ready ? 'ready' : 'unavailable',
    });
  });

  return router;
}

export const healthRouter = createHealthRouter();
