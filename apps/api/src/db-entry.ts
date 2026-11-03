// Thin accessor so entrypoints can get a plain db handle without building
// the full server.
import { createDb } from '@gfloge/db'
import { loadConfig } from '@gfloge/shared/config'

const config = loadConfig()
export const db = createDb(config.databaseUrl).db
export { createDb }
