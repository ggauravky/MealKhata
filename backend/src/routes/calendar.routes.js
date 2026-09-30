import { Router } from 'express';
import { monthMealService } from '../calendar/monthMeal.service.js';
import { env } from '../config/env.js';
import { MEMBER_IDS } from '../config/members.js';
import { ROLES } from '../auth/permissions.js';
import { canEditDate, getLogicalDateInTimeZone } from '../utils/date.js';
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

export function createCalendarRouter({
  service = monthMealService,
  now = () => new Date(),
  timezone = env.appTimezone,
} = {}) {
  const router = Router();

  router.get('/:month', validateMonth, async (req, res) => {
    const currentTime = now();
    const today = getLogicalDateInTimeZone(currentTime, timezone);
    const data = await service.getMonth(req.params.month);

    res.json({
      success: true,
      data: {
        ...data,
        today,
        days: data.days.map((day) => {
          const isDateEditable = canEditDate({
            role: req.auth?.role,
            targetDate: day.date,
            now: currentTime,
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
            ...day,
            permissions: {
              canEdit: isDateEditable && editableMemberIds.length > 0,
              editableMemberIds,
            },
          };
        }),
      },
    });
  });

  return router;
}

export const calendarRouter = createCalendarRouter();

