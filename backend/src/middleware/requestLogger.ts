import type { RequestHandler } from 'express';
import { logger } from '../services/logger.js';

export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level]({
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        duration,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }, `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
  };
}
