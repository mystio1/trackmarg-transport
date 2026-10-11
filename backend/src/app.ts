import express, { type Express } from 'express';
import cors from 'cors';
import { securityHeaders } from './middleware/security.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiRouter } from './routes/index.js';
import { rootHealthRouter } from './routes/health.routes.js';
import { mountStatic } from './static.js';

// Exported WITHOUT .listen() so tests (supertest) can mount this directly without opening a
// real port. index.ts is the only place that calls .listen().
export function buildApp(): Express {
  const app = express();

  // Mounted before EVERYTHING else (trust proxy, helmet, CORS, body parsing, the API router) so
  // GET /health can never be delayed or broken by anything below it — this is the path to give
  // Render's Health Check Path field and any external uptime monitor.
  app.use(rootHealthRouter);

  // Render (and any reverse-proxy host) sits in front of this app — without `trust proxy`,
  // express-rate-limit and req.ip would see the proxy's IP for every request, either disabling
  // brute-force protection for everyone or rate-limiting all users together. Harmless locally
  // (no proxy present, X-Forwarded-For is simply absent).
  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(requestLogger());
  // Default origin '*' — intentional. The frontend can be pointed at any backend URL (LAN IP,
  // Cloudflare Tunnel domain, a custom address entered on the login screen), and auth uses a
  // manually-attached Bearer token (not cookies), so a wildcard origin doesn't hand out ambient
  // credentials the way it would for cookie-based auth. Matches backend/server.mjs's existing
  // Access-Control-Allow-Origin: * on every response.
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  app.use('/api', apiRouter);
  mountStatic(app);

  app.use(errorHandler());
  return app;
}
