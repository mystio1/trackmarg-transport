import pino from 'pino';
import { config } from '../env.js';

export const logger = pino({
  level: config.isProduction ? 'info' : 'debug',
  ...(config.isProduction
    ? {}
    : { transport: { target: 'pino/file', options: { destination: 1 } } }),
});
