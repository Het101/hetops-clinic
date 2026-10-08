import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { migrateAll } from '../src/migrate.js';

const skip = process.env.DB_HOST ? false : 'set DB_HOST, DB_USER, DB_PASSWORD to run against Postgres';

test('migrate is idempotent, then an appointment can be booked', { skip }, async () => {
  const config = loadConfig({ ...process.env, INTERNAL_TOKEN: 't' });
  const quiet = () => {};
  await migrateAll({ db: config.db }, quiet);
  await migrateAll({ db: config.db }, quiet); // second run must change nothing

  const db = createDb(config.db);
  const app = buildApp({ config, db, logger: false });
  try {
    assert.equal((await app.inject('/readyz')).statusCode, 200);
    assert.equal((await app.inject('/api/whoami')).json().tenants, 3);

    const created = await app.inject({
      method: 'POST', url: '/api/clinics/riverside/appointments',
      payload: { patient: 'Integration Test', at: '2026-10-09T10:00:00Z' },
    });
    assert.equal(created.statusCode, 201);

    const list = (await app.inject('/api/clinics/riverside/appointments')).json();
    assert.ok(list.some((a) => a.patient === 'Integration Test'));
    // tenant isolation: northgate's database must not see riverside's row
    const other = (await app.inject('/api/clinics/northgate/appointments')).json();
    assert.ok(!other.some((a) => a.patient === 'Integration Test'));
  } finally {
    await app.close();
    await db.close();
  }
});

test('MIGRATE_FAIL makes the migration fail on purpose', async () => {
  const config = loadConfig({ DB_HOST: 'unused', DB_USER: 'u', DB_PASSWORD: 'p' });
  await assert.rejects(migrateAll({ db: config.db, failOnPurpose: true }, () => {}), /failing on purpose/);
});
