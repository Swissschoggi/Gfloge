// Worker: maintenance loop. In the milestone this process runs session GC
// and provider-cache pruning; real provider polling jobs join here as
// adapters are implemented (see PROVIDER_ARCHITECTURE.md and SYSTEM §5).
// Deliberate simplification vs the documented pg-boss design: no queues are
// needed until a second job type with scheduling semantics exists; the loop
// runs under an advisory lock so only one worker acts at a time.
import { runMigrations } from '@gfloge/db/migrate'
import { createDb, closeDb } from '@gfloge/db'
import { loadConfig } from '@gfloge/shared/config'
import { sql } from 'drizzle-orm'

const WORKER_LOCK = 738_321_002
const INTERVAL_MS = 15 * 60 * 1000

export async function runMaintenanceOnce(): Promise<{ sessions: number; positions: number; cache: number; audit: number }> {
  const config = loadConfig()
  const { db, pool } = createDb(config.databaseUrl)
  const client = await pool.connect()
  try {
    await client.query(`SELECT pg_advisory_lock(${WORKER_LOCK})`)
    // Sessions: expired rows out (30d absolute cap lives in expires_at).
    const sessions = await db.execute(
      sql`DELETE FROM sessions WHERE expires_at < now() RETURNING id`
    ).then((r) => r.rows.length)
    // Demo positions retention: per DATA_MODEL, fine grain past 72h is pruned.
    const positions = await db.execute(
      sql`DELETE FROM positions p USING positions q WHERE p.flight_id = q.flight_id AND p.ts < now() - interval '72 hours' AND q.ts = p.ts RETURNING p.id`
    ).then((r) => r.rows.length)
    // Provider cache hygiene: TTL-driven rows out.
    const cache = await db.execute(
      sql`DELETE FROM provider_cache WHERE (fetched_at + make_interval(secs => ttl_seconds)) < now() RETURNING key`
    ).then((r) => r.rows.length)
    // Audit log retention (180d).
    const audit = await db.execute(
      sql`DELETE FROM audit_log WHERE created_at < now() - interval '180 days' RETURNING id`
    ).then((r) => r.rows.length)
    void db
    return { sessions, positions, cache, audit }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${WORKER_LOCK})`)
    client.release()
    await closeDb()
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  console.log('[gfloge/worker] migrating database')
  await runMigrations(config.databaseUrl)
  console.log('[gfloge/worker] maintenance loop starting, interval', INTERVAL_MS / 60_000, 'min')
  for (;;) {
    try {
      const result = await runMaintenanceOnce()
      console.log('[gfloge/worker] maintenance', JSON.stringify(result))
    } catch (error) {
      console.error('[gfloge/worker] maintenance failed:', error instanceof Error ? error.message : error)
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS))
  }
}

void main().catch((error) => {
  console.error('[gfloge/worker] startup failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
