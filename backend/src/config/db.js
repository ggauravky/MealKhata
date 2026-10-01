import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let eventsAttached = false;

function attachConnectionEvents() {
  if (eventsAttached) {
    return;
  }
  eventsAttached = true;

  mongoose.connection.on('connected', () => {
    logger.info('database.connected', { state: 'connected' });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('database.disconnected', { state: 'disconnected' });
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('database.reconnected', { state: 'connected' });
  });

  mongoose.connection.on('error', (error) => {
    logger.error('database.error', { message: error.message });
  });
}

export async function connectDatabase() {
  attachConnectionEvents();

  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 5,
    minPoolSize: 0,
  });
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('database.disconnected', { state: 'disconnected' });
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
