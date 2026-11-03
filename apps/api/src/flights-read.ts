// Canonical flight queries: shared read shapes (FlightRead) assembled from
// the instance-shared tables. All user-facing merges keep data provenance.
import { aliasedTable, and, eq, inArray } from 'drizzle-orm'
import {
  aircraftTypes,
  airlines,
  airports,
  flights,
  manualFlights,
} from '@gfloge/db'
import type { Db } from '@gfloge/db'
import {
  DEMO_PROVIDER_ID,
  type AirlineInfo,
  type AircraftInfo,
  type AirportInfo,
  type FlightRead,
  type FlightStatus,
} from '@gfloge/shared'

function airportToInfo(row: typeof airports.$inferSelect): AirportInfo {
  return {
    id: row.id,
    iata: row.iata,
    icao: row.icao,
    name: row.name,
    city: row.city,
    country: row.country,
    tz: row.tz,
    lat: row.lat,
    lon: row.lon,
  }
}

function airlineToInfo(row: typeof airlines.$inferSelect | null): AirlineInfo | null {
  if (!row) return null
  return { id: row.id, iata: row.iata, icao: row.icao, name: row.name, country: row.country }
}

function aircraftInfo(registration: string | null, typeRow: typeof aircraftTypes.$inferSelect | null): AircraftInfo | null {
  if (!registration && !typeRow) return null
  return {
    registration,
    icaoType: typeRow?.icaoType ?? null,
    typeName: typeRow?.name ?? null,
    manufacturer: typeRow?.manufacturer ?? null,
  }
}

/** A provider ref keyed demo means the whole record is demo-labelled. */
function isDemoFlight(providerRefs: unknown): boolean {
  const refs = (providerRefs ?? {}) as Record<string, unknown>
  return DEMO_PROVIDER_ID in refs
}

export async function flightsById(db: Db, ids: string[]): Promise<Map<string, FlightRead>> {
  if (ids.length === 0) return new Map()
  const dep = aliasedTable(airports, 'dep_airport')
  const arr = aliasedTable(airports, 'arr_airport')
  const rows = await db
    .select({
      f: flights,
      dep,
      arr,
      airline: airlines,
      type: aircraftTypes,
    })
    .from(flights)
    .innerJoin(dep, eq(dep.id, flights.departureAirportId))
    .innerJoin(arr, eq(arr.id, flights.arrivalAirportId))
    .leftJoin(airlines, eq(airlines.id, flights.airlineId))
    .leftJoin(aircraftTypes, eq(aircraftTypes.id, flights.aircraftTypeId))
    .where(inArray(flights.id, ids))

  const map = new Map<string, FlightRead>()
  for (const row of rows) {
    const f = row.f
    map.set(f.id, {
      id: f.id,
      flightCode: f.flightCode,
      airline: airlineToInfo(row.airline),
      departure: airportToInfo(row.dep),
      arrival: airportToInfo(row.arr),
      scheduledDeparture: f.scheduledDeparture.toISOString(),
      scheduledArrival: f.scheduledArrival.toISOString(),
      actualDeparture: f.actualDeparture?.toISOString() ?? null,
      actualArrival: f.actualArrival?.toISOString() ?? null,
      status: f.status as FlightStatus,
      depTerminal: f.depTerminal,
      depGate: f.depGate,
      arrTerminal: f.arrTerminal,
      arrGate: f.arrGate,
      arrBaggage: f.arrBaggage,
      aircraft: aircraftInfo(f.aircraftRegistration, row.type),
      distanceKm: f.distanceKm,
      providerId: isDemoFlight(f.providerRefs) ? DEMO_PROVIDER_ID : null,
      isDemo: isDemoFlight(f.providerRefs),
      isManual: false,
    })
  }
  return map
}

export async function manualFlightsById(db: Db, userId: string, ids: string[]): Promise<Map<string, FlightRead>> {
  if (ids.length === 0) return new Map()
  const dep = aliasedTable(airports, 'dep_airport')
  const arr = aliasedTable(airports, 'arr_airport')
  // Strict isolation: manual records are fetched for their owner only.
  const rows = await db
    .select({ m: manualFlights, dep, arr, airline: airlines, type: aircraftTypes })
    .from(manualFlights)
    .innerJoin(dep, eq(dep.id, manualFlights.departureAirportId))
    .innerJoin(arr, eq(arr.id, manualFlights.arrivalAirportId))
    .leftJoin(airlines, eq(airlines.id, manualFlights.airlineId))
    .leftJoin(aircraftTypes, eq(aircraftTypes.id, manualFlights.aircraftTypeId))
    .where(and(inArray(manualFlights.id, ids), eq(manualFlights.userId, userId)))

  const map = new Map<string, FlightRead>()
  for (const row of rows) {
    const m = row.m
    map.set(m.id, {
      id: `manual:${m.id}`,
      flightCode: m.flightNumber ?? 'Recorded flight',
      airline: airlineToInfo(row.airline),
      departure: airportToInfo(row.dep),
      arrival: airportToInfo(row.arr),
      scheduledDeparture: m.scheduledDeparture.toISOString(),
      scheduledArrival: (m.scheduledArrival ?? m.scheduledDeparture).toISOString(),
      actualDeparture: null,
      actualArrival: null,
      status: 'unknown',
      depTerminal: null,
      depGate: null,
      arrTerminal: null,
      arrGate: null,
      arrBaggage: null,
      aircraft: aircraftInfo(null, row.type),
      distanceKm: m.distanceKm,
      providerId: null,
      isDemo: false,
      isManual: true,
    })
  }
  return map
}

export { airportToInfo, aircraftInfo }
