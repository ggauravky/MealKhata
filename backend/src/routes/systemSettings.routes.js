import { Router } from 'express';
import { requireAdminOrAbove, requireSuperAdmin } from '../middleware/authorize.js';
import { systemSettingsService } from '../settings/systemSettings.service.js';

export function createSystemSettingsRouter({ service = systemSettingsService } = {}) {
  const router = Router();

  router.get('/', requireAdminOrAbove, async (_req, res, next) => {
    try {
      return res.json({ success: true, data: await service.getSettings() });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/', requireSuperAdmin, async (req, res, next) => {
    try {
      const { financialStartDate, expectedRevision, currentPassword } = req.body ?? {};
      const data = await service.updateSettings({ financialStartDate, expectedRevision, currentPassword,
        actor: req.auth });
      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const systemSettingsRouter = createSystemSettingsRouter();
