// Main API application: plugins, auth, domain routes, static SPA serving.
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { ZodError } from 'zod'
import { closeDb, createDb } from '@gfloge/db'
import { loadConfig } from '@gfloge/shared/config'
import { ProviderRegistry } from './providers/registry.js'
import { enforceAdmin, enforceAuth, isProtectedPath, readSession } from './auth.js'
import './fastify-types.js'

export async function buildServer() {
  const config = loadConfig()
  const { db } = createDb(config.databaseUrl)
  const providers = new ProviderRegistry(config, db)

  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
  })

  app.decorate('db', db)
  app.decorate('config', config)
  app.decorate('providers', providers)
  app.decorate('sessionRowId', undefined as string | undefined)

  await app.register(fastifyCookie)
  await app.register(fastifyRateLimit, { global: false })

  // Every request resolves its session into request.user (single source).
  app.addHook('onRequest', async (request, reply) => {
    const user = await readSession(request)
    if (user) request.user = user
    const path = (request.raw.url ?? '').split('?')[0] ?? ''
    if (isProtectedPath(path)) {
      const isAdmin = path.startsWith('/api/v1/admin/')
      const ok = isAdmin ? enforceAdmin(request, reply) : enforceAuth(request, reply)
      if (!ok) return reply
    }
  })

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'validation',
          message: error.issues[0]?.message ?? 'Invalid input',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      })
    }
    const status = (error as { statusCode?: number }).statusCode
    if (typeof status === 'number' && status < 500) {
      const message = (error as { message?: string }).message ?? 'Request could not be processed.'
      return reply.code(status).send({
        error: { code: 'request_error', message: message.substring(0, 200) },
      })
    }
    request.log.error(error)
    return reply.code(500).send({
      error: { code: 'internal', message: 'Something failed on our side. Retry, and report if it persists.' },
    })
  })

  const { registerAuthRoutes } = await import('./auth.js')
  registerAuthRoutes(app)
  const { registerDomainRoutes } = await import('./routes/index.js')
  registerDomainRoutes(app)
  const { registerTripRoutes } = await import('./routes/trips.js')
  registerTripRoutes(app)
  const { registerAccountRoutes } = await import('./routes/account.js')
  registerAccountRoutes(app)
  const { registerExploreRoutes } = await import('./routes/explore.js')
  registerExploreRoutes(app)
  const { registerHistoricalRoutes } = await import('./routes/historical.js')
  registerHistoricalRoutes(app)
  const { registerReferenceRoutes } = await import('./routes/reference.js')
  registerReferenceRoutes(app)
  const { registerImportRoutes } = await import('./routes/import.js')
  registerImportRoutes(app)
  const { registerTravelRiskRoutes } = await import('./routes/travel-risk.js')
  registerTravelRiskRoutes(app)
  const { registerFlightDiscoveryRoutes } = await import('./routes/flight-discovery.js')
  registerFlightDiscoveryRoutes(app)

  app.get('/api/health', async () => {
    const providersSnapshot = await providers.statusSnapshot()
    let dbOk = true
    let tables = '0'
    try {
      const result = await db.execute(
        sql`SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'`
      )
      tables = String((result.rows[0] as { count?: string } | undefined)?.count ?? '0')
    } catch {
      dbOk = false
    }
    return {
      ok: dbOk,
      db: { ok: dbOk, tables, migrations: 'drizzle-v1' },
      providers: providersSnapshot.map((p) => ({
        id: p.id,
        configured: p.configured,
        capabilities: p.capabilities,
        status: p.status,
      })),
      seed: { demo: config.seedDemo },
    }
  })

  // SPA serving: built web dist from the web package when present.
  const candidates = [config.webDist, path.resolve(import.meta.dirname, '../../web/dist')].filter(
    (v): v is string => !!v
  )
  const staticRoot = candidates.map((c) => path.resolve(c)).find((c) => existsSync(path.join(c, 'index.html')))
  if (staticRoot) {
    await app.register(fastifyStatic, { root: staticRoot })
    app.setNotFoundHandler(async (request, reply) => {
      if (request.raw.url?.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'No such API endpoint.' } })
      }
      return reply.sendFile('index.html')
    })
  } else {
    app.setNotFoundHandler(async (request, reply) => {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found and no SPA bundle attached.' } })
    })
  }

  app.addHook('onClose', async () => {
    await closeDb()
  })

  return app
}
