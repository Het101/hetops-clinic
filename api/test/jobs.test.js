import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReminders, runReport } from '../src/jobs.js';

function setup(rowCount) {
  const queries = [];
  const pool = { query: async (sql) => { queries.push(sql); return { rowCount }; } };
  const db = {
    listTenants: async () => [{ slug: 'riverside' }, { slug: 'lakeview' }],
    tenant: async () => pool,
  };
  const lines = [];
  const log = { info: (obj, msg) => lines.push({ ...obj, msg }), error: (obj, msg) => lines.push({ ...obj, msg }) };
  return { db, log, queries, lines };
}

test('reminders run once per tenant and log only when something changed', async () => {
  const { db, log, queries, lines } = setup(2);
  assert.equal(await runReminders(db, log), 4);
  assert.equal(queries.length, 2);
  assert.match(queries[0], /set reminded = true/);
  assert.deepEqual(lines.map((l) => l.tenant), ['riverside', 'lakeview']);
});

test('reminders stay quiet when nothing is due', async () => {
  const { db, log, lines } = setup(0);
  assert.equal(await runReminders(db, log), 0);
  assert.equal(lines.length, 0);
});

test('report upserts one row per tenant', async () => {
  const { db, log, queries } = setup(1);
  await runReport(db, log);
  assert.equal(queries.length, 2);
  assert.match(queries[0], /on conflict \(day\) do update/);
});
