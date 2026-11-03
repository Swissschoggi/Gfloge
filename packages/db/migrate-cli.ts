// Migration CLI: applies Drizzle SQL migrations, used by the container
// entrypoint and by local scripts.
import { runMigrations } from './src/migrate.js'

const env = process.env
const url =
  env.DATABASE_URL ??
  (env.GF_DB_HOST
    ? `postgres://${env.GF_DB_USER ?? 'gfloge'}:${encodeURIComponent(env.GF_DB_PASSWORD ?? '')}@${env.GF_DB_HOST}:${env.GF_DB_PORT ?? '5432'}/${env.GF_DB_NAME ?? 'gfloge'}`
    : '')
if (!url) {
  console.error('[gfloge/migrate] DATABASE_URL or GF_DB_* coordinates are missing')
  process.exit(1)
}
await runMigrations(url)
console.log('[gfloge/migrate] migrations applied')
process.exit(0)
