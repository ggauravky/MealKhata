import { Router } from 'express';
import { MEMBER_IDS } from '../config/members.js';
import { env } from '../config/env.js';
import { ROLES } from '../auth/permissions.js';
import { requireAdminOrAbove, requireAuthenticated } from '../middleware/authorize.js';
import { authorizeLogicalDate } from '../middleware/dateAuthorization.js';
import { authorizeMemberResource } from '../middleware/memberAuthorization.js';
import { canEditDate, getLogicalDateInTimeZone, isValidLogicalDate } from '../utils/date.js';
import { MEAL_STATUSES, MEAL_TYPES } from '../meals/meal.constants.js';
import { mealService } from '../meals/meal.service.js';
import { broadcastMealUpdated } from '../socket.js';

function reject(res, message) {
  return res.status(400).json({ success: false, message });
}

function validateDate(req, res, next) {
  if (!isValidLogicalDate(req.params.date)) {
    return reject(res, 'Date must be a valid calendar date in YYYY-MM-DD format.');
  }

  return next();
}

function validateMealChange(req, res, next) {
  const body = req.body;

  if (!body || Array.isArray(body) || typeof body !== 'object') {
    return reject(res, 'A meal change is required.');
  }

  if (!MEAL_TYPES.includes(body.mealType)) {
    return reject(res, 'Invalid meal type.');
  }

  if (!MEMBER_IDS.includes(body.memberId)) {
    return reject(res, 'Invalid member.');
  }

  if (!MEAL_STATUSES.includes(body.status)) {
    return reject(res, 'Invalid meal status.');
  }

  req.mealChange = {
    mealType: body.mealType,
    memberId: body.memberId,
    status: body.status,
  };

  return next();
}

function parseHistoryLimit(value) {
  if (value === undefined) {
    return 50;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }

  const limit = Number.parseInt(value, 10);
  return limit >= 1 && limit <= 100 ? limit : null;
}

function withPermissions(data, req, now, timezone) {
  const isDateEditable = canEditDate({
    role: req.auth?.role,
    targetDate: data.date,
    now,
    timeZone: timezone,
  });

  let editableMemberIds = [];
  if (isDateEditable) {
    if (req.auth?.role === ROLES.SUPERADMIN || req.auth?.role === ROLES.ADMIN) {
      editableMemberIds = [...MEMBER_IDS];
    } else if (req.auth?.role === ROLES.MEMBER && req.auth.memberId) {
      editableMemberIds = [req.auth.memberId];
    }
  }

  return {
    ...data,
    permissions: {
      canEdit: isDateEditable && editableMemberIds.length > 0,
      editableMemberIds,
    },
  };
}

export function createMealRouter({
  service = mealService,
  broadcast = broadcastMealUpdated,
  now = () => new Date(),
  timezone = env.appTimezone,
} = {}) {
  const router = Router();

  router.get('/today', async (req, res) => {
    const currentTime = now();
    const date = getLogicalDateInTimeZone(currentTime, timezone);
    const data = await service.getDay(date);

    res.json({ success: true, data: withPermissions(data, req, currentTime, timezone) });
  });

  router.get('/:date/history', requireAdminOrAbove, validateDate, async (req, res) => {
    const limit = parseHistoryLimit(req.query.limit);

    if (limit === null) {
      return reject(res, 'History limit must be an integer from 1 to 100.');
    }

    const data = await service.getHistory(req.params.date, limit);
    return res.json({ success: true, data });
  });

  router.patch(
    '/:date',
    requireAuthenticated,
    validateDate,
    validateMealChange,
    authorizeLogicalDate({ source: 'params', now, timeZone: timezone }),
    authorizeMemberResource({ source: 'mealChange', field: 'memberId' }),
    async (req, res) => {
      const result = await service.changeStatus({
        date: req.logicalDate,
        ...req.mealChange,
        actorRole: req.auth.role,
        actorMemberId: req.auth.role === ROLES.MEMBER ? req.auth.memberId : null,
      });

      if (result.changed) {
        broadcast({
          date: result.data.date,
          mealType: req.mealChange.mealType,
          memberId: req.mealChange.memberId,
          status: req.mealChange.status,
          revision: result.data.revision,
          updatedAt: result.data.updatedAt,
        });
      }

      return res.json({
        success: true,
        changed: result.changed,
        data: withPermissions(result.data, req, now(), timezone),
      });
    },
  );

  router.get('/:date', validateDate, async (req, res) => {
    const currentTime = now();
    const data = await service.getDay(req.params.date);

    res.json({ success: true, data: withPermissions(data, req, currentTime, timezone) });
  });

  return router;
}

export const mealRouter = createMealRouter();
