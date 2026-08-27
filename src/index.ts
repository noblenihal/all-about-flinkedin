import { config } from './config';
import { logger } from './logger';
import { createServer } from './server';
import { sessionStatus } from './linkedin/session';

const app = createServer();

const server = app.listen(config.port, () => {
  const status = sessionStatus();
  logger.info('LinkedIn Profile API listening', {
    port: config.port,
    env: config.nodeEnv,
    credentials: status.configured,
  });

  if (status.configured === 'none') {
    logger.warn(
      'No LinkedIn credentials configured. Set LINKEDIN_EMAIL and LINKEDIN_PASSWORD (or ' +
        'LINKEDIN_LI_AT) or every profile request will fall back to the public page.',
    );
  }
});

/**
 * Graceful shutdown: platforms send SIGTERM and then hard-kill after a grace
 * period, so finish in-flight requests rather than dropping them.
 */
function shutdown(signal: string): void {
  logger.info('Shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});
