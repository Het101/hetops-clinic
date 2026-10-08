import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const SAFE_NAME = /^[a-z][a-z0-9_]*$/;

export const DEMO_TENANTS = [
  { slug: 'riverside', name: 'Riverside Family Clinic', db: 'clinic_riverside' },
  { slug: 'northgate', name: 'Northgate Dental', db: 'clinic_northgate' },
  { slug: 'lakeview', name: 'Lakeview Physio', db: 'clinic_lakeview' },
];

const jsonLog = (msg, extra = {}) => console.log(JSON.stringify({ msg, ...extra }));

async function withClient(cfg, database, fn) {
  const client = new pg.Client({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function ensureDatabase(cfg, name) {
  if (!SAFE_NAME.test(name)) throw new Error(`unsafe database name: ${name}`);
  await withClient(cfg, 'postgres', async (c) => {
    const { rowCount } = await c.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) await c.query(`create database "${name}"`); // name checked against SAFE_NAME above
  });
}

export async function applyMigrations(client, dir) {
  await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const file of files) {
    const { rowCount } = await client.query('select 1 from schema_migrations where name = $1', [file]);
    if (rowCount) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      applied.push(file);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`${file}: ${err.message}`);
    }
  }
  return applied;
}

export async function migrateAll({ db: cfg, failOnPurpose = false }, log = jsonLog) {
  if (failOnPurpose) throw new Error('MIGRATE_FAIL is set: failing on purpose (failing-migration lab)');

  await ensureDatabase(cfg, cfg.adminDb);
  const tenants = await withClient(cfg, cfg.adminDb, async (c) => {
    const applied = await applyMigrations(c, join(MIGRATIONS, 'admin'));
    log('admin migrated', { applied });
    for (const t of DEMO_TENANTS) {
      await c.query('insert into tenants (slug, name, db_name) values ($1, $2, $3) on conflict (slug) do nothing', [t.slug, t.name, t.db]);
    }
    return (await c.query('select slug, db_name from tenants order by slug')).rows;
  });

  for (const t of tenants) {
    await ensureDatabase(cfg, t.db_name);
    const applied = await withClient(cfg, t.db_name, (c) => applyMigrations(c, join(MIGRATIONS, 'tenant')));
    log('tenant migrated', { tenant: t.slug, applied });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  migrateAll({ db: config.db, failOnPurpose: process.env.MIGRATE_FAIL === 'true' }).then(
    () => process.exit(0),
    (err) => {
      console.error(JSON.stringify({ msg: 'migration failed', error: err.message }));
      process.exit(1); // the Job's backoffLimit: 0 turns this into a blocked rollout
    },
  );
}
