import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { apiRouter } from './routes/api.js';
import type { Runtime } from './runtime.js';
import { createGuard } from './security.js';

export function createApp(rt: Runtime): Express {
  const app = express();
  const guard = createGuard(rt.config);

  app.disable('x-powered-by');
  app.use('/api', guard.middleware, apiRouter(rt));

  // Production: serve the built dashboard from the same origin.
  const index = path.join(rt.config.clientDist, 'index.html');
  if (fs.existsSync(index)) {
    app.use(express.static(rt.config.clientDist, { index: false }));
    app.get('/{*path}', (_req, res) => res.sendFile(index));
  }

  return app;
}
