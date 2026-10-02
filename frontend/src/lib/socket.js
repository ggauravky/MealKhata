import { io } from 'socket.io-client';

const socketOrigin = import.meta.env.VITE_SOCKET_URL?.trim() || undefined;

export const socket = io(socketOrigin, {
  autoConnect: false,
  path: '/socket.io',
  transports: ['websocket', 'polling'],
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
