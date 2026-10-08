import { pathToFileURL } from 'node:url';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createDb } from './db.js';

// Runs only in the worker Deployment (RUN_JOBS=true). Running it in every API replica
// would remind every patient once per replica: the scheduled-jobs lesson from the healthcare platform.
export async function runReminders(db, log) {
  let total = 0;
  for (const t of await db.listTenants()) {
    const pool = await db.tenant(t.slug);
    const { rowCount } = await pool.query(
      "update appointments set reminded = true where not reminded and at < now() + interval '1 hour'",
    );
    if (rowCount) log.info({ tenant: t.slug, reminded: rowCount }, 'reminders sent');
    total += rowCount;
  }
  return total;
}

export function startJobs({ db, log, everyMs = 60000 }) {
  const tick = () => runReminders(db, log).catch((err) => log.error({ err: err.message }, 'reminders failed'));
  tick();
  return setInterval(tick, everyMs);
}

export async function runReport(db, log) {
  for (const t of await db.listTenants()) {
    const pool = await db.tenant(t.slug);
    await pool.query(
      `insert into reports (day, appointments)
       select current_date, count(*) from appointments
       on conflict (day) do update set appointments = excluded.appointments`,
    );
    log.info({ tenant: t.slug }, 'nightly report written');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === 'report') {
  const log = pino();
  const db = createDb(loadConfig().db);
  runReport(db, log)
    .then(() => db.close())
    .then(() => process.exit(0), (err) => { log.error({ err: err.message }, 'report failed'); process.exit(1); });
}
