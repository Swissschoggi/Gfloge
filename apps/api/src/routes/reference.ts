import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { referenceDatasets } from '@gfloge/db'
import { seedReferenceCatalog, listReferenceDatasets } from '../reference/catalog.js'
import { seedReferenceData } from '../reference/seed.js'
import { installReferenceDataset } from '../reference/installer.js'

export function registerReferenceRoutes(app: FastifyInstance): void {
  const db = app.db
  app.get('/api/v1/reference/datasets', async () => {
    await seedReferenceCatalog(db)
    await seedReferenceData(db)
    return { datasets: await listReferenceDatasets(db) }
  })
  app.post('/api/v1/reference/datasets/:key/install', async (req, reply) => {
    const key = String((req.params as Record<string, string>).key)
    try {
      await installReferenceDataset(db, key)
      return { ok: true }
    } catch (e) {
      return reply.code(500).send({ error: { code: 'failed', message: e instanceof Error ? e.message : 'Failed' } })
    }
  })
  app.get('/api/v1/reference/datasets/:key/status', async (req, reply) => {
    const key = String((req.params as Record<string, string>).key)
    const [row] = await db.select().from(referenceDatasets).where(eq(referenceDatasets.key, key)).limit(1)
    if (!row) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } })
    return { dataset: row }
  })
}
