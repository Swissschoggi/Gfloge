import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, eq, ilike, or } from 'drizzle-orm'
import { aircraft, aircraftTypes, userFlights } from '@gfloge/db'
import type { Db } from '@gfloge/db'
import { flightsById, manualFlightsById } from '../flights-read.js'

function requireUser(req: FastifyRequest): { id: string } {
  return req.user as { id: string }
}

export function registerAircraftRoutes(app: FastifyInstance): void {
  const db = app.db

  app.get('/api/v1/aircraft/search', async (req) => {
    const q = String((req.query as Record<string, string | undefined>)['q'] ?? '').trim()
    if (!q) return { results: [] }
    const pattern = `%${q}%`
    const rows = await db.select().from(aircraft).where(ilike(aircraft.registration, pattern)).limit(20)
    const types = await db.select().from(aircraftTypes).where(or(ilike(aircraftTypes.icaoType, pattern), ilike(aircraftTypes.iataType, pattern), ilike(aircraftTypes.manufacturer, pattern), ilike(aircraftTypes.name, pattern))).limit(20)
    return {
      registrations: rows.map((r) => r.registration),
      types: types.map((t) => ({ icaoType: t.icaoType, iataType: t.iataType, manufacturer: t.manufacturer, name: t.name, family: t.family })),
    }
  })

  app.get('/api/v1/aircraft/:registration', async (req, reply) => {
    const user = requireUser(req)
    const registration = decodeURIComponent(String((req.params as Record<string, string>).registration))
    if (!registration) return reply.code(400).send({ error: { code: 'validation', message: 'registration is required.' } })

    const refRows = await db.select().from(aircraft).where(eq(aircraft.registration, registration)).limit(1)
    const ref = refRows[0] ?? null
    let type = null
    if (ref?.aircraftTypeId) {
      const tRows = await db.select().from(aircraftTypes).where(eq(aircraftTypes.id, ref.aircraftTypeId)).limit(1)
      type = tRows[0] ?? null
    }

    // user flights for this aircraft
    const relations = await db.select().from(userFlights).where(eq(userFlights.userId, user.id))
    const canonicalIds = relations.map((r) => r.flightId).filter((x): x is string => !!x)
    const manualIds = relations.map((r) => r.manualFlightId).filter((x): x is string => !!x)
    const [canonical, manual] = await Promise.all([flightsById(db, canonicalIds), manualFlightsById(db, user.id, manualIds)])

    const matching = relations
      .map((rel) => {
        const flight = (rel.flightId ? canonical.get(rel.flightId) : null) ?? (rel.manualFlightId ? manual.get(rel.manualFlightId) : null)
        if (!flight || flight.aircraft?.registration !== registration) return null
        return { relation: rel, flight }
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.flight.scheduledDeparture.localeCompare(b.flight.scheduledDeparture))

    const flightsOut = matching.map((m) => m.flight)
    const airports = new Set<string>()
    const airlines = new Set<string>()
    let distance = 0
    for (const f of flightsOut) {
      airports.add(f.departure.iata ?? f.departure.icao ?? '')
      airports.add(f.arrival.iata ?? f.arrival.icao ?? '')
      if (f.airline?.name) airlines.add(f.airline.name)
      if (f.distanceKm) distance += f.distanceKm
    }
    const firstSeen = flightsOut.length ? flightsOut[0].scheduledDeparture : null
    const lastSeen = flightsOut.length ? flightsOut[flightsOut.length - 1].scheduledDeparture : null

    return {
      registration,
      aircraft: ref ? { source: ref.source, fetchedAt: ref.fetchedAt } : null,
      type: type ? { icaoType: type.icaoType, iataType: type.iataType, manufacturer: type.manufacturer, name: type.name, family: type.family } : null,
      firstSeen,
      lastSeen,
      stats: {
        flights: flightsOut.length,
        distanceKm: distance,
        airports: [...airports].filter(Boolean),
        airlines: [...airlines],
      },
      flights: flightsOut,
    }
  })

  app.get('/api/v1/aircraft-types/:icao', async (req, reply) => {
    const icao = String((req.params as Record<string, string>).icao)
    const rows = await db.select().from(aircraftTypes).where(eq(aircraftTypes.icaoType, icao)).limit(1)
    const type = rows[0]
    if (!type) return reply.code(404).send({ error: { code: 'not_found', message: 'Aircraft type not found.' } })
    // aircraft registrations in user logbook of this type
    const user = requireUser(req)
    const relations = await db.select().from(userFlights).where(eq(userFlights.userId, user.id))
    const canonicalIds = relations.map((r) => r.flightId).filter((x): x is string => !!x)
    const manualIds = relations.map((r) => r.manualFlightId).filter((x): x is string => !!x)
    const [canonical, manual] = await Promise.all([flightsById(db, canonicalIds), manualFlightsById(db, user.id, manualIds)])
    const regs = new Set<string>()
    for (const rel of relations) {
      const flight = (rel.flightId ? canonical.get(rel.flightId) : null) ?? (rel.manualFlightId ? manual.get(rel.manualFlightId) : null)
      if (flight?.aircraft?.icaoType === icao && flight.aircraft.registration) regs.add(flight.aircraft.registration)
    }
    return {
      type: { icaoType: type.icaoType, iataType: type.iataType, manufacturer: type.manufacturer, name: type.name, family: type.family },
      registrations: [...regs],
    }
  })
}
