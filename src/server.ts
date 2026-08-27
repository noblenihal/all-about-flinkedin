import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { docsRouter } from './routes/docs';
import { healthRouter } from './routes/health';
import { profileRouter } from './routes/profile';

export function createServer(): Express {
  const app = express();

  // Render/Railway/Fly all terminate TLS at a proxy; without this the rate
  // limiter buckets every client under the proxy's own IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The demo page is a single self-contained file with inline styles.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'https://media.licdn.com', 'data:'],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
  app.use(express.json({ limit: '64kb' }));

  app.use('/api/v1', healthRouter);
  app.use('/api/v1', docsRouter);
  app.use('/api/v1', profileRouter);

  // Convenience aliases so a bare probe against the root host works.
  app.use(healthRouter);

  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
