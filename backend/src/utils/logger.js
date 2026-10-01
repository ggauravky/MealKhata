import { isProduction, isTest } from '../config/env.js';
import { sanitizeLogMetadata } from './sanitizer.js';

let logSink = null;

export function setLogSinkForTesting(sink) {
  logSink = sink;
}

function writeLog(level, messageOrEvent, metadata = {}) {
  const sanitizedMeta = sanitizeLogMetadata(metadata) || {};
  const timestamp = new Date().toISOString();

  if (logSink) {
    logSink({ timestamp, level, messageOrEvent, metadata: sanitizedMeta });
  }

  if (isTest && !process.env.ENABLE_TEST_LOGS) {
    return;
  }

  if (isProduction) {
    const logObject = {
      timestamp,
      level,
      event: typeof messageOrEvent === 'string' ? messageOrEvent : 'log',
      ...sanitizedMeta,
    };
    if (typeof messageOrEvent === 'string' && !sanitizedMeta.message) {
      logObject.message = messageOrEvent;
    }
    const output = JSON.stringify(logObject);
    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
    return;
  }

  // Development and default fallback: Human-readable single line
  const metaString = Object.keys(sanitizedMeta).length > 0 ? ` ${JSON.stringify(sanitizedMeta)}` : '';
  const formatted = `[${timestamp}] [${level.toUpperCase()}] ${messageOrEvent}${metaString}`;
  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
}

export const logger = {
  info(messageOrEvent, metadata) {
    writeLog('info', messageOrEvent, metadata);
  },
  warn(messageOrEvent, metadata) {
    writeLog('warn', messageOrEvent, metadata);
  },
  error(messageOrEvent, metadata) {
    writeLog('error', messageOrEvent, metadata);
  },
  event(eventName, metadata) {
    writeLog('info', eventName, metadata);
  },
};
