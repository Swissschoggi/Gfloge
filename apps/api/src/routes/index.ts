// Domain routes: board, airport/airline lookup, flight lookup/creation,
// user flight relations, positions, alerts, stats, CSV export, admin providers.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  aircraftTypes,
  airlines,
  airports,
  flights,
  manualFlights,
  providerCredentials,
  trips,
  userFlights,
} from '@gfloge/db'
import type { Db } from '@gfloge/db'
import {
  addUserFlightSchema,
  distanceKm,
  flightLookupSchema,
  localToUtc,
  manualFlightSchema,
  greatCircleInterp,
  toLocalIso,
  updateUserFlightSchema,
  utcDateKey,
} from '@gfloge/shared'
import type {
  AlertsPayload,
  BoardItem,
  BoardPayload,
  DataCondition,
  FlightRead,
  ManualFlightInput,
  PositionData,
  RoutePoint,
  StatsPayload,
  UserFlightItem,
} from '@gfloge/shared'
import { airportToInfo, flightsById, manualFlightsById } from '../flights-read.js'
import { encryptConfigJson, maskSecret } from '../crypto.js'

type Authed = NonNullable<FastifyRequest['user']>

function requireUser(req: FastifyRequest): Authed {
  return req.user as Authed
}

// ===== Board geometry helpers =====

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * Demo provider position simulation. Everything computed here is demo data:
 * it derives purely from scheduled/actual times plus airport geometry, is
 * labeled demo, and never supposes a real feed.
 */
export function demoPositions(flight: FlightRead, now: Date): PositionData {
  const depPoint = { lat: flight.departure.lat, lon: flight.departure.lon }
  const arrPoint = { lat: flight.arrival.lat, lon: flight.arrival.lon }
  const dep = new Date(flight.actualDeparture ?? flight.scheduledDeparture)
  const arr = new Date(flight.actualArrival ?? flight.scheduledArrival)
  const totalMs = Math.max(60_000, arr.getTime() - dep.getTime())
  const isFlying = flight.status === 'enroute'
  const endAt = isFlying ? now.getTime() : Math.min(arr.getTime(), now.getTime())
  const elapsed = clamp(endAt - dep.getTime(), 0, totalMs)

  const points: RoutePoint[] = []
  const stepMs = Math.max(30_000, Math.floor(totalMs / 140))
  for (let t = 0; t <= elapsed; t += stepMs) {
    const f = t / totalMs
    const pos = greatCircleInterp(depPoint, arrPoint, f)
    const altFt =
      f < 0.12 ? Math.round(clamp(f / 0.12, 0, 1) * 37_000) : f > 0.85 ? Math.round(clamp((1 - f) / 0.15, 0, 1) * 37_000) : 37_000
    points.push({
      lat: Math.round(pos.lat * 1000) / 1000,
      lon: Math.round(pos.lon * 1000) / 1000,
      altFt: flight.status === 'cancelled' ? null : altFt,
      ts: new Date(dep.getTime() + t).toISOString(),
    })
  }

  // Milestone demo semantics: samples are current, except the one dataset
  // flight (KL 1840 today) that carries a 95 minute old sample to demo the
  // stale data-condition honestly.
  let condition: DataCondition = 'fresh'
  let sampledAt = now
  if (isFlying && flight.flightCode === 'KL 1840' && flight.departure.iata === 'AMS') {
    sampledAt = new Date(now.getTime() - 95 * 60_000)
    condition = 'stale'
  }

  return {
    sourceLabel: flight.isDemo ? 'Gfloge demo dataset' : 'No live provider configured',
    isDemo: flight.isDemo,
    condition,
    fetchedAt: sampledAt.toISOString(),
    points,
    aircraft: flight.aircraft,
  }
}

const STALE_DEMO_FLIGHT = { code: 'KL 1840', dep: 'AMS' }

// ===== Route registration =====

export function registerDomainRoutes(app: FastifyInstance): void {
  const db: Db = app.db

  // ----- Board -----

  app.get('/api/v1/board', async (req) => {
    const userId = requireUser(req).id
    const items = await buildUserFlightItems(db, userId)
    const now = new Date()
    const nowMs = now.getTime()
    const relevant = items.filter(
      (it) =>
        it.isFollowing ||
        (it.role === 'logged' && it.loggedState === 'planned') ||
        (it.role === 'logged' && it.flight.actualArrival !== null && nowMs - new Date(it.flight.actualArrival).getTime() < 24 * 3_600_000)
    )
    const toBoardItem = (it: UserFlightItem): BoardItem => {
      const relation: BoardItem['relation'] =
        it.isFollowing ? 'following' : it.role === 'logged' && it.loggedState === 'planned' ? 'planned' : 'logged'
      const condition: DataCondition =
        it.flight.isDemo
          ? it.flight.status === 'enroute'
            ? it.flight.flightCode === STALE_DEMO_FLIGHT.code && it.flight.departure.iata === STALE_DEMO_FLIGHT.dep
              ? 'stale'
              : 'fresh'
            : it.flight.isManual
              ? 'unavailable'
              : 'fresh'
          : 'unavailable'
      return {
        userFlightId: it.id,
        relation,
        isFollowing: it.isFollowing,
        loggedState: it.loggedState,
        flight: it.flight,
        condition,
        lastUpdateTime: condition === 'stale' ? new Date(nowMs - 95 * 60_000).toISOString() : null,
      }
    }

    const active = relevant
      .filter((it) => it.flight.status === 'enroute' || it.flight.status === 'boarding')
      .sort((a, b) => a.flight.scheduledDeparture.localeCompare(b.flight.scheduledDeparture))
      .map(toBoardItem)
    const upcoming = relevant
      .filter((it) => ['scheduled', 'cancelled'].includes(it.flight.status) && new Date(it.flight.scheduledDeparture).getTime() > nowMs)
      .sort((a, b) => a.flight.scheduledDeparture.localeCompare(b.flight.scheduledDeparture))
      .map(toBoardItem)
    const landed = relevant
      .filter(
        (it) =>
          (it.flight.status === 'arrived' || it.flight.status === 'diverted') &&
          it.flight.actualArrival !== null &&
          nowMs - new Date(it.flight.actualArrival).getTime() < 24 * 3_600_000
      )
      .sort((a, b) => b.flight.actualArrival!.localeCompare(a.flight.actualArrival!))
      .map(toBoardItem)

    const payload: BoardPayload = { generatedAt: now.toISOString(), active, upcoming, landed }
    return payload
  })

  // ----- Airports / airlines (picker data) -----

  app.get('/api/v1/airports', async (req) => {
    const q = String((req.query as Record<string,string|undefined>)['q'] ?? '').trim()
    const rows = await db
      .select()
      .from(airports)
      .where(q ? sql`(${airports.name} ILIKE ${`%${q}%`} OR ${airports.city} ILIKE ${`%${q}%`} OR ${airports.iata} ILIKE ${`${q}%`})` : sql`true`)
      .orderBy(airports.iata)
      .limit(30)
    return { results: rows.map(airportToInfo) }
  })

  app.get('/api/v1/airlines', async () => {
    const rows = await db.select().from(airlines).orderBy(airlines.icao).limit(50)
    return { results: rows.map((r) => ({ id: r.id, iata: r.iata, icao: r.icao, name: r.name, country: r.country })) }
  })

  // ----- Flight lookup (provider backed; only demo flights exist for now) -----

  app.get('/api/v1/flights/lookup', async (req, reply) => {
    const parsed = flightLookupSchema.safeParse({
      code: String((req.query as Record<string,string|undefined>)['code'] ?? ''),
      date: String((req.query as Record<string,string|unknown>)['date'] ?? ''),
    })
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'validation', message: 'Enter a flight number (2 to 7 characters) and a date.' } })
    }
    const { code, date } = parsed.data
    const rows = await db
      .select({ id: flights.id })
      .from(flights)
      .where(and(eq(flights.flightCode, code), eq(flights.depDateKey, date)))
      .limit(10)
    const items = await flightsById(db, rows.map((r) => r.id))
    return {
      query: { code, date },
      results: [...items.values()],
      engine: { provider: 'demo', isDemo: true },
    }
  })

  // ----- Manual flight creation (self entered, private per user) -----

  app.post('/api/v1/manual-flights', async (req, reply) => {
    const parsed = manualFlightSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'Invalid input' } })
    }
    const input: ManualFlightInput = parsed.data
    const depAirport = (await db.select().from(airports).where(eq(airports.iata, input.departureIata)).limit(1))[0]
    const arrAirport = (await db.select().from(airports).where(eq(airports.iata, input.arrivalIata)).limit(1))[0]
    if (!depAirport || !arrAirport) {
      return reply.code(400).send({ error: { code: 'validation', message: 'Choose both airports from the search results.' } })
    }
    const depUtc = localToUtc(input.departureLocal, depAirport.tz)
    const arrUtc = localToUtc(input.arrivalLocal, arrAirport.tz)
    if (arrUtc <= depUtc) {
      return reply
        .code(400)
        .send({ error: { code: 'validation', message: 'Arrival must be after departure. Local times and timezones were applied.' } })
    }
    let airlineId: string | null = null
    if (input.airlineIcao) {
      airlineId = (await db.select({ id: airlines.id }).from(airlines).where(eq(airlines.icao, input.airlineIcao)).limit(1))[0]?.id ?? null
    }
    let aircraftTypeId: string | null = null
    if (input.aircraftIcaoType) {
      aircraftTypeId =
        (await db.select({ id: aircraftTypes.id }).from(aircraftTypes).where(eq(aircraftTypes.icaoType, input.aircraftIcaoType)).limit(1))[0]?.id ?? null
    }
    const [created] = await db
      .insert(manualFlights)
      .values({
        userId: requireUser(req).id,
        airlineId,
        flightNumber: input.flightNumber,
        departureAirportId: depAirport.id,
        arrivalAirportId: arrAirport.id,
        scheduledDeparture: depUtc,
        scheduledArrival: arrUtc,
        depDateKey: utcDateKey(depUtc),
        aircraftTypeId,
        distanceKm: Math.round(distanceKm(depAirport, arrAirport)),
      })
      .returning({ id: manualFlights.id })
    const read = await manualFlightsById(db, requireUser(req).id, [created!.id])
    return { flight: read.get(created!.id)!, manualFlightId: created!.id }
  })

  // ----- User flight relations (follow, log, planned) -----

  app.get('/api/v1/user-flights/by-flight/:flightId', async (req) => {
    const flightId = String((req.params as Record<string, string>).flightId)
    const userId = requireUser(req).id
    const rows = await db.select().from(userFlights).where(
      and(eq(userFlights.userId, userId), flightId.startsWith('manual:')
        ? eq(userFlights.manualFlightId, flightId.slice(7))
        : eq(userFlights.flightId, flightId))
    ).limit(1)
    const row = rows[0]
    if (!row) return { relation: null }
    return { relation: {
      id: row.id,
      role: row.role,
      isFollowing: row.trackedFrom !== null && row.trackedUntil === null,
      loggedState: row.loggedState,
      seat: row.seat,
      cabin: row.cabin,
      note: row.note,
      rating: row.rating,
      tripId: row.tripId,
    } }
  })

  app.post('/api/v1/user-flights', async (req, reply) => {
    const parsed = addUserFlightSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'Invalid input' } })
    }
    const input = parsed.data
    const userId = requireUser(req).id
    if (!input.flightId && !input.manualFlightId) {
      return reply.code(400).send({ error: { code: 'validation', message: 'Pick a lookup result or create a manual flight first.' } })
    }
    if (input.flightId && !(await flightExists(db, input.flightId))) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'That flight does not exist.' } })
    }
    if (input.manualFlightId && !(await manualFlightOwned(db, userId, input.manualFlightId))) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'No manual record of yours matches.' } })
    }
    const logging = input.logging
    const existing = (
      await db
        .select()
        .from(userFlights)
        .where(
          and(
            eq(userFlights.userId, userId),
            input.flightId ? eq(userFlights.flightId, input.flightId) : eq(userFlights.manualFlightId, input.manualFlightId!)
          )
        )
        .limit(1)
    )[0]
    if (existing) {
      // Follow and log are two dimensions on one row (UX_ARCHITECTURE.md §4).
      await db
        .update(userFlights)
        .set({
          role: logging ? 'logged' : input.follow ? 'tracked' : existing.role,
          loggedState: logging ? logging.state : existing.loggedState,
          trackedFrom: input.follow ? (existing.trackedFrom ?? new Date()) : existing.trackedFrom,
          trackedUntil: input.follow ? null : existing.trackedUntil,
          seat: logging?.seat ?? existing.seat,
          cabin: logging?.cabin ?? existing.cabin,
          note: logging?.note ?? existing.note,
          rating: logging?.rating ?? existing.rating,
          updatedAt: new Date(),
        })
        .where(eq(userFlights.id, existing.id))
      return { userFlightId: existing.id }
    }
    const [created] = await db
      .insert(userFlights)
      .values({
        userId,
        flightId: input.flightId ?? null,
        manualFlightId: input.manualFlightId ?? null,
        role: logging ? 'logged' : 'tracked',
        loggedState: logging ? logging.state : null,
        trackedFrom: input.follow ? new Date() : null,
        seat: logging?.seat ?? null,
        cabin: logging?.cabin ?? 'none',
        note: logging?.note ?? null,
        rating: logging?.rating ?? null,
        source: (input.flightId ? 'tracked-auto' : 'manual') as 'tracked-auto' | 'manual',
      })
      .returning({ id: userFlights.id })
    return { userFlightId: created!.id }
  })

  app.patch('/api/v1/user-flights/:id', async (req, reply) => {
    const parsed = updateUserFlightSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'Invalid input' } })
    }
    const input = parsed.data
    const userId = requireUser(req).id
    // Isolation: user_id is part of the lookup, not an afterthought.
    const rows = await db
      .select()
      .from(userFlights)
      .where(and(eq(userFlights.id, String((req.params as Record<string,string>)['id'])), eq(userFlights.userId, userId)))
      .limit(1)
    const uf = rows[0]
    if (!uf) return reply.code(404).send({ error: { code: 'not_found', message: 'No record of yours matches.' } })
    const update: Partial<typeof userFlights.$inferInsert> = {}
    if (input.seat !== undefined) update.seat = input.seat
    if (input.cabin !== undefined) update.cabin = input.cabin
    if (input.note !== undefined) update.note = input.note
    if (input.rating !== undefined) update.rating = input.rating
    if (input.tripId !== undefined) {
      if (input.tripId !== null) {
        const trip = await db.select({ id: trips.id }).from(trips).where(and(eq(trips.id, input.tripId), eq(trips.userId, userId))).limit(1)
        if (!trip[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'That trip does not belong to your account.' } })
      }
      update.tripId = input.tripId
    }
    if (input.markFlown) {
      update.role = 'logged'
      update.loggedState = 'flown'
      update.trackedUntil = new Date()
    }
    if (input.follow !== undefined) {
      if (input.follow) {
        update.trackedFrom = uf.trackedFrom ?? new Date()
      } else {
        update.trackedUntil = new Date()
      }
    }
    update.updatedAt = new Date()
    await db.update(userFlights).set(update).where(eq(userFlights.id, uf.id))
    return { ok: true }
  })

  app.delete('/api/v1/user-flights/:id', async (req, reply) => {
    const userId = requireUser(req).id
    const rows = await db
      .select()
      .from(userFlights)
      .where(and(eq(userFlights.id, String((req.params as Record<string,string>)['id'])), eq(userFlights.userId, userId)))
      .limit(1)
    const uf = rows[0]
    if (!uf) return reply.code(404).send({ error: { code: 'not_found', message: 'No record of yours matches.' } })
    await db.delete(userFlights).where(eq(userFlights.id, uf.id))
    // A manual record only exists for its relation: remove it together.
    if (uf.manualFlightId) {
      await db.delete(manualFlights).where(and(eq(manualFlights.id, uf.manualFlightId), eq(manualFlights.userId, userId)))
    }
    return { ok: true }
  })

  // ----- Flight detail -----

  app.get('/api/v1/flights/:id', async (req, reply) => {
    const id = String((req.params as Record<string,string>)['id'])
    if (id.startsWith('manual:')) {
      const manualId = id.slice('manual:'.length)
      const map = await manualFlightsById(db, requireUser(req).id, [manualId])
      const flight = map.get(`manual:${manualId}`) ?? map.get(manualId)
      if (!flight) return reply.code(404).send({ error: { code: 'not_found', message: 'No flight record of yours matches.' } })
      return { flight }
    }
    const flight = (await flightsById(db, [id])).get(id)
    if (!flight) return reply.code(404).send({ error: { code: 'not_found', message: 'No flight matches that id.' } })
    return { flight }
  })

  // ----- Positions -----

  app.get('/api/v1/flights/:id/positions', async (req, reply) => {
    const flight = (await flightsById(db, [String((req.params as Record<string,string>)['id'])])).get(String((req.params as Record<string,string>)['id']))
    if (!flight) return reply.code(404).send({ error: { code: 'not_found', message: 'No flight matches that id.' } })
    if (flight.isManual) {
      return reply.code(404).send({ error: { code: 'not_supported', message: 'Self-entered flights have no tracking data until a provider adds it.' } })
    }
    return demoPositions(flight, new Date())
  })

  // ----- Alerts -----

  app.get('/api/v1/flights/:id/alerts', async (req) => {
    const result = await db.execute(
      sql`SELECT id, type, old, new, created_at FROM alerts WHERE flight_id = ${String((req.params as Record<string,string>)['id'])} ORDER BY created_at DESC LIMIT 10`
    )
    const rows = result.rows as Array<{ id: string; type: string; old: unknown; new: unknown; created_at: Date }>
    const list: AlertsPayload[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      old: row.old as Record<string, unknown> | null,
      new: row.new as Record<string, unknown> | null,
      createdAt: new Date(row.created_at).toISOString(),
    }))
    return { alerts: list }
  })

  // ----- Logbook -----

  app.get('/api/v1/logbook', async (req) => {
    const userId = requireUser(req).id
    const items = await buildUserFlightItems(db, userId)
    const flown = items.filter((it) => it.role === 'logged' && it.loggedState === 'flown' && !it.flight.isManual)
    const planned = items.filter((it) => it.role === 'logged' && it.loggedState === 'planned')
    const manual = items.filter((it) => it.flight.isManual)
    const q = String((req.query as Record<string,string|undefined>)['q'] ?? '').trim().toLowerCase()
    const year = String((req.query as Record<string,string|undefined>)['year'] ?? '')
    const haystack = (it: UserFlightItem): string =>
      `${it.flight.flightCode} ${it.flight.airline?.name ?? ''} ${it.flight.departure.iata} ${it.flight.arrival.iata} ${it.flight.departure.city} ${it.flight.arrival.city} ${it.seat ?? ''}`.toLowerCase()
    const applyFilter = (list: UserFlightItem[]): UserFlightItem[] =>
      list.filter((it) => {
        const matchesQ = q === '' || haystack(it).includes(q)
        const matchesYear = year === '' || it.flight.scheduledDeparture.startsWith(year)
        return matchesQ && matchesYear
      })
    return {
      flown: applyFilter(flown).sort((a, b) => b.flight.scheduledDeparture.localeCompare(a.flight.scheduledDeparture)),
      planned: applyFilter(planned).sort((a, b) => a.flight.scheduledDeparture.localeCompare(b.flight.scheduledDeparture)),
      manual: applyFilter(manual).sort((a, b) => b.flight.scheduledDeparture.localeCompare(a.flight.scheduledDeparture)),
      years: [...new Set(items.filter((it) => it.role === 'logged').map((it) => it.flight.scheduledDeparture.slice(0, 4)))].sort((a, b) => b.localeCompare(a)),
    }
  })

  app.get('/api/v1/stats', async (req) => {
    const userId = requireUser(req).id
    const items = await buildUserFlightItems(db, userId)
    const flown = items.filter((it) => it.role === 'logged' && it.loggedState === 'flown')
    const stats: StatsPayload = computeStats(flown)
    return stats
  })

  app.get('/api/v1/export/logbook.csv', async (req, reply) => {
    const userId = requireUser(req).id
    const items = await buildUserFlightItems(db, userId)
    const flown = items
      .filter((it) => it.role === 'logged' && it.loggedState === 'flown')
      .sort((a, b) => a.flight.scheduledDeparture.localeCompare(b.flight.scheduledDeparture))
    const header = [
      'date_utc',
      'flight',
      'airline',
      'dep',
      'dep_local_time',
      'dep_tz',
      'arr',
      'arr_local_time',
      'arr_tz',
      'aircraft_reg',
      'aircraft_type',
      'cabin',
      'seat',
      'rating',
      'note',
    ]
    const body = flown.map((it) =>
      [
        it.flight.scheduledDeparture.slice(0, 10),
        csvCell(it.flight.flightCode),
        csvCell(it.flight.airline?.name ?? ''),
        it.flight.departure.iata ?? '',
        toLocalIso(new Date(it.flight.scheduledDeparture), it.flight.departure.tz),
        it.flight.departure.tz,
        it.flight.arrival.iata ?? '',
        toLocalIso(new Date(it.flight.scheduledArrival), it.flight.arrival.tz),
        it.flight.arrival.tz,
        it.flight.aircraft?.registration ?? '',
        it.flight.aircraft?.icaoType ?? '',
        it.cabin,
        it.seat ?? '',
        it.rating === null ? '' : String(it.rating),
        csvCell(it.note ?? ''),
      ].join(',')
    )
    reply.header('content-type', 'text/csv; charset=utf-8')
    reply.header('content-disposition', 'attachment; filename="gfloge-logbook.csv"')
    return [header.join(','), ...body].join('\n')
  })

  // ----- Admin: provider status + credential storage (no secrets out) -----

  app.get('/api/v1/admin/providers', async () => {
    return { providers: await app.providers.statusSnapshot() }
  })

  app.post('/api/v1/admin/providers/:id/credentials', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const value = typeof body['secret'] === 'string' ? body['secret'] : ''
    const providerId = String((req.params as Record<string,string>)['id'])
    if (value.length < 8) {
      return reply.code(400).send({ error: { code: 'validation', message: 'Provide the secret with at least 8 characters.' } })
    }
    const known = await app.providers.statusSnapshot()
    if (!known.some((p) => p.id === providerId)) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Unknown provider id.' } })
    }
    await db
      .insert(providerCredentials)
      .values({
        providerId,
        configEncrypted: encryptConfigJson(app.config.secret, { secret: value }),
        maskedHint: maskSecret(value),
        source: 'instance',
      })
      .onConflictDoUpdate({
        target: providerCredentials.providerId,
        set: {
          configEncrypted: encryptConfigJson(app.config.secret, { secret: value }),
          maskedHint: maskSecret(value),
          updatedAt: new Date(),
        },
      })
    return { ok: true, hint: maskSecret(value) }
  })

  app.delete('/api/v1/admin/providers/:id/credentials', async (req) => {
    await db.delete(providerCredentials).where(eq(providerCredentials.providerId, String((req.params as Record<string,string>)['id'])))
    return { ok: true }
  })
}

// ===== helpers =====

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}async function flightExists(db: Db, id: string): Promise<boolean> {
  return (await db.select({ id: flights.id }).from(flights).where(eq(flights.id, id)).limit(1)).length > 0
}

async function manualFlightOwned(db: Db, userId: string, id: string): Promise<boolean> {
  return (
    (
      await db
        .select({ id: manualFlights.id })
        .from(manualFlights)
        .where(and(eq(manualFlights.id, id), eq(manualFlights.userId, userId)))
        .limit(1)
    ).length > 0
  )
}

async function buildUserFlightItems(db: Db, userId: string): Promise<UserFlightItem[]> {
  const rows = await db
    .select({
      uf: userFlights,
      flightId: userFlights.flightId,
      manualId: userFlights.manualFlightId,
    })
    .from(userFlights)
    .where(eq(userFlights.userId, userId))
    .orderBy(desc(userFlights.createdAt))
  const flightIds = rows.map((r) => r.flightId).filter((v): v is string => !!v)
  const manualIds = rows.map((r) => r.manualId).filter((v): v is string => !!v)
  const [flightsMap, manualMap] = await Promise.all([
    flightsById(db, flightIds),
    manualFlightsById(db, userId, manualIds),
  ])
  const items: UserFlightItem[] = []
  for (const row of rows) {
    const flight =
      (row.flightId ? flightsMap.get(row.flightId) : undefined) ?? (row.manualId ? manualMap.get(row.manualId) : undefined)
    if (!flight) continue
    items.push({
      id: row.uf.id,
      role: row.uf.role as 'tracked' | 'logged',
      isFollowing: row.uf.trackedFrom !== null && row.uf.trackedUntil === null,
      loggedState: (row.uf.loggedState as 'flown' | 'planned' | null) ?? null,
      seat: row.uf.seat,
      cabin: row.uf.cabin as UserFlightItem['cabin'],
      note: row.uf.note,
      rating: row.uf.rating,
      tripId: row.uf.tripId,
      source: row.uf.source as UserFlightItem['source'],
      flight,
    })
  }
  return items
}

function computeStats(flown: UserFlightItem[]): StatsPayload {

  const airportsSeen = new Set<string>()
  const countriesSeen = new Set<string>()
  const airlinesSeen = new Set<string>()
  const typesSeen = new Set<string>()
  let kmTotal = 0
  let minutesTotal = 0
  const perYear = new Map<string, { year: string; flights: number; distanceKm: number }>()
  const routeCounts = new Map<string, number>()
  for (const it of flown) {
    airportsSeen.add(it.flight.departure.iata ?? it.flight.departure.id)
    airportsSeen.add(it.flight.arrival.iata ?? it.flight.arrival.id)
    countriesSeen.add(it.flight.departure.country)
    countriesSeen.add(it.flight.arrival.country)
    if (it.flight.airline) airlinesSeen.add(it.flight.airline.icao ?? it.flight.airline.id)
    typesSeen.add(it.flight.aircraft?.icaoType ?? 'unknown')
    const km = it.flight.distanceKm ?? 0
    kmTotal += km
    const dep = new Date(it.flight.actualDeparture ?? it.flight.scheduledDeparture)
    const arr = new Date(it.flight.actualArrival ?? it.flight.scheduledArrival)
    minutesTotal += Math.max(0, Math.round((arr.getTime() - dep.getTime()) / 60_000))
    const year = it.flight.scheduledDeparture.slice(0, 4)
    const route = `${it.flight.departure.iata ?? it.flight.departure.city} → ${it.flight.arrival.iata ?? it.flight.arrival.city}`
    routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1)
    const agg = perYear.get(year) ?? { year, flights: 0, distanceKm: 0 }
    agg.flights += 1
    agg.distanceKm += km
    perYear.set(year, agg)
  }
  return {
    flights: flown.length,
    distanceKm: kmTotal,
    minutes: minutesTotal,
    uniqueAirports: airportsSeen.size,
    uniqueAirlines: airlinesSeen.size,
    uniqueAircraftTypes: typesSeen.size,
    countriesVisited: countriesSeen.size,
    routesFlown: [...routeCounts.entries()].map(([route, count]) => ({ route, flights: count })).sort((a, b) => b.flights - a.flights),
    perYear: [...perYear.values()].sort((a, b) => b.year.localeCompare(a.year)),
  }
}
