import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

// What the chaos API can make a pod do. Each one is healed by a different Kubernetes mechanism.
export const defaultActions = {
  crash: () => process.exit(1), // kubelet restarts the container
  leak: () => { // grows past the memory limit -> OOMKilled (exit 137)
    const hog = [];
    setInterval(() => hog.push(Buffer.alloc(16 * 1024 * 1024, 1)), 250);
  },
  hang: () => { for (;;) { /* block the event loop until the liveness probe restarts us */ } },
};

export function tokenOk(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildApp({ config, db, actions = defaultActions, logger = true }) {
  const app = Fastify({ logger });

  app.get('/healthz', async () => ({ ok: true }));

  // Readiness checks the admin database only: one tenant database failing must not pull every pod out of service.
  app.get('/readyz', async (req, reply) => {
    if (config.readinessAlwaysFail) return reply.code(503).send({ ready: false, reason: 'bad-release' });
    try {
      await db.ping();
      return { ready: true };
    } catch (err) {
      req.log.warn({ err: err.message }, 'readiness: admin database unreachable');
      return reply.code(503).send({ ready: false, reason: 'database' });
    }
  });

  app.get('/api/whoami', async () => ({
    pod: config.pod,
    version: config.version,
    tenants: (await db.listTenants()).length,
  }));

  app.get('/api/clinics', async () => (await db.listTenants()).map(({ slug, name }) => ({ slug, name })));

  app.register(async (internal) => {
    internal.addHook('onRequest', async (req, reply) => {
      if (!tokenOk(req.headers['x-chaos-token'], config.internalToken)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
    });
    internal.post('/internal/:action', async (req, reply) => {
      const name = req.params.action;
      if (!Object.hasOwn(actions, name)) return reply.code(404).send({ error: 'unknown action' });
      setTimeout(actions[name], 100); // let the 202 reach the caller first
      return reply.code(202).send({ accepted: name, pod: config.pod });
    });
  });

  return app;
}
