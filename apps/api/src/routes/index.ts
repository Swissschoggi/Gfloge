// Domain routes: board, airport/airline lookup, flight lookup/creation,
// user flight relations, positions, alerts, stats, CSV export, admin providers.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  airports,
  flights,
  manualFlights,
  providerCredentials,
  trips,
  userFlights,
  refCountries,
} from '@gfloge/db'
import type { Db } from '@gfloge/db'
import {
  addUserFlightSchema,
  distanceKm,
  flightSearchSchema,
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
  FlightSearchResponse,
  ManualFlightInput,
  PositionData,
  RoutePoint,
  StatsPayload,
  UserFlightItem,
} from '@gfloge/shared'
import { flightsById, manualFlightsById } from '../flights-read.js'
import { encryptConfigJson, maskSecret } from '../crypto.js'
import { searchFlights } from '../flight-search/service.js'
import { CandidateResolveError, resolveCandidate } from '../flight-search/resolve.js'
import { resolveCanonicalAirline, resolveCanonicalAirport, resolveCanonicalAircraftType, searchAirlines, searchAirports } from '../reference/search.js'

type Authed = NonNullable<FastifyRequest['user']>

function requireUser(req: FastifyRequest): Authed {
  return req.user as Authed
}

function alertHeadline(type: string): string {
  const t = type.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
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

  app.get('/api/v1/airports', { config: { rateLimit: { max: 90, timeWindow: 60_000 } } }, async (req) => {
    const q = String((req.query as Record<string, string | undefined>)['q'] ?? '').trim()
    return { results: await searchAirports(db, q, 30) }
  })

  app.get('/api/v1/airlines', { config: { rateLimit: { max: 90, timeWindow: 60_000 } } }, async (req) => {
    const q = String((req.query as Record<string, string | undefined>)['q'] ?? '').trim()
    return { results: await searchAirlines(db, q, 100) }
  })

  app.get('/api/v1/reference/countries', { config: { rateLimit: { max: 90, timeWindow: 60_000 } } }, async (req) => {
    const q = String((req.query as Record<string, string | undefined>)['q'] ?? '').trim().toLowerCase()
    const rows = await db.select().from(refCountries)
    const filtered = q ? rows.filter((c) => c.name.toLowerCase().includes(q) || c.alpha2.toLowerCase().includes(q) || (c.alpha3 ?? '').toLowerCase().includes(q)) : rows
    return { results: filtered.slice(0, 30).map((c) => ({ alpha2: c.alpha2, alpha3: c.alpha3, name: c.name })) }
  })

  // ----- Outcome-aware flight search -----

  app.get('/api/v1/flights/lookup', { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (req, reply) => {
    const query = req.query as Record<string, string | undefined>
    const parsed = flightSearchSchema.safeParse({
      code: query['code'],
      date: query['date'],
      departure: query['departure'],
      arrival: query['arrival'],
      airline: query['airline'],
      departureTime: query['departureTime'],
      timeWindowMinutes: query['timeWindowMinutes'],
      registration: query['registration'],
    })
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'Enter a date and at least one flight detail.' } })
    }
    const result = await searchFlights(db, app.providers, parsed.data, requireUser(req).id, app.config.secret)
    const ids = result.candidates.map((candidate) => candidate.flightId).filter((id): id is string => !!id)
    const stored = await flightsById(db, ids)
    const response: FlightSearchResponse & { results: FlightRead[]; engine: { provider: string; isDemo: boolean } } = {
      ...result,
      results: ids.map((id) => stored.get(id)).filter((flight): flight is FlightRead => !!flight),
      engine: { provider: result.sources.find((source) => source.status === 'searched')?.id ?? 'none', isDemo: result.candidates.some((candidate) => candidate.kind === 'demo') },
    }
    return response
  })

  app.post('/api/v1/flights/resolve', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (req, reply) => {
    const token = (req.body as { token?: unknown } | null)?.token
    if (typeof token !== 'string' || token.length > 16_000) {
      return reply.code(400).send({ error: { code: 'validation', message: 'Choose a current search result first.' } })
    }
    try {
      return await resolveCandidate(db, app.config.secret, requireUser(req).id, token)
    } catch (cause) {
      if (cause instanceof CandidateResolveError) return reply.code(cause.statusCode).send({ error: { code: cause.code, message: cause.message } })
      throw cause
    }
  })

  // ----- Manual flight creation (self entered, private per user) -----

  app.post('/api/v1/manual-flights', async (req, reply) => {
    const parsed = manualFlightSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'Invalid input' } })
    }
    const input: ManualFlightInput = parsed.data
    const depAirport = await resolveCanonicalAirport(db, input.departureIata ?? input.departureIcao ?? '')
    const arrAirport = await resolveCanonicalAirport(db, input.arrivalIata ?? input.arrivalIcao ?? '')
    if (!depAirport || !arrAirport) {
      return reply.code(400).send({ error: { code: 'validation', message: 'Choose both airports from the search results.' } })
    }
    if (!depAirport.tz || !arrAirport.tz) {
      return reply.code(400).send({ error: { code: 'validation', message: 'Departure or arrival airport has no known timezone; cannot resolve local times.' } })
    }
    const depUtc = localToUtc(input.departureLocal, depAirport.tz)
    const arrUtc = localToUtc(input.arrivalLocal, arrAirport.tz)
    if (arrUtc <= depUtc) {
      return reply
        .code(400)
        .send({ error: { code: 'validation', message: 'Arrival must be after departure. Local times and timezones were applied.' } })
    }
    let airlineId: string | null = null
    if (input.airlineIcao || input.airlineIata) airlineId = (await resolveCanonicalAirline(db, input.airlineIcao ?? input.airlineIata ?? ''))?.id ?? null
    let aircraftTypeId: string | null = null
    if (input.aircraftIcaoType) aircraftTypeId = (await resolveCanonicalAircraftType(db, input.aircraftIcaoType))?.id ?? null
    const [created] = await db
      .insert(manualFlights)
      .values({
        userId: requireUser(req).id,
        airlineId,
        flightNumber: input.flightNumber ?? null,
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

  // ----- Manual flight update (self entered, owner only) -----
  app.patch('/api/v1/manual-flights/:id', async (req, reply) => {
    const userId = requireUser(req).id
    const id = String((req.params as Record<string, string>).id)
    const existing = await db.select().from(manualFlights).where(and(eq(manualFlights.id, id), eq(manualFlights.userId, userId))).limit(1)
    if (!existing[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'No manual record of yours matches.' } })
    const body = (req.body ?? {}) as Record<string, unknown>
    const update: Record<string, unknown> = { updatedAt: new Date() }
    const existingFieldSources = (existing[0].fieldSources as Record<string, unknown> | null) ?? {}
    const fieldSources: Record<string, unknown> = { ...existingFieldSources }
    const nowIso = new Date().toISOString()
    const markManual = (field: string) => { fieldSources[field] = { source: 'manual', sourceName: 'user', at: nowIso, manual: true } }
    if (typeof body['flightNumber'] === 'string') update.flightNumber = body['flightNumber'].trim() || null
    if (typeof body['airlineIata'] === 'string' || typeof body['airlineIcao'] === 'string') {
      const code = String(body['airlineIcao'] ?? body['airlineIata'] ?? '')
      const resolved = await resolveCanonicalAirline(db, code)
      update.airlineId = resolved?.id ?? null
    }
    if (typeof body['departureIata'] === 'string' || typeof body['departureIcao'] === 'string') {
      const code = String(body['departureIcao'] ?? body['departureIata'] ?? '')
      const resolved = await resolveCanonicalAirport(db, code)
      if (resolved) update.departureAirportId = resolved.id
    }
    if (typeof body['arrivalIata'] === 'string' || typeof body['arrivalIcao'] === 'string') {
      const code = String(body['arrivalIcao'] ?? body['arrivalIata'] ?? '')
      const resolved = await resolveCanonicalAirport(db, code)
      if (resolved) update.arrivalAirportId = resolved.id
    }
    if (typeof body['departureLocal'] === 'string' && body['departureLocal']) {
      const depAirport = await db.select().from(airports).where(eq(airports.id, (update.departureAirportId ?? existing[0].departureAirportId) as string)).limit(1)
      if (depAirport[0]?.tz) update.scheduledDeparture = localToUtc(body['departureLocal'] as string, depAirport[0].tz)
    }
    if (typeof body['arrivalLocal'] === 'string' && body['arrivalLocal']) {
      const arrAirport = await db.select().from(airports).where(eq(airports.id, (update.arrivalAirportId ?? existing[0].arrivalAirportId) as string)).limit(1)
      if (arrAirport[0]?.tz) update.scheduledArrival = localToUtc(body['arrivalLocal'] as string, arrAirport[0].tz)
    }
    if (typeof body['aircraftIcaoType'] === 'string') {
      const resolved = await resolveCanonicalAircraftType(db, body['aircraftIcaoType'] as string)
      update.aircraftTypeId = resolved?.id ?? null
    }
    if (typeof body['aircraftRegistration'] === 'string') update.aircraftRegistration = (body['aircraftRegistration'] as string).trim() || null
    if (typeof body['seat'] === 'string') update.seat = (body['seat'] as string).trim() || null
    if (typeof body['cabin'] === 'string') update.cabin = body['cabin']
    if (typeof body['note'] === 'string') update.note = (body['note'] as string).trim() || null
    if (typeof body['bookingReference'] === 'string') update.bookingReference = (body['bookingReference'] as string).trim() || null
    if (typeof body['flightReason'] === 'string') update.flightReason = (body['flightReason'] as string).trim() || null
    if (typeof body['depTerminal'] === 'string') update.depTerminal = (body['depTerminal'] as string).trim() || null
    if (typeof body['depGate'] === 'string') update.depGate = (body['depGate'] as string).trim() || null
    if (typeof body['arrTerminal'] === 'string') update.arrTerminal = (body['arrTerminal'] as string).trim() || null
    if (typeof body['arrGate'] === 'string') update.arrGate = (body['arrGate'] as string).trim() || null
    if (typeof body['seatType'] === 'string') update.seatType = (body['seatType'] as string).trim() || null
    if (typeof body['rating'] === 'number' && body['rating'] >= 1 && body['rating'] <= 5) update.rating = body['rating']
    if (body['rating'] === null) update.rating = null
    if (typeof body['cancelled'] === 'boolean') update.cancelled = body['cancelled']
    if (typeof body['divertedTo'] === 'string') {
      const resolved = await resolveCanonicalAirport(db, body['divertedTo'] as string)
      update.divertedToAirportId = resolved?.id ?? null
    }
    const tsFields = ['scheduledGateDeparture', 'actualGateDeparture', 'scheduledTakeoff', 'actualTakeoff', 'scheduledLanding', 'actualLanding', 'scheduledGateArrival', 'actualGateArrival'] as const
    for (const field of tsFields) {
      const v = body[field]
      if (typeof v === 'string' && v) {
        const d = new Date(v)
        if (!Number.isNaN(d.getTime())) update[field] = d
      } else if (v === null) {
        update[field] = null
      }
    }
    const knownFields = new Set(['flightNumber','airlineIata','airlineIcao','departureIata','departureIcao','arrivalIata','arrivalIcao','departureLocal','arrivalLocal','aircraftIcaoType','aircraftRegistration','seat','cabin','note','bookingReference','flightReason','depTerminal','depGate','arrTerminal','arrGate','arrBaggage','seatType','rating','cancelled','divertedTo','scheduledGateDeparture','actualGateDeparture','scheduledTakeoff','actualTakeoff','scheduledLanding','actualLanding','scheduledGateArrival','actualGateArrival'])
    for (const key of Object.keys(body)) if (knownFields.has(key)) markManual(key)
    update.fieldSources = fieldSources
    await db.update(manualFlights).set(update).where(eq(manualFlights.id, id))
    const read = await manualFlightsById(db, userId, [id])
    return { flight: read.get(id)! }
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
    const creds = await app.providers.credentials('adsb.lol')
    const apiKey = creds?.apiKey ?? creds?.secret ?? null
    const { searchAdsbLolByCallsign } = await import('../providers/adsblol.js')
    const result = await searchAdsbLolByCallsign(flight.flightCode, apiKey)
    if (result.state === 'searched' && result.aircraft && typeof result.aircraft.lat === 'number' && typeof result.aircraft.lon === 'number') {
      const ac = result.aircraft
      const now = new Date()
      const alt = typeof ac.alt_baro === 'number' ? ac.alt_baro : null
      return {
        sourceLabel: 'adsb.lol live ADS-B',
        isDemo: false,
        condition: 'fresh' as const,
        fetchedAt: now.toISOString(),
        points: [{ lat: ac.lat!, lon: ac.lon!, altFt: alt, ts: now.toISOString() }],
        aircraft: flight.aircraft,
      }
    }
    return demoPositions(flight, new Date())
  })

  // ----- Diagnostics -----
  app.get('/api/v1/flights/:id/diagnostics', async (req, reply) => {
    const rawId = String((req.params as Record<string, string>).id)
    const isManual = rawId.startsWith('manual:')
    const lookupId = isManual ? rawId.slice(7) : rawId
    const flight = isManual
      ? (await manualFlightsById(db, requireUser(req).id, [lookupId])).get(lookupId)
      : (await flightsById(db, [lookupId])).get(lookupId)
    if (!flight) return reply.code(404).send({ error: { code: 'not_found', message: 'No flight matches that id.' } })
    const { diagnoseFlight } = await import('../diagnostics.js')
    return { diagnostics: diagnoseFlight(flight) }
  })

  // ----- User-wide activity feed -----
  app.get('/api/v1/alerts', async (req) => {
    const userId = requireUser(req).id
    const limit = Math.min(50, Math.max(1, Number((req.query as Record<string, string>)['limit'] ?? 20)))
    const result = await db.execute(
      sql`SELECT a.id, a.type, a.flight_id, a.old, a.new, a.created_at, f.flight_code
          FROM alerts a
          LEFT JOIN flights f ON f.id = a.flight_id
          WHERE a.user_id = ${userId} OR a.flight_id IN (SELECT flight_id FROM user_flights WHERE user_id = ${userId} AND flight_id IS NOT NULL)
          ORDER BY a.created_at DESC
          LIMIT ${limit}`
    )
    const rows = result.rows as Array<{ id: string; type: string; flight_id: string | null; old: unknown; new: unknown; created_at: Date; flight_code: string | null }>
    const list: AlertsPayload[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      flightId: row.flight_id,
      flightCode: row.flight_code,
      headline: alertHeadline(row.type),
      old: row.old as Record<string, unknown> | null,
      new: row.new as Record<string, unknown> | null,
      createdAt: new Date(row.created_at).toISOString(),
    }))
    return { alerts: list }
  })

  // ----- Alerts -----

  app.get('/api/v1/flights/:id/alerts', async (req) => {
    const fid = String((req.params as Record<string,string>)['id'])
    const result = await db.execute(
      sql`SELECT a.id, a.type, a.old, a.new, a.created_at, f.flight_code FROM alerts a LEFT JOIN flights f ON f.id = a.flight_id WHERE a.flight_id = ${fid} ORDER BY a.created_at DESC LIMIT 10`
    )
    const rows = result.rows as Array<{ id: string; type: string; old: unknown; new: unknown; created_at: Date; flight_code: string | null }>
    const list: AlertsPayload[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      flightId: fid,
      flightCode: row.flight_code,
      headline: alertHeadline(row.type),
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
        toLocalIso(new Date(it.flight.scheduledDeparture), it.flight.departure.tz ?? 'UTC'),
        it.flight.departure.tz ?? '',
        it.flight.arrival.iata ?? '',
        toLocalIso(new Date(it.flight.scheduledArrival), it.flight.arrival.tz ?? 'UTC'),
        it.flight.arrival.tz ?? '',
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
    const existing = await db.select({ id: providerCredentials.id }).from(providerCredentials).where(eq(providerCredentials.providerId, providerId)).limit(1)
    if (existing[0]) {
      await db.update(providerCredentials).set({
        configEncrypted: encryptConfigJson(app.config.secret, { secret: value }),
        maskedHint: maskSecret(value),
        updatedAt: new Date(),
      }).where(eq(providerCredentials.providerId, providerId))
    } else {
      await db.insert(providerCredentials).values({
        providerId,
        configEncrypted: encryptConfigJson(app.config.secret, { secret: value }),
        maskedHint: maskSecret(value),
        source: 'instance',
      })
    }
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
