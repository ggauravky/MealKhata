import { canEditDate, isValidLogicalDate } from '../utils/date.js';

export function authorizeLogicalDate({
  source = 'body',
  field = 'date',
  now = () => new Date(),
  timeZone,
} = {}) {
  return function checkLogicalDatePermission(req, res, next) {
    const targetDate = req[source]?.[field];

    if (!isValidLogicalDate(targetDate)) {
      return res.status(400).json({
        success: false,
        message: 'Date must be a valid calendar date in YYYY-MM-DD format.',
      });
    }

    if (!canEditDate({ role: req.auth?.role, targetDate, now: now(), timeZone })) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this date.',
      });
    }

    req.logicalDate = targetDate;
    return next();
  };
}
