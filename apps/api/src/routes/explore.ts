import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, asc, eq, gte, inArray, lte, or } from 'drizzle-orm'
import { airports, flights, airlines, refAirports, refAirlines, userFlights } from '@gfloge/db'
import { airportToInfo, flightsById } from '../flights-read.js'
import { searchAircraftTypes } from '../reference/search.js'

export function registerExploreRoutes(app: FastifyInstance): void {
  app.get('/api/v1/airports/:id', async (req: FastifyRequest, reply) => {
    const id = String((req.params as Record<string, string>).id)
    const canonical = (await app.db.select().from(airports).where(eq(airports.id, id)).limit(1))[0]
    const reference = canonical ? null : (await app.db.select().from(refAirports).where(eq(refAirports.id, id)).limit(1))[0]
    const airport = canonical ?? reference
    if (!airport) return reply.code(404).send({ error: { code: 'not_found', message: 'Airport not found.' } })
    const iata = airport.iata
    const icao = airport.icao
    const localAirportIds = canonical ? [canonical.id] : (iata || icao) ? await app.db.select({ id: airports.id }).from(airports)
      .where(or(iata ? eq(airports.iata, iata) : undefined, icao ? eq(airports.icao, icao) : undefined))
      .then((rows) => rows.map((row) => row.id)) : []
    const now = new Date()
    const later = new Date(now.getTime() + 24 * 60 * 60_000)
    const flightRows = localAirportIds.length ? await app.db.select({ id: flights.id, dep: flights.departureAirportId, arr: flights.arrivalAirportId }).from(flights)
      .where(and(gte(flights.scheduledDeparture, now), lte(flights.scheduledDeparture, later), or(inArray(flights.departureAirportId, localAirportIds), inArray(flights.arrivalAirportId, localAirportIds))))
      .limit(300) : []
    const departuresIds = flightRows.filter((f) => localAirportIds.includes(f.dep)).map((f) => f.id)
    const arrivalsIds = flightRows.filter((f) => localAirportIds.includes(f.arr)).map((f) => f.id)
    const [departures, arrivals] = await Promise.all([flightsById(app.db, departuresIds), flightsById(app.db, arrivalsIds)])
    const userId = req.user!.id
    const personal = await app.db.select({ flightId: userFlights.flightId, role: userFlights.role, loggedState: userFlights.loggedState })
      .from(userFlights).where(eq(userFlights.userId, userId))
    const personalIds = new Set(personal.map((p) => p.flightId).filter((x): x is string => !!x))
    return {
      airport: canonical ? airportToInfo(canonical) : {
        id: reference!.id,
        iata: reference!.iata,
        icao: reference!.icao,
        name: reference!.name,
        city: reference!.city,
        country: reference!.countryCode ?? reference!.country,
        tz: reference!.tz,
        lat: reference!.lat,
        lon: reference!.lon,
      },
      departures: [...departures.values()].map((f) => ({ flight: f, followedOrLogged: personalIds.has(f.id) })),
      arrivals: [...arrivals.values()].map((f) => ({ flight: f, followedOrLogged: personalIds.has(f.id) })),
      weather: { condition: 'unsupported', message: 'Weather provider is not connected. No weather observations are available.' },
      map: { lat: airport.lat, lon: airport.lon },
      dataSource: 'Reference data bundled with Gfloge',
    }
  })

  app.get('/api/v1/aircraft-types', async (req) => {
    const q = String((req.query as Record<string, string | undefined>)['q'] ?? '')
    return { aircraftTypes: await searchAircraftTypes(app.db, q, 500) }
  })

  app.get('/api/v1/airlines/:id', async (req: FastifyRequest, reply) => {
    const id = String((req.params as Record<string, string>).id)
    const canonical = (await app.db.select().from(airlines).where(eq(airlines.id, id)).limit(1))[0]
    const reference = canonical ? null : (await app.db.select().from(refAirlines).where(eq(refAirlines.id, id)).limit(1))[0]
    const airline = canonical ?? reference
    if (!airline) return reply.code(404).send({ error: { code: 'not_found', message: 'Airline not found.' } })
    const airlineIds = canonical ? [canonical.id] : (airline.iata || airline.icao) ? await app.db.select({ id: airlines.id }).from(airlines)
      .where(or(airline.iata ? eq(airlines.iata, airline.iata) : undefined, airline.icao ? eq(airlines.icao, airline.icao) : undefined))
      .then((rows) => rows.map((row) => row.id)) : []
    const flightsRows = airlineIds.length ? await app.db.select({ id: flights.id }).from(flights).where(inArray(flights.airlineId, airlineIds)).orderBy(asc(flights.scheduledDeparture)).limit(100) : []
    return {
      airline: { id: airline.id, iata: airline.iata, icao: airline.icao, name: canonical?.commonName || airline.name, country: airline.country, callsign: airline.callsign, source: canonical?.source ?? reference?.source ?? 'reference' },
      flights: [...(await flightsById(app.db, flightsRows.map((row) => row.id))).values()],
    }
  })
}
