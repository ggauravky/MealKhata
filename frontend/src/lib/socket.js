import { io } from 'socket.io-client';

const socketOrigin = import.meta.env.VITE_SOCKET_URL?.trim() || undefined;

export const socket = io(socketOrigin, {
  autoConnect: false,
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  // Each (re)connection attempt fetches a fresh short-lived ticket for the signed-in session.
  auth: (callback) => {
    fetch('/api/auth/socket-ticket', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => response.ok ? (await response.json()).ticket : null)
      .then(ticket => callback({ ticket }))
      .catch(() => callback({ ticket: null }));
  },
});

export function connectSocket() {
  if (!socket.connected) {
    socket.connect();
  }
}

export function disconnectSocket() {
  if (socket.connected) {
    socket.disconnect();
  }
}

export function getSocket() {
  return socket;
}
