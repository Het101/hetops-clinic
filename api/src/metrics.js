import { Registry, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// One registry per app instance, so tests that build several apps never collide.
export function createMetrics(db) {
  const register = new Registry();
  collectDefaultMetrics({ register });
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [register],
  });
  new Gauge({
    name: 'clinic_db_pool_connections',
    help: 'Admin database pool connections by state',
    labelNames: ['state'],
    registers: [register],
    collect() {
      const s = db.poolStats();
      this.set({ state: 'total' }, s.total);
      this.set({ state: 'idle' }, s.idle);
      this.set({ state: 'waiting' }, s.waiting);
    },
  });
  return { register, duration };
}
