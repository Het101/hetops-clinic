import pg from 'pg';

const defaultPoolError = (err) => console.error(JSON.stringify({
  level: 'warn', msg: 'idle database connection lost', error: err.message,
}));

// An idle client that loses its connection emits 'error' on the pool; without a listener Node crashes the process.
export function newPool(options, onError) {
  const pool = new pg.Pool(options);
  pool.on('error', onError);
  return pool;
}

// Admin pool for the tenant directory, plus one small pool per tenant database.
export function createDb(cfg, onPoolError = defaultPoolError) {
  const base = {
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    connectionTimeoutMillis: 2000, query_timeout: 2000,
  };
  const admin = newPool({ ...base, database: cfg.adminDb, max: 5 }, onPoolError);
  // ponytail: unbounded map, fine for 3 tenants; LRU with idle-pool close if tenants grow (see the healthcare platform lesson)
  const tenantPools = new Map();

  return {
    async ping() {
      await admin.query('select 1');
    },
    async listTenants() {
      const { rows } = await admin.query('select slug, name, db_name from tenants order by slug');
      return rows;
    },
    async tenant(slug) {
      if (!tenantPools.has(slug)) {
        const { rows } = await admin.query('select db_name from tenants where slug = $1', [slug]);
        if (!rows.length) return null;
        tenantPools.set(slug, newPool({ ...base, database: rows[0].db_name, max: 2 }, onPoolError));
      }
      return tenantPools.get(slug);
    },
    async close() {
      await Promise.all([admin.end(), ...[...tenantPools.values()].map((p) => p.end())]);
    },
  };
}
