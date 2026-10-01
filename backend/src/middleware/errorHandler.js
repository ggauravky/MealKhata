import { isProduction } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const requestId = req.id || res.getHeader('X-Request-ID');

  // Handle malformed JSON from express.json()
  if (error instanceof SyntaxError && 'body' in error && error.status === 400) {
    logger.warn('request.malformed_json', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: 400,
      message: 'Malformed JSON payload received',
    });
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON payload',
    });
  }

  // Handle payload too large
  if (error.type === 'entity.too.large' || error.status === 413) {
    logger.warn('request.payload_too_large', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: 413,
      message: 'Request payload exceeded limit',
    });
    return res.status(413).json({
      success: false,
      message: 'Payload too large',
    });
  }

  const statusCode = Number.isInteger(error.statusCode)
    ? error.statusCode
    : Number.isInteger(error.status)
      ? error.status
      : 500;

  if (statusCode >= 500) {
    logger.error('request.failed', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode,
      message: error.message,
      code: error.code,
      ...(!isProduction ? { stack: error.stack } : {}),
    });

    return res.status(statusCode).json({
      success: false,
      message: error.expose ? error.message : 'Something went wrong',
      ...(requestId ? { requestId } : {}),
    });
  }

  logger.warn('request.rejected', {
    requestId,
    method: req.method,
    path: req.path,
    statusCode,
    message: error.message,
  });

  return res.status(statusCode).json({
    success: false,
    message: error.message || 'Something went wrong',
  });
}
