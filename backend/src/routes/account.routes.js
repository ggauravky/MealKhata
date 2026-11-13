import { Router } from 'express';
import { staffAccountService } from '../auth/staffAccount.service.js';
import { requireSuperAdmin } from '../middleware/authorize.js';

function body(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}

/** Super Admin management of administrator accounts. */
export function createAccountRouter({ service = staffAccountService, broadcast = () => {} } = {}) {
  const router = Router();
  router.use(requireSuperAdmin);

  router.get('/', async (_req, res, next) => {
    try {
      return res.json({ success: true, data: await service.listStaff() });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/audit', async (req, res, next) => {
    try {
      const limit = Number.parseInt(String(req.query.limit ?? '50'), 10);
      return res.json({ success: true, data: await service.listAudit(Number.isFinite(limit) ? limit : 50) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const { email, displayName, newPassword, currentPassword } = body(req);
      const account = await service.createAdmin({ email, displayName, newPassword, currentPassword, actor: req.auth });
      broadcast();
      return res.status(201).json({ success: true, data: account });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:userId', async (req, res, next) => {
    try {
      const { displayName, currentPassword } = body(req);
      const account = await service.updateAdminProfile({ userId: req.params.userId, displayName,
        currentPassword, actor: req.auth });
      broadcast();
      return res.json({ success: true, data: account });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:userId/reset-password', async (req, res, next) => {
    try {
      const { newPassword, currentPassword } = body(req);
      const account = await service.resetAdminPassword({ userId: req.params.userId, newPassword,
        currentPassword, actor: req.auth });
      return res.json({ success: true, data: account });
    } catch (error) {
      return next(error);
    }
  });

  for (const [path, active] of [['activate', true], ['deactivate', false]]) {
    router.post(`/:userId/${path}`, async (req, res, next) => {
      try {
        const account = await service.setAdminActive({ userId: req.params.userId, active,
          currentPassword: body(req).currentPassword, actor: req.auth });
        broadcast();
        return res.json({ success: true, data: account });
      } catch (error) {
        return next(error);
      }
    });
  }

  return router;
}

export const accountRouter = createAccountRouter();
