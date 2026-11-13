import { Server } from 'socket.io';
import { env, isProduction } from './config/env.js';
import { verifyActiveSocketIdentity, verifySocketTicket } from './auth/socketTicket.service.js';
import { logger } from './utils/logger.js';

let activeSocketServer = null;

export function createSocketServer(httpServer, { config = env,
  production = isProduction, verifyTicket = verifySocketTicket,
  verifyActive = verifyActiveSocketIdentity, revalidateIntervalMs = 15_000 } = {}) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    cors: {
      origin: production ? config.appOrigin : true,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Every socket must come from the configured app origin and present a short-lived
  // ticket minted for an active, canonical account session.
  io.use(async (socket, next) => {
    if (socket.handshake.headers.origin !== config.appOrigin) {
      logger.warn('socket.origin_rejected', { socketId: socket.id });
      return next(new Error('Unauthorized origin'));
    }
    try {
      socket.data.identity = await verifyTicket(socket.handshake.auth?.ticket);
    } catch {
      return next(new Error('Unauthorized socket session'));
    }
    return next();
  });

  activeSocketServer = io;

  io.on('connection', (socket) => {
    logger.info('socket.connected', { socketId: socket.id });

    const timer = setInterval(async () => {
      try {
        if (!await verifyActive(socket.data.identity)) socket.disconnect(true);
      } catch { socket.disconnect(true); }
    }, revalidateIntervalMs);
    timer.unref();
    socket.once('disconnect', () => clearInterval(timer));

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
