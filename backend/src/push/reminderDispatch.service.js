import { MEMBER_IDS } from '../config/members.js';
import { env } from '../config/env.js';
import { mealService } from '../meals/meal.service.js';
import { reminderSettingsService } from '../settings/reminderSettings.service.js';
import { getLogicalDateInTimeZone } from '../utils/date.js';
import { logger } from '../utils/logger.js';
import { pushDeliveryRepository } from './pushDelivery.repository.js';
import { pushSubscriptionRepository } from './pushSubscription.repository.js';
import { webPushService } from './webPush.service.js';

export function getLogicalTimeInTimeZone(now = new Date(), timeZone = env.appTimezone) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.hour}:${values.minute}`;
}

export function isReminderDue({ scheduledTime, currentTime, windowMinutes = 15 }) {
  if (!scheduledTime || !currentTime) return false;
  const [sHour, sMin] = scheduledTime.split(':').map(Number);
  const [cHour, cMin] = currentTime.split(':').map(Number);
  const sTotal = sHour * 60 + sMin;
  let cTotal = cHour * 60 + cMin;
  if (cTotal < sTotal && sTotal >= 1440 - windowMinutes) {
    cTotal += 1440;
  }
  const diff = cTotal - sTotal;
  return diff >= 0 && diff <= windowMinutes;
}

export function createReminderDispatchService({
  settingsService = reminderSettingsService,
  meals = mealService,
  subscriptions = pushSubscriptionRepository,
  deliveries = pushDeliveryRepository,
  push = webPushService,
  timezone = env.appTimezone,
} = {}) {
  return Object.freeze({
    async dispatchReminders({ now = new Date(), forceMealType = null } = {}) {
      const logicalDate = getLogicalDateInTimeZone(now, timezone);
      const currentTime = getLogicalTimeInTimeZone(now, timezone);

      const settings = await settingsService.getSettings();
      const reminders = settings?.reminders;

      const dueMealTypes = [];

      for (const mealType of ['morning', 'night']) {
        if (forceMealType && forceMealType !== mealType) continue;

        const config = reminders?.[mealType];
        if (!config?.enabled) continue;

        if (forceMealType === mealType || isReminderDue({ scheduledTime: config.time, currentTime })) {
          dueMealTypes.push(mealType);
        }
      }

      if (dueMealTypes.length === 0) {
        return {
          executed: true,
          date: logicalDate,
          time: currentTime,
          dueMeals: [],
          attemptedCount: 0,
          sentCount: 0,
          expiredCount: 0,
          failedCount: 0,
        };
      }

      const mealDay = await meals.getDay(logicalDate);
      let attemptedCount = 0;
      let sentCount = 0;
      let expiredCount = 0;
      let failedCount = 0;

      for (const mealType of dueMealTypes) {
        for (const memberId of MEMBER_IDS) {
          const status = mealDay?.meals?.[mealType]?.[memberId];

          // Smart filter: Only send reminders if member is Taking
          if (status !== 'taking') {
            continue;
          }

          const memberSubs = await subscriptions.findActiveByMemberId(memberId);

          for (const sub of memberSubs) {
            // Check device-specific preference for this meal
            if (sub.preferences?.[mealType] === false) {
              continue;
            }

            const dispatchKey = `${logicalDate}:${mealType}:${sub.subscriptionId}`;
            const claimed = await deliveries.claimDispatch({
              dispatchKey,
              memberId,
              mealType,
              logicalDate,
              subscriptionId: sub.subscriptionId,
            });

            // If another runner or earlier run already claimed this, skip deduplicated
            if (!claimed) {
              continue;
            }

            attemptedCount += 1;

            const isMorning = mealType === 'morning';
            const payload = {
              title: isMorning ? 'Morning meal reminder' : 'Night meal reminder',
              body: isMorning
                ? 'Your Morning meal is currently Taking. Open MealKhata if you need to change it.'
                : 'Your Night meal is currently Taking. Open MealKhata if you need to change it.',
              tag: `mealkhata:${logicalDate}:${mealType}`,
              url: `/?meal=${mealType}`,
              data: {
                mealType,
                date: logicalDate,
                url: `/?meal=${mealType}`,
              },
            };

            try {
              await push.sendNotification(sub, payload);
              await deliveries.markSent(dispatchKey);
              await subscriptions.recordSuccess(sub.subscriptionId);
              sentCount += 1;
            } catch (error) {
              const isGone =
                error?.isGone ||
                error?.isExpired ||
                error?.statusCode === 410 ||
                error?.statusCode === 404;

              if (isGone) {
                await subscriptions.deactivate(sub.endpoint);
                await deliveries.markGone(dispatchKey);
                expiredCount += 1;
              } else {
                await deliveries.markFailed(dispatchKey, error?.message);
                await subscriptions.recordFailure(sub.subscriptionId, error?.message);
                failedCount += 1;
              }
            }
          }
        }
      }

      logger.info(
        `Push reminder dispatch completed for ${dueMealTypes.join(', ')} on ${logicalDate}. ` +
          `Attempted: ${attemptedCount}, Sent: ${sentCount}, Expired: ${expiredCount}, Failed: ${failedCount}`,
      );

      return {
        executed: true,
        date: logicalDate,
        time: currentTime,
        dueMeals: dueMealTypes,
        attemptedCount,
        sentCount,
        expiredCount,
        failedCount,
      };
    },
  });
}

export const reminderDispatchService = createReminderDispatchService();
