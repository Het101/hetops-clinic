// Parses environment variables once; everything else receives the result.
export function loadConfig(env = process.env) {
  const missing = ['DB_HOST', 'DB_USER', 'DB_PASSWORD'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`missing env: ${missing.join(', ')}`);
  return {
    port: Number(env.PORT ?? 8080),
    db: {
      host: env.DB_HOST,
      port: Number(env.DB_PORT ?? 5432),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      adminDb: env.DB_ADMIN_NAME ?? 'clinic_admin',
    },
    internalToken: env.INTERNAL_TOKEN ?? '', // empty = /internal/* always refuses
    runJobs: env.RUN_JOBS === 'true',
    readinessAlwaysFail: env.READINESS_ALWAYS_FAIL === 'true',
    version: env.APP_VERSION ?? 'dev',
    pod: env.HOSTNAME ?? 'local',
  };
}
