import { Router } from 'express';
import { checkDatabaseReadiness } from '../config/db.js';
import { isDraining } from '../config/lifecycle.js';

export function createHealthRouter({ readiness = checkDatabaseReadiness, drainingCheck = isDraining } = {}) {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json({
      success: true,
      service: 'MealKhata',
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  router.get('/ready', async (req, res) => {
    if (drainingCheck()) {
      return res.status(503).json({
        success: false,
        status: 'draining',
      });
    }

    const ready = await readiness();
    return res.status(ready ? 200 : 503).json({
      success: ready,
      status: ready ? 'ready' : 'unavailable',
    });
  });

  return router;
}

export const healthRouter = createHealthRouter();
