import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPool, createDb } from '../src/db.js';

test('newPool attaches the error handler so an idle connection loss does not crash', async () => {
  const seen = [];
  const pool = newPool({ host: 'unused' }, (e) => seen.push(e.message));
  assert.doesNotThrow(() => pool.emit('error', new Error('connection terminated')));
  assert.deepEqual(seen, ['connection terminated']);
  await pool.end();
});

test('createDb returns the db contract without connecting', async () => {
  const db = createDb({ host: 'unused', port: 5432, user: 'u', password: 'p', adminDb: 'clinic_admin' });
  for (const fn of ['ping', 'listTenants', 'tenant', 'close']) assert.equal(typeof db[fn], 'function', fn);
  await db.close();
});
