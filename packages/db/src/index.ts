// Drizzle-provided database URL parsing + client factory re-export.
import { createDb, closeDb } from './client.js'

export { createDb, closeDb }
export type { Db } from './client.js'
export * from './schema.js'
