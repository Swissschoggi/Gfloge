// Canonical flight queries: shared read shapes (FlightRead) assembled from
// the instance-shared tables. All user-facing merges keep data provenance.
import { aliasedTable, and, eq, inArray } from 'drizzle-orm'
import {
  aircraftTypes,
  airlines,
  airports,
  flights,
  manualFlights,
  userFlights,
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
    tz: row.tz ?? null,
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

function providerIdFrom(providerRefs: unknown): string | null {
  const refs = (providerRefs ?? {}) as Record<string, unknown>
  const id = Object.keys(refs)[0]
  return id ?? null
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
      scheduledGateDeparture: null,
      actualGateDeparture: null,
      scheduledTakeoff: null,
      actualTakeoff: null,
      scheduledLanding: null,
      actualLanding: null,
      scheduledGateArrival: null,
      actualGateArrival: null,
      cancelled: false,
      divertedTo: null, // resolved from divertedToAirportId when available
      seat: null,
      seatType: null,
      bookingReference: null,
      flightReason: null,
      sourceType: null,
      sourceName: null,
      sourceMetadata: null,
      fieldSources: null,
      aircraft: aircraftInfo(f.aircraftRegistration, row.type),
      distanceKm: f.distanceKm,
      providerId: providerIdFrom(f.providerRefs),
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
    .select({ m: manualFlights, dep, arr, airline: airlines, type: aircraftTypes, relationNote: userFlights.note, relationSource: userFlights.source })
    .from(manualFlights)
    .innerJoin(dep, eq(dep.id, manualFlights.departureAirportId))
    .innerJoin(arr, eq(arr.id, manualFlights.arrivalAirportId))
    .leftJoin(airlines, eq(airlines.id, manualFlights.airlineId))
    .leftJoin(aircraftTypes, eq(aircraftTypes.id, manualFlights.aircraftTypeId))
    .leftJoin(userFlights, and(eq(userFlights.manualFlightId, manualFlights.id), eq(userFlights.userId, userId)))
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
      actualDeparture: m.actualDeparture?.toISOString() ?? null,
      actualArrival: m.actualArrival?.toISOString() ?? null,
      scheduledGateDeparture: m.scheduledGateDeparture?.toISOString() ?? null,
      actualGateDeparture: m.actualGateDeparture?.toISOString() ?? null,
      scheduledTakeoff: m.scheduledTakeoff?.toISOString() ?? null,
      actualTakeoff: m.actualTakeoff?.toISOString() ?? null,
      scheduledLanding: m.scheduledLanding?.toISOString() ?? null,
      actualLanding: m.actualLanding?.toISOString() ?? null,
      scheduledGateArrival: m.scheduledGateArrival?.toISOString() ?? null,
      actualGateArrival: m.actualGateArrival?.toISOString() ?? null,
      cancelled: m.cancelled ?? false,
      divertedTo: null, // resolved from divertedToAirportId when available
      seat: m.seat ?? null,
      seatType: m.seatType ?? null,
      bookingReference: m.bookingReference ?? null,
      flightReason: m.flightReason ?? null,
      sourceType: m.sourceType ?? null,
      sourceName: m.sourceName ?? null,
      sourceMetadata: (m.sourceMetadata as Record<string, string>) ?? null,
      fieldSources: (m.fieldSources as Record<string, unknown>) ?? null,
      status: 'unknown',
      depTerminal: m.depTerminal ?? null,
      depGate: m.depGate ?? null,
      arrTerminal: m.arrTerminal ?? null,
      arrGate: m.arrGate ?? null,
      arrBaggage: null,
      aircraft: aircraftInfo(m.aircraftRegistration, row.type),
      distanceKm: m.distanceKm,
      providerId: row.relationSource === 'import' && row.relationNote?.startsWith('Historical observation from ') ? 'mrairspace' : null,
      isDemo: false,
      isManual: true,
    })
  }
  return map
}

export { airportToInfo, aircraftInfo }
