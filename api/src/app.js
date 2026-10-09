import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createMetrics } from './metrics.js';

const strictAjv = addFormats(new Ajv({ allErrors: true, removeAdditional: false }));

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
  // Which pod answered, on every response (errors too): the lab console draws each visit landing on it.
  app.addHook('onSend', async (req, reply) => { reply.header('x-pod', config.pod); });

  const { register, duration } = createMetrics(db);
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url;
    if (route === '/metrics') return;
    duration.observe({ method: req.method, route: route ?? 'unmatched', status: reply.statusCode }, reply.elapsedTime / 1000);
  });
  app.get('/metrics', async (req, reply) => reply.type(register.contentType).send(await register.metrics()));

  // Public site: never echo internal error text (DB hosts, users) in 5xx responses.
  app.setErrorHandler((err, req, reply) => {
    if ((err.statusCode ?? 500) >= 500) {
      req.log.error({ err: err.message }, 'request failed');
      return reply.code(500).send({ error: 'internal' });
    }
    return reply.send(err); // 4xx (e.g. validation) keep Fastify's message
  });

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

  app.get('/api/clinics/:slug/appointments', async (req, reply) => {
    const pool = await db.tenant(req.params.slug);
    if (!pool) return reply.code(404).send({ error: 'unknown clinic' });
    const { rows } = await pool.query('select id, patient, at, reminded from appointments order by at desc limit 20');
    return rows;
  });

  app.post('/api/clinics/:slug/appointments', {
    schema: {
      body: {
        type: 'object',
        required: ['patient', 'at'],
        additionalProperties: false,
        properties: {
          patient: { type: 'string', minLength: 1, maxLength: 80 },
          at: { type: 'string', format: 'date-time', pattern: '^20[0-9]{2}-' },
        },
      },
    },
    validatorCompiler: ({ schema }) => strictAjv.compile(schema),
  }, async (req, reply) => {
    const pool = await db.tenant(req.params.slug);
    if (!pool) return reply.code(404).send({ error: 'unknown clinic' });
    const { rows } = await pool.query(
      'insert into appointments (patient, at) values ($1, $2) returning id, patient, at, reminded',
      [req.body.patient, req.body.at],
    );
    // ponytail: public demo, keep only the newest 200 rows per clinic; a proper retention job if this ever matters
    await pool.query('delete from appointments where id not in (select id from appointments order by id desc limit 200)');
    return reply.code(201).send(rows[0]);
  });

  // Deliberately CPU-heavy, for the traffic-spike experiment and the HPA.
  app.get('/api/work', async () => {
    let h = 'work';
    for (let i = 0; i < 20000; i++) h = createHash('sha256').update(h).digest('hex');
    return { hash: h.slice(0, 12) };
  });

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
