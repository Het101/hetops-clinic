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

function failingSetup(badSlug) {
  const queries = [];
  const db = {
    listTenants: async () => [{ slug: 'riverside' }, { slug: badSlug }, { slug: 'lakeview' }],
    tenant: async (slug) => ({
      query: async (sql) => {
        queries.push(slug);
        if (slug === badSlug) throw new Error('boom');
        return { rowCount: 2 };
      },
    }),
  };
  const lines = [];
  const log = { info: (obj, msg) => lines.push({ ...obj, msg }), error: (obj, msg) => lines.push({ ...obj, msg }) };
  return { db, log, queries, lines };
}

test('reminders continue past a failing tenant and count only the successes', async () => {
  const { db, log, queries, lines } = failingSetup('lakeview-broken');
  assert.equal(await runReminders(db, log), 4);
  assert.deepEqual(queries, ['riverside', 'lakeview-broken', 'lakeview']);
  assert.ok(lines.some((l) => l.tenant === 'lakeview-broken' && l.msg === 'reminders failed for tenant'));
});

test('report rejects after finishing the healthy tenants', async () => {
  const { db, log, queries } = failingSetup('lakeview-broken');
  await assert.rejects(runReport(db, log), /report failed for: lakeview-broken/);
  assert.deepEqual(queries, ['riverside', 'lakeview-broken', 'lakeview']);
});
