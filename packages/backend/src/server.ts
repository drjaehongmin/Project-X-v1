// Fastify factory.  Composes plugins, registers routes, and returns an
// app instance — used by `main.ts` (production entry) and by the
// integration tests (which build an in-process instance per test
// file).

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';

import type { BackendConfig } from './config.js';
import { getDb } from './db/client.js';
import { authPlugin } from './auth/plugin.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerAllergyRoutes } from './resources/allergies/index.js';
import { registerEncounterRoutes } from './resources/encounters/index.js';
import { registerIamRoutes } from './resources/iam/index.js';
import { registerPatientRoutes } from './resources/patients/index.js';
import { registerProblemRoutes } from './resources/problems/index.js';

export async function buildServer(
  config: BackendConfig,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(config.nodeEnv === 'development' && {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }),
    },
    disableRequestLogging: false,
    trustProxy: true,
  });

  registerErrorHandler(app);

  await app.register(sensible);
  await app.register(cors, {
    origin: config.frontendOrigin === '*' ? true : config.frontendOrigin,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Module-Id'],
  });
  await app.register(authPlugin, { config });

  const db = getDb(config);

  // Health: minimal, public.  Useful as a liveness probe and as a
  // smoke test that the server is up.
  app.get('/health', async () => ({ ok: true }));

  registerAuthRoutes(app, { config, db });
  registerPatientRoutes(app, { db });
  registerEncounterRoutes(app, { db });
  registerProblemRoutes(app, { db });
  registerAllergyRoutes(app, { db });
  registerIamRoutes(app, { db });

  return app;
}
