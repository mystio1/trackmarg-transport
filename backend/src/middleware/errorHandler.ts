import crypto from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isDbConnectionError, recordDbFailure } from './dbCircuitBreaker.js';
import { logger } from '../services/logger.js';

// Routes throw this for any expected 4xx — mirrors the old send(res, status, {message}) calls
// in backend/server.mjs, just via `throw`/`next(err)` instead of an explicit early return.
export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ message: 'Route not found' });
};

// Must be mounted last. Detailed errors stay server-side only — the client gets a generic
// message plus a correlation ID so an incident can still be traced back to this log line if
// reported. Ported from backend/server.mjs's top-level http.createServer catch block.
export function errorHandler(): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
      return;
    }
    if (isDbConnectionError(err)) {
      recordDbFailure();
      const correlationId = crypto.randomBytes(6).toString('hex');
      logger.error({ correlationId, err }, 'database connection error');
      if (res.headersSent) { res.end(); return; }
      res.status(503).json({
        message: 'The database is temporarily unavailable — please try again in a few seconds.',
        code: 'DB_UNAVAILABLE',
        correlationId,
      });
      return;
    }
    const correlationId = crypto.randomBytes(6).toString('hex');
    logger.error({ correlationId, err }, 'unhandled error');
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ message: 'Something went wrong on our end.', correlationId });
  };
}
