import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, asc, eq } from 'drizzle-orm'
import { trips, userFlights } from '@gfloge/db'
import type { Db } from '@gfloge/db'
import { tripSchema, type TripRead, type UserFlightItem } from '@gfloge/shared'
import { flightsById, manualFlightsById } from '../flights-read.js'

type User = NonNullable<FastifyRequest['user']>
const owner = (req: FastifyRequest): User => req.user as User

export function registerTripRoutes(app: FastifyInstance): void {
  const db = app.db

  app.get('/api/v1/trips', async (req) => ({ trips: await listTrips(db, owner(req).id) }))

  app.post('/api/v1/trips', async (req, reply) => {
    const parsed = tripSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'Enter a trip name.' } })
    const input = parsed.data
    const [created] = await db.insert(trips).values({
      userId: owner(req).id,
      name: input.name,
      description: input.description ?? null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
    }).returning({ id: trips.id })
    return { trip: (await getTrip(db, owner(req).id, created!.id))! }
  })

  app.get('/api/v1/trips/:id', async (req, reply) => {
    const trip = await getTrip(db, owner(req).id, String((req.params as Record<string, string>).id))
    if (!trip) return reply.code(404).send({ error: { code: 'not_found', message: 'No trip with this name belongs to you.' } })
    return { trip }
  })

  app.patch('/api/v1/trips/:id', async (req, reply) => {
    const parsed = tripSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'Trip details are invalid.' } })
    const id = String((req.params as Record<string, string>).id)
    const existing = await db.select({ id: trips.id }).from(trips).where(and(eq(trips.id, id), eq(trips.userId, owner(req).id))).limit(1)
    if (!existing[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'No trip with this name belongs to you.' } })
    const input = parsed.data
    await db.update(trips).set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate ? new Date(input.startDate) : null } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate ? new Date(input.endDate) : null } : {}),
      updatedAt: new Date(),
    }).where(eq(trips.id, id))
    return { trip: (await getTrip(db, owner(req).id, id))! }
  })

  app.delete('/api/v1/trips/:id', async (req, reply) => {
    const id = String((req.params as Record<string, string>).id)
    const rows = await db.select({ id: trips.id }).from(trips).where(and(eq(trips.id, id), eq(trips.userId, owner(req).id))).limit(1)
    if (!rows[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'No trip with this name belongs to you.' } })
    await db.update(userFlights).set({ tripId: null }).where(and(eq(userFlights.tripId, id), eq(userFlights.userId, owner(req).id)))
    await db.delete(trips).where(eq(trips.id, id))
    return { ok: true }
  })

  app.put('/api/v1/trips/:id/flights/:userFlightId', async (req, reply) => {
    const tripId = String((req.params as Record<string, string>).id)
    const userFlightId = String((req.params as Record<string, string>).userFlightId)
    const tripOwner = await db.select({ id: trips.id }).from(trips).where(and(eq(trips.id, tripId), eq(trips.userId, owner(req).id))).limit(1)
    if (!tripOwner[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'No trip with this name belongs to you.' } })
    const relation = await db.select({ id: userFlights.id }).from(userFlights).where(and(eq(userFlights.id, userFlightId), eq(userFlights.userId, owner(req).id))).limit(1)
    if (!relation[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'No flight record of yours matches.' } })
    await db.update(userFlights).set({ tripId, updatedAt: new Date() }).where(eq(userFlights.id, userFlightId))
    return { ok: true }
  })

  app.delete('/api/v1/trips/:id/flights/:userFlightId', async (req, reply) => {
    const tripId = String((req.params as Record<string, string>).id)
    const userFlightId = String((req.params as Record<string, string>).userFlightId)
    const tripOwner = await db.select({ id: trips.id }).from(trips).where(and(eq(trips.id, tripId), eq(trips.userId, owner(req).id))).limit(1)
    if (!tripOwner[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'No trip with this name belongs to you.' } })
    await db.update(userFlights).set({ tripId: null, updatedAt: new Date() }).where(and(eq(userFlights.id, userFlightId), eq(userFlights.userId, owner(req).id), eq(userFlights.tripId, tripId)))
    return { ok: true }
  })
}

async function listTrips(db: Db, userId: string): Promise<TripRead[]> {
  const rows = await db.select().from(trips).where(eq(trips.userId, userId)).orderBy(asc(trips.startDate), asc(trips.name))
  return Promise.all(rows.map(async (row) => (await getTrip(db, userId, row.id))!))
}

async function getTrip(db: Db, userId: string, id: string): Promise<TripRead | null> {
  const [trip] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.userId, userId))).limit(1)
  if (!trip) return null
  const relations = await db.select().from(userFlights).where(and(eq(userFlights.tripId, id), eq(userFlights.userId, userId))).orderBy(asc(userFlights.createdAt))
  const canonicalIds = relations.map((r) => r.flightId).filter((x): x is string => !!x)
  const manualIds = relations.map((r) => r.manualFlightId).filter((x): x is string => !!x)
  const [canonical, manual] = await Promise.all([flightsById(db, canonicalIds), manualFlightsById(db, userId, manualIds)])
  const flightsInTrip: UserFlightItem[] = []
  for (const relation of relations) {
    const flight = (relation.flightId ? canonical.get(relation.flightId) : null) ?? (relation.manualFlightId ? manual.get(relation.manualFlightId) : null)
    if (!flight) continue
    flightsInTrip.push({ id: relation.id, role: relation.role, isFollowing: relation.trackedFrom !== null && relation.trackedUntil === null, loggedState: relation.loggedState, seat: relation.seat, cabin: relation.cabin, note: relation.note, rating: relation.rating, tripId: relation.tripId, source: relation.source, flight })
  }
  return { id: trip.id, name: trip.name, description: trip.description, startDate: trip.startDate?.toISOString() ?? null, endDate: trip.endDate?.toISOString() ?? null, flights: flightsInTrip }
}
