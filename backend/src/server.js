import { createServer } from 'node:http';
import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env, validateEnvironment } from './config/env.js';
import { LIFECYCLE_STATES, setLifecycleState } from './config/lifecycle.js';
import { createSocketServer } from './socket.js';
import { logger } from './utils/logger.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

export const httpServer = createServer(app);

// HTTP timeouts configured to prevent race conditions behind reverse proxies (Render)
// while supporting WebSocket upgrades, Socket.IO long-polling, and PDF stream downloads.
httpServer.keepAliveTimeout = 65_000;
httpServer.headersTimeout = 66_000;

export const io = createSocketServer(httpServer);

let shuttingDown = false;

export async function startServer() {
  validateEnvironment();
  await connectDatabase();

  return new Promise((resolve) => {
    httpServer.listen(env.port, () => {
      setLifecycleState(LIFECYCLE_STATES.READY);
      logger.info('server.started', { port: env.port });
      resolve(httpServer);
    });
  });
}

export async function shutdown(signal = 'MANUAL', { exitCode = 0 } = {}) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  setLifecycleState(LIFECYCLE_STATES.DRAINING);

  logger.info('server.shutdown.started', { signal });

  // Ensure shutdown does not hang indefinitely
  const forceExitTimer = setTimeout(() => {
    logger.error('server.shutdown.timeout', {
      signal,
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
      message: 'Graceful shutdown exceeded timeout limit. Forcing termination.',
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    // 1. Stop accepting new HTTP requests
    if (httpServer.listening) {
      await new Promise((resolve) => httpServer.close(resolve));
    }

    // 2. Disconnect Socket.IO clients
    if (io) {
      io.disconnectSockets(true);
      await new Promise((resolve) => io.close(resolve));
    }

    // 3. Disconnect database
    await disconnectDatabase();

    setLifecycleState(LIFECYCLE_STATES.STOPPED);
    logger.info('server.shutdown.completed', { signal });
    clearTimeout(forceExitTimer);

    if (exitCode !== null) {
      process.exit(exitCode);
    }
  } catch (error) {
    logger.error('server.shutdown.error', { signal, message: error.message });
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT', { exitCode: 0 }));
process.once('SIGTERM', () => void shutdown('SIGTERM', { exitCode: 0 }));

process.on('uncaughtException', (error) => {
  logger.error('process.uncaught_exception', {
    name: error.name,
    message: error.message,
  });
  void shutdown('uncaughtException', { exitCode: 1 });
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  logger.error('process.unhandled_rejection', { message });
  void shutdown('unhandledRejection', { exitCode: 1 });
});

// Run startup only when invoked directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startServer().catch((error) => {
    logger.error('server.start_failed', { message: error.message });
    void disconnectDatabase().finally(() => {
      process.exit(1);
    });
  });
}
