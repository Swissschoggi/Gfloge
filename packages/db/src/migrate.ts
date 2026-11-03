// Migration runner: applies Drizzle SQL migrations under an advisory lock so
// api, worker and any replicas race safely at startup (DATA_MODEL.md §4).
// The lock takes one dedicated connection; the migrator works on a second, so
// pool max is 2 to avoid a self-deadlock.
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_LOCK = 738_321_001

const here = path.dirname(fileURLToPath(import.meta.url))
export const migrationsFolder = path.join(here, '..', 'drizzle')

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 })
  const client = await pool.connect()
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATIONS_LOCK})`)
    await drizzleMigrate(drizzle(pool), { migrationsFolder })
    await client.query(`SELECT pg_advisory_unlock(${MIGRATIONS_LOCK})`)
  } catch (error) {
    try {
      await client.query(`SELECT pg_advisory_unlock(${MIGRATIONS_LOCK})`)
    } catch {
      /* the lock releases with the connection in the worst case */
    }
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}
