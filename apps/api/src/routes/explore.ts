import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { airports, aircraftTypes, flights, airlines, userFlights } from '@gfloge/db'
import { airportToInfo, flightsById } from '../flights-read.js'

export function registerExploreRoutes(app: FastifyInstance): void {
  app.get('/api/v1/airports/:id', async (req: FastifyRequest, reply) => {
    const id = String((req.params as Record<string, string>).id)
    const airport = (await app.db.select().from(airports).where(eq(airports.id, id)).limit(1))[0]
    if (!airport) return reply.code(404).send({ error: { code: 'not_found', message: 'Airport not found.' } })
    const now = new Date()
    const later = new Date(now.getTime() + 24 * 60 * 60_000)
    const flightRows = await app.db.select({ id: flights.id, dep: flights.departureAirportId, arr: flights.arrivalAirportId }).from(flights)
      .where(and(gte(flights.scheduledDeparture, now), lte(flights.scheduledDeparture, later)))
      .limit(300)
    const departuresIds = flightRows.filter((f) => f.dep === id).map((f) => f.id)
    const arrivalsIds = flightRows.filter((f) => f.arr === id).map((f) => f.id)
    const [departures, arrivals] = await Promise.all([flightsById(app.db, departuresIds), flightsById(app.db, arrivalsIds)])
    const userId = req.user!.id
    const personal = await app.db.select({ flightId: userFlights.flightId, role: userFlights.role, loggedState: userFlights.loggedState })
      .from(userFlights).where(eq(userFlights.userId, userId))
    const personalIds = new Set(personal.map((p) => p.flightId).filter((x): x is string => !!x))
    return {
      airport: airportToInfo(airport),
      departures: [...departures.values()].map((f) => ({ flight: f, followedOrLogged: personalIds.has(f.id) })),
      arrivals: [...arrivals.values()].map((f) => ({ flight: f, followedOrLogged: personalIds.has(f.id) })),
      weather: { condition: 'unsupported', message: 'Weather provider is not connected. No weather observations are available.' },
      map: { lat: airport.lat, lon: airport.lon },
      dataSource: 'Reference data bundled with Gfloge',
    }
  })

  app.get('/api/v1/aircraft-types', async () => {
    const rows = await app.db.select().from(aircraftTypes).orderBy(asc(aircraftTypes.manufacturer), asc(aircraftTypes.name)).limit(500)
    return { aircraftTypes: rows }
  })

  app.get('/api/v1/airlines/:id', async (req: FastifyRequest, reply) => {
    const id = String((req.params as Record<string, string>).id)
    const airline = (await app.db.select().from(airlines).where(eq(airlines.id, id)).limit(1))[0]
    if (!airline) return reply.code(404).send({ error: { code: 'not_found', message: 'Airline not found.' } })
    const flightsRows = await app.db.select({ id: flights.id }).from(flights).where(eq(flights.airlineId, id)).orderBy(asc(flights.scheduledDeparture)).limit(100)
    return { airline, flights: [...(await flightsById(app.db, flightsRows.map((x) => x.id))).values()] }
  })
}
