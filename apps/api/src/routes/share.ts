import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { shareLinks, trips, userFlights } from '@gfloge/db'
import type { Db } from '@gfloge/db'
import { newSessionToken, hashToken } from '../crypto.js'
import { flightsById, manualFlightsById } from '../flights-read.js'
import type { FlightRead } from '@gfloge/shared'

function requireUser(req: FastifyRequest): { id: string } {
  return req.user as { id: string }
}

function publicFlight(flight: FlightRead) {
  return {
    flightCode: flight.flightCode,
    airline: flight.airline ? { iata: flight.airline.iata, name: flight.airline.name } : null,
    departure: {
      iata: flight.departure.iata,
      icao: flight.departure.icao,
      name: flight.departure.name,
      city: flight.departure.city,
      tz: flight.departure.tz,
    },
    arrival: {
      iata: flight.arrival.iata,
      icao: flight.arrival.icao,
      name: flight.arrival.name,
      city: flight.arrival.city,
      tz: flight.arrival.tz,
    },
    scheduledDeparture: flight.scheduledDeparture,
    scheduledArrival: flight.scheduledArrival,
    actualDeparture: flight.actualDeparture,
    actualArrival: flight.actualArrival,
    status: flight.status,
    aircraft: flight.aircraft
      ? { registration: flight.aircraft.registration, icaoType: flight.aircraft.icaoType, typeName: flight.aircraft.typeName }
      : null,
    distanceKm: flight.distanceKm,
  }
}

async function getUserFlight(db: Db, userId: string, userFlightId: string) {
  const rows = await db.select().from(userFlights).where(and(eq(userFlights.id, userFlightId), eq(userFlights.userId, userId))).limit(1)
  if (!rows[0]) return null
  const uf = rows[0]
  let flight: FlightRead | null = null
  if (uf.flightId) {
    const map = await flightsById(db, [uf.flightId])
    flight = map.get(uf.flightId) ?? null
  } else if (uf.manualFlightId) {
    const map = await manualFlightsById(db, userId, [uf.manualFlightId])
    flight = map.get(uf.manualFlightId) ?? null
  }
  return { uf, flight }
}

export function registerShareRoutes(app: FastifyInstance): void {
  const db = app.db

  app.post('/api/v1/share/flights', async (req, reply) => {
    const user = requireUser(req)
    const parsed = z.object({ userFlightId: z.string().uuid() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: { code: 'validation', message: 'userFlightId is required.' } })
    const ownership = await db.select({ id: userFlights.id }).from(userFlights).where(and(eq(userFlights.id, parsed.data.userFlightId), eq(userFlights.userId, user.id))).limit(1)
    if (!ownership[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'Flight not found.' } })
    const { token, tokenHash } = newSessionToken()
    const [created] = await db.insert(shareLinks).values({
      userId: user.id,
      resourceType: 'flight',
      resourceId: parsed.data.userFlightId,
      tokenHash,
    }).returning({ id: shareLinks.id })
    return { id: created!.id, token, url: `/share/flight/${token}` }
  })

  app.post('/api/v1/share/trips', async (req, reply) => {
    const user = requireUser(req)
    const parsed = z.object({ tripId: z.string().uuid() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: { code: 'validation', message: 'tripId is required.' } })
    const ownership = await db.select({ id: trips.id }).from(trips).where(and(eq(trips.id, parsed.data.tripId), eq(trips.userId, user.id))).limit(1)
    if (!ownership[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'Trip not found.' } })
    const { token, tokenHash } = newSessionToken()
    const [created] = await db.insert(shareLinks).values({
      userId: user.id,
      resourceType: 'trip',
      resourceId: parsed.data.tripId,
      tokenHash,
    }).returning({ id: shareLinks.id })
    return { id: created!.id, token, url: `/share/trip/${token}` }
  })

  app.delete('/api/v1/share-links/:id', async (req, reply) => {
    const user = requireUser(req)
    const id = String((req.params as Record<string, string>).id)
    const rows = await db.select({ id: shareLinks.id }).from(shareLinks).where(and(eq(shareLinks.id, id), eq(shareLinks.userId, user.id))).limit(1)
    if (!rows[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'Share link not found.' } })
    await db.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, id))
    return { ok: true }
  })

  app.get('/api/v1/share/flights/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = String((req.params as Record<string, string>).token)
    if (!token || token.length < 20) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } })
    const tokenHash = hashToken(token)
    const rows = await db.select().from(shareLinks).where(and(eq(shareLinks.tokenHash, tokenHash), eq(shareLinks.resourceType, 'flight'))).limit(1)
    const link = rows[0]
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'This share link is no longer available.' } })
    }
    const data = await getUserFlight(db, link.userId, link.resourceId)
    if (!data || !data.flight) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } })
    return { shared: true, readOnly: true, flight: publicFlight(data.flight) }
  })

  app.get('/api/v1/share/trips/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = String((req.params as Record<string, string>).token)
    if (!token || token.length < 20) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } })
    const tokenHash = hashToken(token)
    const rows = await db.select().from(shareLinks).where(and(eq(shareLinks.tokenHash, tokenHash), eq(shareLinks.resourceType, 'trip'))).limit(1)
    const link = rows[0]
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'This share link is no longer available.' } })
    }
    const tripRows = await db.select().from(trips).where(and(eq(trips.id, link.resourceId), eq(trips.userId, link.userId))).limit(1)
    const trip = tripRows[0]
    if (!trip) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } })
    const relations = await db.select().from(userFlights).where(and(eq(userFlights.tripId, trip.id), eq(userFlights.userId, link.userId))).orderBy(userFlights.createdAt)
    const canonicalIds = relations.map((r) => r.flightId).filter((x): x is string => !!x)
    const manualIds = relations.map((r) => r.manualFlightId).filter((x): x is string => !!x)
    const [canonical, manual] = await Promise.all([flightsById(db, canonicalIds), manualFlightsById(db, link.userId, manualIds)])
    const flights = relations
      .map((relation) => {
        const flight = (relation.flightId ? canonical.get(relation.flightId) : null) ?? (relation.manualFlightId ? manual.get(relation.manualFlightId) : null)
        if (!flight) return null
        return {
          ...publicFlight(flight),
          planned: relation.loggedState === 'planned',
        }
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.scheduledDeparture.localeCompare(b.scheduledDeparture))
    return {
      shared: true,
      readOnly: true,
      trip: {
        title: trip.name,
        startDate: trip.startDate?.toISOString() ?? null,
        endDate: trip.endDate?.toISOString() ?? null,
        flights,
      },
    }
  })
}
