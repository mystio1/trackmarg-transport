// MUST be the first import — everything else may read process.env at import time.
import { config } from './env.js';
import os from 'node:os';
import { buildApp } from './app.js';
import { logger } from './services/logger.js';

function getLanIp(): string | null {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

const app = buildApp();

app.listen(config.port, config.host, () => {
  const lanIp = getLanIp();
  logger.info({
    local: `http://localhost:${config.port}`,
    lan: lanIp ? `http://${lanIp}:${config.port}` : undefined,
  }, 'Transport Manager server started (v2/Express)');
  console.log('\n========================================');
  console.log('  TRANSPORT MANAGER SERVER STARTED (v2/Express)');
  console.log('========================================');
  console.log(`  Admin (this laptop): http://localhost:${config.port}`);
  if (lanIp) {
    console.log(`  Drivers (phone/tablet): http://${lanIp}:${config.port}`);
  }
  console.log('  Database: Postgres via Prisma');
  console.log('========================================\n');
});
