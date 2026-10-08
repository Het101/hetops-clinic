import pg from 'pg';

// Admin pool for the tenant directory, plus one small pool per tenant database.
export function createDb(cfg) {
  const base = {
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    connectionTimeoutMillis: 2000, query_timeout: 2000,
  };
  const admin = new pg.Pool({ ...base, database: cfg.adminDb, max: 5 });
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
        tenantPools.set(slug, new pg.Pool({ ...base, database: rows[0].db_name, max: 2 }));
      }
      return tenantPools.get(slug);
    },
    async close() {
      await Promise.all([admin.end(), ...[...tenantPools.values()].map((p) => p.end())]);
    },
  };
}
