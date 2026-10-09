import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, tokenOk } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const config = (extra = {}) => ({
  ...loadConfig({ DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', INTERNAL_TOKEN: 'tok', HOSTNAME: 'api-1', APP_VERSION: 'v1' }),
  ...extra,
});
const fakeDb = (over = {}) => ({
  ping: async () => {},
  listTenants: async () => [{ slug: 'riverside', name: 'Riverside Family Clinic', db_name: 'clinic_riverside' }],
  tenant: async () => null,
  close: async () => {},
  poolStats: () => ({ total: 4, idle: 3, waiting: 0 }),
  ...over,
});
const app = (opts = {}) => buildApp({ config: config(), db: fakeDb(), logger: false, ...opts });

test('healthz is always ok', async () => {
  const res = await app().inject('/healthz');
  assert.equal(res.statusCode, 200);
});

test('readyz is 200 when the admin database answers', async () => {
  assert.equal((await app().inject('/readyz')).statusCode, 200);
});

test('readyz is 503 when the admin database fails', async () => {
  const res = await app({ db: fakeDb({ ping: async () => { throw new Error('down'); } }) }).inject('/readyz');
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().reason, 'database');
});

test('readyz is 503 in the bad-release build', async () => {
  const res = await app({ config: config({ readinessAlwaysFail: true }) }).inject('/readyz');
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().reason, 'bad-release');
});

test('whoami reports pod, version and tenant count', async () => {
  const res = await app().inject('/api/whoami');
  assert.deepEqual(res.json(), { pod: 'api-1', version: 'v1', tenants: 1 });
});

test('clinics list hides database names', async () => {
  const res = await app().inject('/api/clinics');
  assert.deepEqual(res.json(), [{ slug: 'riverside', name: 'Riverside Family Clinic' }]);
});

test('internal endpoints refuse a missing or wrong token', async () => {
  const calls = [];
  const a = app({ actions: { crash: () => calls.push('crash') } });
  assert.equal((await a.inject({ method: 'POST', url: '/internal/crash' })).statusCode, 401);
  assert.equal((await a.inject({ method: 'POST', url: '/internal/crash', headers: { 'x-chaos-token': 'nope' } })).statusCode, 401);
  assert.deepEqual(calls, []);
});

test('internal endpoints are disabled when no token is configured', async () => {
  const a = app({ config: config({ internalToken: '' }) });
  const res = await a.inject({ method: 'POST', url: '/internal/crash', headers: { 'x-chaos-token': '' } });
  assert.equal(res.statusCode, 401);
});

test('internal action runs after the 202 is sent', async () => {
  const calls = [];
  const a = app({ actions: { leak: () => calls.push('leak') } });
  const res = await a.inject({ method: 'POST', url: '/internal/leak', headers: { 'x-chaos-token': 'tok' } });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.json(), { accepted: 'leak', pod: 'api-1' });
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(calls, ['leak']);
});

test('unknown and prototype action names are 404', async () => {
  const a = app({ actions: { crash: () => {} } });
  for (const name of ['nope', 'constructor', '__proto__', 'toString']) {
    const res = await a.inject({ method: 'POST', url: `/internal/${name}`, headers: { 'x-chaos-token': 'tok' } });
    assert.equal(res.statusCode, 404, name);
  }
});

test('tokenOk compares exactly', () => {
  assert.equal(tokenOk('tok', 'tok'), true);
  assert.equal(tokenOk('tok2', 'tok'), false);
  assert.equal(tokenOk(undefined, 'tok'), false);
  assert.equal(tokenOk('', ''), false);
});

const fakePool = () => {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('insert')) return { rows: [{ id: 1, patient: params[0], at: params[1], reminded: false }] };
      return { rows: [{ id: 1, patient: 'Ana', at: '2026-10-09T10:00:00.000Z', reminded: false }] };
    },
  };
};

test('appointments: unknown clinic is 404', async () => {
  const res = await app().inject('/api/clinics/nowhere/appointments');
  assert.equal(res.statusCode, 404);
});

test('appointments: lists from the tenant database', async () => {
  const pool = fakePool();
  const res = await app({ db: fakeDb({ tenant: async (slug) => (slug === 'riverside' ? pool : null) }) })
    .inject('/api/clinics/riverside/appointments');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json()[0].patient, 'Ana');
  assert.match(pool.queries[0].sql, /from appointments/);
});

test('appointments: creates and trims to the newest 200', async () => {
  const pool = fakePool();
  const res = await app({ db: fakeDb({ tenant: async () => pool }) }).inject({
    method: 'POST', url: '/api/clinics/riverside/appointments',
    payload: { patient: 'Ben', at: '2026-10-09T11:00:00Z' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().patient, 'Ben');
  assert.match(pool.queries[1].sql, /limit 200/);
});

test('appointments: rejects bad input', async () => {
  const a = app({ db: fakeDb({ tenant: async () => fakePool() }) });
  for (const payload of [{}, { patient: '', at: '2026-10-09T11:00:00Z' }, { patient: 'x', at: 'tomorrow' },
    { patient: 'x'.repeat(81), at: '2026-10-09T11:00:00Z' }, { patient: 'x', at: '2026-10-09T11:00:00Z', extra: 1 }]) {
    const res = await a.inject({ method: 'POST', url: '/api/clinics/riverside/appointments', payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
});

test('work burns CPU and returns a short hash', async () => {
  const res = await app().inject('/api/work');
  assert.equal(res.statusCode, 200);
  assert.match(res.json().hash, /^[0-9a-f]{12}$/);
});

test('5xx responses never echo internal error text; 4xx keep their message', async () => {
  const a = app({ db: fakeDb({ listTenants: async () => { throw new Error('connect ECONNREFUSED 10.96.0.12:5432'); } }) });
  const res = await a.inject('/api/clinics');
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: 'internal' });
  assert.ok(!res.body.includes('ECONNREFUSED'));
  const v = app({ db: fakeDb({ tenant: async () => fakePool() }) });
  const bad = await v.inject({ method: 'POST', url: '/api/clinics/riverside/appointments', payload: {} });
  assert.equal(bad.statusCode, 400);
});

test('appointments: rejects years outside 2000-2099', async () => {
  const a = app({ db: fakeDb({ tenant: async () => fakePool() }) });
  for (const at of ['0000-01-01T00:00:00Z', '2101-01-01T00:00:00Z']) {
    const res = await a.inject({ method: 'POST', url: '/api/clinics/riverside/appointments', payload: { patient: 'x', at } });
    assert.equal(res.statusCode, 400, at);
  }
});

test('every response says which pod sent it, errors included', async () => {
  const ok = await app().inject('/healthz');
  assert.equal(ok.headers['x-pod'], config().pod);
  const failing = await app({ db: fakeDb({ listTenants: async () => { throw new Error('db down'); } }) }).inject('/api/whoami');
  assert.equal(failing.statusCode, 500);
  assert.equal(failing.headers['x-pod'], config().pod);
});

test('metrics exposes the request histogram after a request', async () => {
  const a = app();
  await a.inject('/api/whoami');
  await new Promise(setImmediate); // onResponse runs just after inject resolves
  const res = await a.inject('/metrics');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/plain/);
  assert.ok(res.body.includes('http_request_duration_seconds_bucket{'));
  assert.ok(res.body.includes('route="/api/whoami"'));
});

test('metrics route label is the template, not the raw path', async () => {
  const a = app();
  await a.inject('/api/clinics/riverside-123/appointments');
  await new Promise(setImmediate);
  const { body } = await a.inject('/metrics');
  assert.ok(body.includes('route="/api/clinics/:slug/appointments"'));
  assert.ok(!body.includes('riverside-123'));
});

test('metrics reports admin pool gauge from db.poolStats at scrape time', async () => {
  const { body } = await app().inject('/metrics');
  for (const line of ['total"} 4', 'idle"} 3', 'waiting"} 0']) {
    assert.ok(body.includes(`clinic_db_pool_connections{state="${line}`), line);
  }
});

test('metrics requests are not counted in the histogram', async () => {
  const a = app();
  await a.inject('/api/whoami');
  await a.inject('/metrics');
  await new Promise(setImmediate);
  const { body } = await a.inject('/metrics');
  assert.ok(!body.includes('route="/metrics"'));
});
