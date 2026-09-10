import { isTest } from '../config/env.js';

function write(method, message, metadata) {
  if (isTest) {
    return;
  }

  const timestamp = new Date().toISOString();
  const payload = metadata ? ` ${JSON.stringify(metadata)}` : '';
  console[method](`[${timestamp}] ${message}${payload}`);
}

export const logger = {
  info(message, metadata) {
    write('info', message, metadata);
  },
  warn(message, metadata) {
    write('warn', message, metadata);
  },
  error(message, metadata) {
    write('error', message, metadata);
  },
};
