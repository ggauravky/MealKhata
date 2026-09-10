import { isProduction } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;

  const log = statusCode >= 500 ? logger.error : logger.warn;

  log(statusCode >= 500 ? 'Request failed' : 'Request rejected', {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    message: error.message,
    ...(statusCode >= 500 && !isProduction ? { stack: error.stack } : {}),
  });

  return res.status(statusCode).json({
    success: false,
    message:
      statusCode >= 500 && !error.expose
        ? 'Something went wrong'
        : error.message || 'Something went wrong',
  });
}
