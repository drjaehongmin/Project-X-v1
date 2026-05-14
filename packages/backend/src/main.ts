// Entry point.  Loads config from env, builds the server, and starts
// listening on the controller-assigned backend port.

import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { closeDb } from './db/client.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

  // Graceful shutdown so connections drain in-flight requests cleanly.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await closeDb();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error({ err }, 'failed to start');
    process.exit(1);
  }
}

void main();
