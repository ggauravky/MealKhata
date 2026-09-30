import mongoose from 'mongoose';
import { env, validatePushRunnerEnvironment } from '../src/config/env.js';
import { reminderDispatchService } from '../src/push/reminderDispatch.service.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  try {
    validatePushRunnerEnvironment(env);
  } catch (error) {
    logger.warn(`Push reminder runner configuration skipped: ${error.message}`);
    process.exit(0);
  }

  try {
    await mongoose.connect(env.mongoUri);
    logger.info('Connected to MongoDB for scheduled push reminders.');

    const summary = await reminderDispatchService.dispatchReminders();

    if (summary.dueMeals.length === 0) {
      logger.info(`No meal reminders due at ${summary.time} (${summary.date}).`);
    } else {
      logger.info(
        `Scheduled reminder run finished for [${summary.dueMeals.join(', ')}]. ` +
          `Attempted: ${summary.attemptedCount}, Sent: ${summary.sentCount}, Expired: ${summary.expiredCount}, Failed: ${summary.failedCount}`,
      );
    }
  } catch (error) {
    logger.error('Failed to execute scheduled push reminders:', error);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch {
      // Disconnection cleanup error
    }
  }
}

main();
