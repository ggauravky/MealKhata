import { createServer } from 'node:http';
import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env, validateEnvironment } from './config/env.js';
import { createSocketServer } from './socket.js';
import { logger } from './utils/logger.js';

const httpServer = createServer(app);
const io = createSocketServer(httpServer);
let shuttingDown = false;

async function startServer() {
  validateEnvironment();
  await connectDatabase();

  httpServer.listen(env.port, () => {
    logger.info(`MealKhata server listening on port ${env.port}`);
  });
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info(`${signal} received. Shutting down.`);

  const httpClosed = httpServer.listening
    ? new Promise((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    })
    : Promise.resolve();

  io.disconnectSockets(true);
  await new Promise((resolve) => io.close(resolve));
  await httpClosed;
  await disconnectDatabase();
  logger.info('Shutdown complete');
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

startServer().catch((error) => {
  logger.error('Server failed to start', { message: error.message });
  void disconnectDatabase();
  process.exitCode = 1;
});
