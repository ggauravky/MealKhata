import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

const VALID_REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
const SLOW_REQUEST_THRESHOLD_MS = 1_000;

export function requestCorrelation(req, res, next) {
  const incomingId = req.get('x-request-id')?.trim();
  const requestId = incomingId && VALID_REQUEST_ID_PATTERN.test(incomingId)
    ? incomingId
    : randomUUID();

  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);

  const startHrTime = process.hrtime.bigint();

  res.on('finish', () => {
    // We only log completed API requests to keep static asset request noise minimal
    if (!req.path.startsWith('/api')) {
      return;
    }

    const elapsedNs = process.hrtime.bigint() - startHrTime;
    const durationMs = Number(elapsedNs / 1_000_000n);

    const logMeta = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    };

    if (durationMs >= SLOW_REQUEST_THRESHOLD_MS) {
      logger.warn('request.slow', logMeta);
    } else {
      logger.info('request.complete', logMeta);
    }
  });

  next();
}
