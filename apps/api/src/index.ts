// API entrypoint: migrate, seed (demo or admin bootstrap), then serve.
import { runMigrations } from '@gfloge/db/migrate'
import { buildServer } from './app.js'
import { loadConfig } from '@gfloge/shared/config'
import { isEmptyInstance, seedAdminOnly, seedDemoInstance } from './seed.js'
import { closeDb, createDb } from '@gfloge/db'

async function main(): Promise<void> {
  const config = loadConfig()
  console.log('[gfloge/api] migrating database')
  await runMigrations(config.databaseUrl)
  console.log('[gfloge/api] migrations applied')

  const { db } = createDb(config.databaseUrl)
  if (await isEmptyInstance(db)) {
    if (config.seedDemo) {
      console.log('[gfloge/api] empty instance: seeding demo data (provider id "demo")')
      const result = await seedDemoInstance(db)
      console.log(`[gfloge/api] demo seed: ${result.users} users, ${result.flights} flights`)
      console.log('[gfloge/api] demo login: marta@gfloge.demo / flighty-demo-1 | admin: admin@gfloge.demo / demo-admin-1')
    } else if (process.env.GF_ADMIN_EMAIL && process.env.GF_ADMIN_PASSWORD) {
      console.log('[gfloge/api] seeding admin bootstrap from GF_ADMIN_EMAIL')
      await seedAdminOnly(db, process.env.GF_ADMIN_EMAIL, process.env.GF_ADMIN_PASSWORD, process.env.GF_ADMIN_NAME)
    } else {
      console.log('[gfloge/api] empty instance: open /setup in the app to create the administrator')
    }
  }
  await closeDb()
  await runAndClose()
}

async function runAndClose(): Promise<void> {
  const app = await buildServer()
  const config = loadConfig()
  await app.listen({ port: config.httpPort, host: config.host })
  console.log(`[gfloge/api] listening on ${config.host}:${config.httpPort}`)
  const shutdown = async (): Promise<void> => {
    app.log.info('shutting down')
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

void main().catch((error) => {
  console.error('[gfloge/api] startup failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
