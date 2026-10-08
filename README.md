# hetops-clinic

A small multi-tenant clinic booking app, built as the workload for the [HetOps Kubernetes chaos lab](https://github.com/Het101/hetops-k8s-lab). Every name and booking is fake.

## Shape

| Piece | Command | Notes |
| --- | --- | --- |
| api | `node api/src/server.js` | Fastify on :8080. `/healthz`, `/readyz` (admin DB only), `/api/*` |
| worker | same, with `RUN_JOBS=true` | The only place scheduled jobs run |
| migrate | `node api/src/migrate.js` | Admin DB, then each tenant DB. `MIGRATE_FAIL=true` fails on purpose |
| report | `node api/src/jobs.js report` | Nightly CronJob |
| web | `web/` on unprivileged nginx :8080 | Shows which pod served each request |

One admin database lists the tenants; each clinic has its own database.

## Configuration

`DB_HOST`, `DB_USER`, `DB_PASSWORD` (required); `DB_PORT`, `DB_ADMIN_NAME`, `PORT`, `INTERNAL_TOKEN`, `RUN_JOBS`, `READINESS_ALWAYS_FAIL`, `APP_VERSION`.

`/internal/crash`, `/internal/leak` and `/internal/hang` exist for chaos experiments. They need the `X-Chaos-Token` header, and are disabled when `INTERNAL_TOKEN` is empty.

## Develop

```bash
npm ci
npm test                       # unit tests
docker run -d --name clinic-pg -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:17
DB_HOST=localhost DB_USER=postgres DB_PASSWORD=test npm test   # plus the integration test
```

Images (ARM64) are published by CI on every push to `main`: `ghcr.io/het101/clinic-api:<sha>`, `ghcr.io/het101/clinic-api:bad`, `ghcr.io/het101/clinic-web:<sha>`.
