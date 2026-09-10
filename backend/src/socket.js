import { Server } from 'socket.io';
import { logger } from './utils/logger.js';

let activeSocketServer = null;

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
  });

  activeSocketServer = io;

  io.on('connection', (socket) => {
    logger.info('Socket client connected', { socketId: socket.id });

    socket.on('disconnect', (reason) => {
      logger.info('Socket client disconnected', { socketId: socket.id, reason });
    });
  });

  return io;
}

export function broadcastMealUpdated(payload) {
  if (!activeSocketServer) {
    return false;
  }

  activeSocketServer.emit('meal:updated', payload);
  return true;
}

export function broadcastBillingRateUpdated(payload) {
  if (!activeSocketServer) {
    return false;
  }

  activeSocketServer.emit('billing:rate-updated', payload);
  return true;
}

export function broadcastPaymentUpdated(payload) {
  if (!activeSocketServer) {
    return false;
  }

  activeSocketServer.emit('payment:updated', payload);
  return true;
}

export function broadcastPaymentSettingsUpdated(payload) {
  if (!activeSocketServer) {
    return false;
  }

  activeSocketServer.emit('payment:settings-updated', payload);
  return true;
}

export function broadcastReminderSettingsUpdated(payload) {
  if (!activeSocketServer) {
    return false;
  }

  activeSocketServer.emit('settings:reminders-updated', payload);
  return true;
}
