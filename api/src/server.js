import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { buildApp } from './app.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
const db = createDb(config.db);
const app = buildApp({ config, db });

const jobs = config.runJobs ? startJobs({ db, log: app.log }) : null;

// Kubernetes sends SIGTERM, waits terminationGracePeriodSeconds, then SIGKILL.
// Closing Fastify finishes in-flight requests before we exit.
let closing = false;
const shutdown = async (signal) => {
  if (closing) return; // a second signal must not close pools twice
  closing = true;
  app.log.info({ signal }, 'shutting down');
  try {
    if (jobs) clearInterval(jobs);
    await app.close();
    await db.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err: err.message }, 'shutdown failed');
    process.exit(1);
  }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
