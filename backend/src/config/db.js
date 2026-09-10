import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export async function connectDatabase() {
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 5,
    minPoolSize: 0,
  });

  logger.info('MongoDB connected');
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  }
}

export function getDatabaseState() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] ?? 'unknown';
}

export async function checkDatabaseReadiness({ timeoutMs = 2_000 } = {}) {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return false;
  }

  try {
    await mongoose.connection.db.admin().ping({ maxTimeMS: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
