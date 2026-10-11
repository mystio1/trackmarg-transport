import { Router } from 'express';
import { now } from '../services/util.js';
import { prisma } from '../db/prisma.js';

export const healthRouter = Router();

// This endpoint MUST stay fast and never block on DB I/O — if the database is
// down we still want Render to see us as "up" (a healthy-but-DB-down process
// restarting would only make things worse, see routes/index.ts for context).
// The frontend's useKeepAlive hook also pings here every 4 minutes to prevent
// the free-tier server from spinning down during active use.
healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    time: now(),
    uptime: Math.floor(process.uptime()),        // seconds since server start
    memMb: Math.round(process.memoryUsage().rss / 1024 / 1024), // RSS in MB
  });
});

// Deep health check — verifies the DB connection is live. Use for monitoring
// dashboards, NOT as Render's Health Check Path (use /health for that, since a
// DB outage shouldn't trigger process restarts).
healthRouter.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ ok: true, db: 'connected', time: now() });
  } catch {
    res.status(503).json({ ok: false, db: 'unreachable', time: now() });
  }
});

// Bare GET /health at the app root (not under /api) — mounted first in app.ts, before helmet/
// CORS/json-body-parsing/the API router, so nothing can ever delay or block it: no auth, no
// rate limit, no DB call, no dependency on any other middleware initializing correctly. Exists
// specifically so Render's Health Check Path field and an external uptime monitor can be pointed
// at a single, minimal, always-fast path. /api/health above is unrelated and unchanged — the
// frontend's keep-alive ping and any existing Render config keep using that one.
export const rootHealthRouter = Router();
rootHealthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
