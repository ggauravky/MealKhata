import { Router } from 'express';
import { requireSuperAdmin } from '../middleware/authorize.js';
import { broadcastReminderSettingsUpdated } from '../socket.js';
import { isValidLogicalTime } from '../settings/reminder.constants.js';
import { reminderSettingsService } from '../settings/reminderSettings.service.js';

const MEAL_TYPES = ['morning', 'night'];

function validateReminderInput(req, res, next) {
  const body = req.body;
  const reminders = body?.reminders;
  const validTopLevel = body && !Array.isArray(body) && typeof body === 'object' &&
    Object.keys(body).length === 1 && Object.hasOwn(body, 'reminders');
  const validReminderKeys = reminders && !Array.isArray(reminders) && typeof reminders === 'object' &&
    Object.keys(reminders).length === MEAL_TYPES.length &&
    MEAL_TYPES.every((mealType) => Object.hasOwn(reminders, mealType));

  if (!validTopLevel || !validReminderKeys) {
    return res.status(400).json({ success: false, message: 'Invalid reminder settings.' });
  }

  const normalized = {};
  for (const mealType of MEAL_TYPES) {
    const entry = reminders[mealType];
    if (
      !entry ||
      Array.isArray(entry) ||
      typeof entry !== 'object' ||
      Object.keys(entry).length !== 2 ||
      !Object.hasOwn(entry, 'enabled') ||
      !Object.hasOwn(entry, 'time') ||
      typeof entry.enabled !== 'boolean' ||
      !isValidLogicalTime(entry.time)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Each reminder requires an enabled boolean and HH:mm time.',
      });
    }
    normalized[mealType] = { enabled: entry.enabled, time: entry.time };
  }

  req.reminderSettingsInput = normalized;
  return next();
}

export function createReminderSettingsRouter({
  service = reminderSettingsService,
  broadcast = broadcastReminderSettingsUpdated,
} = {}) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ success: true, data: await service.getSettings() });
  });

  router.put('/', requireSuperAdmin, validateReminderInput, async (req, res) => {
    const result = await service.updateSettings({
      reminders: req.reminderSettingsInput,
      actorRole: req.auth.role,
    });

    if (result.changed) {
      broadcast({
        revision: result.data.revision,
        reminders: result.data.reminders,
        updatedAt: result.data.updatedAt,
      });
    }

    res.json({ success: true, changed: result.changed, data: result.data });
  });

  return router;
}

export const reminderSettingsRouter = createReminderSettingsRouter();
