import { Router } from 'express';
import { isDraining } from '../config/lifecycle.js';
import { checkReadiness } from '../config/readiness.js';
import { APP_VERSION } from '../config/version.js';

export function createHealthRouter({ readiness = checkReadiness,
  drainingCheck = isDraining, version = APP_VERSION } = {}) {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json({
      success: true,
      service: 'MealKhata',
      status: 'ok',
      version,
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

    let result = { ready: false, checks: {} };
    try { result = await readiness(); }
    catch { /* A readiness observer failure must never make the service ready. */ }
    const ready = result?.ready === true;
    return res.status(ready ? 200 : 503).json({
      success: ready,
      status: ready ? 'ready' : 'unavailable',
      checks: result?.checks ?? {},
    });
  });

  return router;
}

export const healthRouter = createHealthRouter();
