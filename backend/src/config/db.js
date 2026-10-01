import dns from 'node:dns';
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

  const connectOptions = {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 5,
    minPoolSize: 0,
  };

  try {
    await mongoose.connect(env.mongoUri, connectOptions);
  } catch (error) {
    const isSrvError =
      env.mongoUri?.startsWith('mongodb+srv://') &&
      (error.message?.includes('querySrv') ||
        error.code === 'ECONNREFUSED' ||
        error.name === 'MongooseServerSelectionError');

    if (isSrvError) {
      logger.warn('database.srv_dns_fallback', {
        message: 'SRV lookup failed with system DNS; retrying with public resolvers (8.8.8.8, 1.1.1.1)...',
      });
      dns.setServers(['8.8.8.8', '1.1.1.1']);
      await mongoose.connect(env.mongoUri, connectOptions);
      return;
    }

    throw error;
  }
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
