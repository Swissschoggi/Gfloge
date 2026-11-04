import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { mkdir, unlink, writeFile } from "node:fs/promises"
import path from 'node:path'
import { airports, airlines, historicalDatasets, manualFlights, userFlights } from '@gfloge/db'
import { distanceKm, utcDateKey } from '@gfloge/shared'
import { seedCatalog, listDatasets, dataDir } from '../historical/catalog.js'
import { claimDataset, installDataset, removeDataset } from '../historical/installer.js'
import { searchHistorical } from '../historical/query.js'

export function registerHistoricalRoutes(app: FastifyInstance): void {
  const db = app.db

  app.get('/api/v1/historical/datasets', async () => {
    await seedCatalog(db)
    return { datasets: await listDatasets(db) }
  })

  app.post('/api/v1/historical/datasets/:id/download', async (req, reply) => {
    const id = String((req.params as Record<string, string>).id)
    const dataset = (await db.select().from(historicalDatasets).where(eq(historicalDatasets.id, id)).limit(1))[0]
    if (!dataset) return reply.code(404).send({ error: { code: 'not_found', message: 'No dataset with that id.' } })
    const claim = await claimDataset(db, id)
    if (!claim.ok) {
      const code = claim.status === 'installed' ? 200 : 409
      return reply.code(code).send({ error: { code: claim.status, message: claim.message } })
    }
    const directory = dataDir()
    try {
      await mkdir(path.join(directory, 'historical'), { recursive: true })
      const probe = path.join(directory, 'historical', '.write-test')
      await writeFile(probe, 'ok')
      await unlink(probe)
    } catch (err) {
      await db.update(historicalDatasets).set({ status: 'failed', error: `Cannot create storage directory: ${err instanceof Error ? err.message : err}`, updatedAt: new Date() }).where(eq(historicalDatasets.id, id))
      return reply.code(500).send({ error: { code: 'storage_unwritable', message: 'The dataset storage directory is not writable. Check GF_HISTORICAL_DATA_DIR and container permissions.' } })
    }
    void installDataset(db, id, directory).catch((err) => app.log.error({ err }, 'historical download failed'))
    return reply.code(202).send({ started: true, message: 'Download queued.' })
  })

  app.get('/api/v1/historical/datasets/:id/status', async (req, reply) => {
    const id = String((req.params as Record<string, string>).id)
    const dataset = (await db.select().from(historicalDatasets).where(eq(historicalDatasets.id, id)).limit(1))[0]
    if (!dataset) return reply.code(404).send({ error: { code: 'not_found', message: 'No dataset with that id.' } })
    return { dataset }
  })

  app.delete('/api/v1/historical/datasets/:id', async (req, reply) => {
    const id = String((req.params as Record<string, string>).id)
    const dataset = (await db.select().from(historicalDatasets).where(eq(historicalDatasets.id, id)).limit(1))[0]
    if (!dataset) return reply.code(404).send({ error: { code: 'not_found', message: 'No dataset with that id.' } })
    await removeDataset(db, id)
    return { ok: true }
  })

  app.post('/api/v1/historical/search', async (req, reply) => {
    const body = req.body as { flightNumber?: unknown; date?: unknown }
    const flightNumber = typeof body?.flightNumber === 'string' ? body.flightNumber : ''
    const date = typeof body?.date === 'string' ? body.date : ''
    if (!flightNumber || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: { code: 'validation', message: 'Enter a flight number and a date in YYYY-MM-DD form.' } })
    }
    return searchHistorical(db, flightNumber, date)
  })

  app.post('/api/v1/historical/save', async (req, reply) => {
    const body = req.body as { flightNumber?: unknown; date?: unknown; candidate?: unknown }
    const flightNumber = typeof body?.flightNumber === 'string' ? body.flightNumber : ''
    const date = typeof body?.date === 'string' ? body.date : ''
    const candidate = (body?.candidate ?? null) as Record<string, unknown> | null
    if (!flightNumber || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !candidate) {
      return reply.code(400).send({ error: { code: 'validation', message: 'Choose one candidate from the search results.' } })
    }
    const userId = req.user!.id
    let depAirport: typeof airports.$inferSelect | null = null
    if (candidate.departureAirport) {
      depAirport = (await db.select().from(airports).where(eq(airports.icao, String(candidate.departureAirport))).limit(1))[0] ?? null
      if (!depAirport) depAirport = (await db.select().from(airports).where(eq(airports.iata, String(candidate.departureAirport).slice(0, 3))).limit(1))[0] ?? null
    }
    let arrAirport: typeof airports.$inferSelect | null = null
    if (candidate.arrivalAirport) {
      arrAirport = (await db.select().from(airports).where(eq(airports.icao, String(candidate.arrivalAirport))).limit(1))[0] ?? null
      if (!arrAirport) arrAirport = (await db.select().from(airports).where(eq(airports.iata, String(candidate.arrivalAirport).slice(0, 3))).limit(1))[0] ?? null
    }
    if (!depAirport || !arrAirport) {
      return reply.code(400).send({ error: { code: 'validation', message: 'The selected historical flight references airports that are not in the reference data yet.' } })
    }
    let airlineId: string | null = null
    if (typeof candidate.airlineIcao === 'string') {
      const rows = await db.select({ id: airlines.id }).from(airlines).where(eq(airlines.icao, candidate.airlineIcao)).limit(1)
      airlineId = rows[0]?.id ?? null
    }
    const depRaw = typeof candidate.departureTimeUtc === 'string' ? candidate.departureTimeUtc : ''
    const arrRaw = typeof candidate.arrivalTimeUtc === 'string' ? candidate.arrivalTimeUtc : ''
    if (!depRaw || !arrRaw) {
      return reply.code(409).send({ error: { code: 'candidate_incomplete', message: 'The historical observation has no complete pair of times. Enter the missing journey details manually.' } })
    }
    const depUtc = parseHistoricalUtc(depRaw)
    const arrUtc = parseHistoricalUtc(arrRaw)
    if (!depUtc || !arrUtc || arrUtc <= depUtc) {
      return reply.code(400).send({ error: { code: 'invalid_candidate_time', message: 'The historical dataset returned invalid departure or arrival times.' } })
    }
    const [manual] = await db.insert(manualFlights).values({
      userId,
      airlineId,
      flightNumber,
      departureAirportId: depAirport.id,
      arrivalAirportId: arrAirport.id,
      scheduledDeparture: depUtc,
      scheduledArrival: arrUtc,
      depDateKey: utcDateKey(depUtc),
      distanceKm: Math.round(distanceKm(depAirport, arrAirport)),
    }).returning({ id: manualFlights.id })
    const [relation] = await db.insert(userFlights).values({
      userId,
      manualFlightId: manual!.id,
      role: 'logged',
      loggedState: 'flown',
      source: 'import',
      note: `Imported from ${String(candidate.source)} ${String(candidate.datasetKey)} (historical dataset).`,
    }).returning({ id: userFlights.id })
    return { userFlightId: relation!.id, manualFlightId: manual!.id }
  })
}

function parseHistoricalUtc(value: string): Date | null {
  const normalized = value.trim().replace(' ', 'T')
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`)
  return Number.isFinite(date.getTime()) ? date : null
}
