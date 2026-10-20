import { Server } from 'socket.io';
import { env, isProduction } from './config/env.js';
import { logger } from './utils/logger.js';

let activeSocketServer = null;

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    cors: {
      origin: isProduction ? env.appOrigin : true,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  if (isProduction) {
    io.use((socket, next) => {
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== env.appOrigin) {
        logger.warn('socket.origin_rejected', {
          socketId: socket.id,
          origin,
        });
        return next(new Error('Unauthorized origin'));
      }
      return next();
    });
  }

  activeSocketServer = io;

  io.on('connection', (socket) => {
    logger.info('socket.connected', { socketId: socket.id });

    socket.on('disconnect', (reason) => {
      logger.info('socket.disconnected', { socketId: socket.id, reason });
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

export function broadcastSettlementUpdated(payload) {
  if (!activeSocketServer) {
    return false;
  }

  activeSocketServer.emit('settlement:updated', payload);
  return true;
}

export function broadcastRoomFeesUpdated(payload) {
  if (!activeSocketServer) {
    return false;
  }

  activeSocketServer.emit('room-fees:updated', payload);
  return true;
}

export function broadcastExpensesUpdated(payload) {
  if (!activeSocketServer) {
    return false;
  }

  activeSocketServer.emit('expenses:updated', payload);
  return true;
}

export function broadcastStayUpdated(payload = { scope: 'stay' }) {
  if (!activeSocketServer) {
    return false;
  }

  activeSocketServer.emit('stay:updated', {
    scope: 'stay',
    revision: payload?.revision || Date.now().toString(),
  });
  return true;
}

export function broadcastDepositUpdated(payload = { scope: 'deposit' }) {
  if (!activeSocketServer) {
    return false;
  }

  activeSocketServer.emit('deposit:updated', {
    scope: 'deposit',
    revision: payload?.revision || Date.now().toString(),
  });
  return true;
}

export function broadcastClearanceUpdated(payload = { scope: 'clearance' }) {
  if (!activeSocketServer) {
    return false;
  }

  activeSocketServer.emit('clearance:updated', {
    scope: 'clearance',
    revision: payload?.revision || Date.now().toString(),
  });
  return true;
}
