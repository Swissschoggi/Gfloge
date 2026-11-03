import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

export type Db = ReturnType<typeof drizzle<typeof schema>>

let pool: Pool | null = null

export function createDb(databaseUrl: string): { db: Db; pool: Pool } {
  if (pool) return { db: drizzle(pool, { schema }), pool }
  pool = new Pool({ connectionString: databaseUrl, max: 10 })
  return { db: drizzle(pool, { schema }), pool }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
