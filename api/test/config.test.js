import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const base = { DB_HOST: 'pg', DB_USER: 'clinic', DB_PASSWORD: 'secret' };

test('applies defaults', () => {
  const c = loadConfig(base);
  assert.equal(c.port, 8080);
  assert.deepEqual(c.db, { host: 'pg', port: 5432, user: 'clinic', password: 'secret', adminDb: 'clinic_admin' });
  assert.equal(c.internalToken, '');
  assert.equal(c.runJobs, false);
  assert.equal(c.readinessAlwaysFail, false);
  assert.equal(c.version, 'dev');
});

test('reads overrides', () => {
  const c = loadConfig({ ...base, PORT: '9000', DB_PORT: '6432', DB_ADMIN_NAME: 'adm', INTERNAL_TOKEN: 'tok',
    RUN_JOBS: 'true', READINESS_ALWAYS_FAIL: 'true', APP_VERSION: 'abc1234', HOSTNAME: 'api-7d9-x2' });
  assert.equal(c.port, 9000);
  assert.equal(c.db.port, 6432);
  assert.equal(c.db.adminDb, 'adm');
  assert.equal(c.internalToken, 'tok');
  assert.equal(c.runJobs, true);
  assert.equal(c.readinessAlwaysFail, true);
  assert.equal(c.version, 'abc1234');
  assert.equal(c.pod, 'api-7d9-x2');
});

test('fails fast on missing database settings', () => {
  assert.throws(() => loadConfig({ DB_HOST: 'pg' }), /missing env: DB_USER, DB_PASSWORD/);
});
