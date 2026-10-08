import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { buildApp } from './app.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
const db = createDb(config.db);
const app = buildApp({ config, db });

if (config.runJobs) startJobs({ db, log: app.log });

// Kubernetes sends SIGTERM, waits terminationGracePeriodSeconds, then SIGKILL.
// Closing Fastify finishes in-flight requests before we exit.
const shutdown = async (signal) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
