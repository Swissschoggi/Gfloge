import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import {
  aircraftTypes,
  airlines,
  airports,
  refAirlines,
  refAirports,
  refAircraftTypes,
} from '@gfloge/db'
import type { Db } from '@gfloge/db'
import type { AirlineSearchResult, AirportSearchResult, AircraftTypeSearchResult } from '@gfloge/shared'

function pattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`
}

function airportKey(value: Pick<AirportSearchResult, 'iata' | 'icao' | 'lat' | 'lon' | 'name'>): string {
  if (value.iata) return `iata:${value.iata.toUpperCase()}`
  if (value.icao) return `icao:${value.icao.toUpperCase()}`
  return `point:${value.name}:${value.lat ?? ''}:${value.lon ?? ''}`
}

function rankAirport(value: AirportSearchResult, query: string): number {
  const q = query.trim().toUpperCase()
  if (!q) return value.source.startsWith('legacy') ? 0 : 1
  if (value.iata?.toUpperCase() === q || value.icao?.toUpperCase() === q) return 0
  if (value.iata?.toUpperCase().startsWith(q) || value.icao?.toUpperCase().startsWith(q)) return 1
  if (value.city?.toUpperCase() === q) return 2
  if (value.city?.toUpperCase().startsWith(q)) return 3
  if (value.name.toUpperCase().startsWith(q)) return 4
  return 5
}

export async function searchAirports(db: Db, rawQuery: string, limit = 30): Promise<AirportSearchResult[]> {
  const query = rawQuery.trim().slice(0, 160)
  const whereLegacy = query
    ? or(ilike(airports.name, pattern(query)), ilike(airports.city, pattern(query)), ilike(airports.iata, `${query}%`), ilike(airports.icao, `${query}%`))
    : sql`true`
  const whereReference = query
    ? or(ilike(refAirports.name, pattern(query)), ilike(refAirports.city, pattern(query)), ilike(refAirports.iata, `${query}%`), ilike(refAirports.icao, `${query}%`))
    : sql`true`
  const [legacy, reference] = await Promise.all([
    db.select().from(airports).where(whereLegacy).orderBy(airports.iata).limit(limit),
    db.select().from(refAirports).where(and(whereReference, eq(refAirports.active, true))).orderBy(refAirports.iata).limit(limit),
  ])
  const merged = new Map<string, AirportSearchResult>()
  for (const row of legacy) {
    const result: AirportSearchResult = {
      id: row.id,
      iata: row.iata,
      icao: row.icao,
      name: row.name,
      city: row.city,
      country: row.country,
      tz: row.tz,
      lat: row.lat,
      lon: row.lon,
      source: `legacy:${row.source}`,
      creatable: Boolean(row.iata || row.icao) && Number.isFinite(row.lat) && Number.isFinite(row.lon),
    }
    merged.set(airportKey(result), result)
  }
  for (const row of reference) {
    const result: AirportSearchResult = {
      id: row.id,
      iata: row.iata,
      icao: row.icao,
      name: row.name,
      city: row.city,
      country: row.countryCode ?? row.country,
      tz: row.tz,
      lat: row.lat,
      lon: row.lon,
      source: `reference:${row.source}`,
      creatable: Boolean(row.iata || row.icao) && Number.isFinite(row.lat) && Number.isFinite(row.lon),
    }
    const key = airportKey(result)
    const current = merged.get(key)
    // Prefer the canonical id when both tables describe the same airport, but
    // fill missing display details from the installed reference record.
    if (!current) merged.set(key, result)
    else merged.set(key, {
      ...current,
      city: current.city || result.city,
      country: current.country || result.country,
      tz: current.tz || result.tz,
      lat: current.lat ?? result.lat,
      lon: current.lon ?? result.lon,
      creatable: current.creatable || result.creatable,
    })
  }
  return [...merged.values()].sort((a, b) => rankAirport(a, query) - rankAirport(b, query) || a.name.localeCompare(b.name)).slice(0, limit)
}

export async function airportsByCodes(db: Db, rawCodes: string[]): Promise<Map<string, AirportSearchResult>> {
  const codes = [...new Set(rawCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))]
  if (!codes.length) return new Map()
  const [legacy, reference] = await Promise.all([
    db.select().from(airports).where(or(inArray(airports.iata, codes), inArray(airports.icao, codes))),
    db.select().from(refAirports).where(and(or(inArray(refAirports.iata, codes), inArray(refAirports.icao, codes)), eq(refAirports.active, true))),
  ])
  const result = new Map<string, AirportSearchResult>()
  for (const row of legacy) {
    const airport: AirportSearchResult = { id: row.id, iata: row.iata, icao: row.icao, name: row.name, city: row.city, country: row.country, tz: row.tz, lat: row.lat, lon: row.lon, source: `legacy:${row.source}`, creatable: true }
    for (const code of [row.iata, row.icao]) if (code) result.set(code.toUpperCase(), airport)
  }
  for (const row of reference) {
    const airport: AirportSearchResult = {
      id: row.id,
      iata: row.iata,
      icao: row.icao,
      name: row.name,
      city: row.city,
      country: row.countryCode ?? row.country,
      tz: row.tz,
      lat: row.lat,
      lon: row.lon,
      source: `reference:${row.source}`,
      creatable: Boolean(row.iata || row.icao) && row.lat !== null && row.lon !== null && Boolean(row.tz),
    }
    for (const code of [row.iata, row.icao]) {
      if (code && !result.has(code.toUpperCase())) result.set(code.toUpperCase(), airport)
    }
  }
  return result
}

function airlineKey(value: Pick<AirlineSearchResult, 'iata' | 'icao' | 'name'>): string {
  if (value.iata) return `iata:${value.iata.toUpperCase()}`
  if (value.icao) return `icao:${value.icao.toUpperCase()}`
  return `name:${value.name.toUpperCase()}`
}

function rankAirline(value: AirlineSearchResult, query: string): number {
  const q = query.trim().toUpperCase()
  if (!q) return 0
  if (value.iata?.toUpperCase() === q || value.icao?.toUpperCase() === q) return 0
  if (value.iata?.toUpperCase().startsWith(q) || value.icao?.toUpperCase().startsWith(q)) return 1
  if (value.name.toUpperCase().startsWith(q)) return 2
  return 3
}

export async function searchAirlines(db: Db, rawQuery: string, limit = 30): Promise<AirlineSearchResult[]> {
  const query = rawQuery.trim().slice(0, 160)
  const whereLegacy = query
    ? or(ilike(airlines.name, pattern(query)), ilike(airlines.commonName, pattern(query)), ilike(airlines.callsign, pattern(query)), ilike(airlines.iata, `${query}%`), ilike(airlines.icao, `${query}%`))
    : sql`true`
  const whereReference = query
    ? or(ilike(refAirlines.name, pattern(query)), ilike(refAirlines.callsign, pattern(query)), ilike(refAirlines.iata, `${query}%`), ilike(refAirlines.icao, `${query}%`))
    : sql`true`
  const [legacy, reference] = await Promise.all([
    db.select().from(airlines).where(and(whereLegacy, eq(airlines.active, true))).orderBy(airlines.name).limit(limit),
    db.select().from(refAirlines).where(and(whereReference, eq(refAirlines.active, true))).orderBy(refAirlines.name).limit(limit),
  ])
  const merged = new Map<string, AirlineSearchResult>()
  for (const row of legacy) {
    const result: AirlineSearchResult = { id: row.id, iata: row.iata, icao: row.icao, name: row.commonName || row.name, country: row.country, callsign: row.callsign, source: `legacy:${row.source}` }
    merged.set(airlineKey(result), result)
  }
  for (const row of reference) {
    const result: AirlineSearchResult = { id: row.id, iata: row.iata, icao: row.icao, name: row.name, country: row.country, callsign: row.callsign, source: `reference:${row.source}` }
    const key = airlineKey(result)
    if (!merged.has(key)) merged.set(key, result)
  }
  return [...merged.values()].sort((a, b) => rankAirline(a, query) - rankAirline(b, query) || a.name.localeCompare(b.name)).slice(0, limit)
}

export async function airlinesByCodes(db: Db, rawCodes: string[]): Promise<Map<string, AirlineSearchResult>> {
  const codes = [...new Set(rawCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))]
  if (!codes.length) return new Map()
  const [legacy, reference] = await Promise.all([
    db.select().from(airlines).where(or(inArray(airlines.iata, codes), inArray(airlines.icao, codes))),
    db.select().from(refAirlines).where(and(or(inArray(refAirlines.iata, codes), inArray(refAirlines.icao, codes)), eq(refAirlines.active, true))),
  ])
  const result = new Map<string, AirlineSearchResult>()
  for (const row of legacy) {
    const airline: AirlineSearchResult = { id: row.id, iata: row.iata, icao: row.icao, name: row.commonName || row.name, country: row.country, callsign: row.callsign, source: `legacy:${row.source}` }
    for (const code of [row.iata, row.icao]) if (code) result.set(code.toUpperCase(), airline)
  }
  for (const row of reference) {
    const airline: AirlineSearchResult = { id: row.id, iata: row.iata, icao: row.icao, name: row.name, country: row.country, callsign: row.callsign, source: `reference:${row.source}` }
    for (const code of [row.iata, row.icao]) if (code && !result.has(code.toUpperCase())) result.set(code.toUpperCase(), airline)
  }
  return result
}

/** Resolve a selected code to the legacy FK table, mirroring installed reference data on demand. */
export async function resolveCanonicalAirport(db: Db, rawCode: string) {
  const code = rawCode.trim().toUpperCase()
  if (!code) return null
  const legacy = (await db.select().from(airports).where(or(eq(sql`upper(${airports.iata})`, code), eq(sql`upper(${airports.icao})`, code))).limit(1))[0]
  if (legacy) return legacy
  const reference = (await db.select().from(refAirports).where(or(eq(sql`upper(${refAirports.iata})`, code), eq(sql`upper(${refAirports.icao})`, code))).limit(1))[0]
  if (!reference || reference.lat === null || reference.lon === null || !(reference.iata || reference.icao)) return null
  const { resolveAirportTimeZoneByCodes } = await import('../timezone.js')
  const tz = resolveAirportTimeZoneByCodes(reference.icao, reference.iata, reference.tz)
  const [created] = await db.insert(airports).values({
    iata: reference.iata,
    icao: reference.icao,
    name: reference.name,
    city: reference.city ?? '',
    country: reference.countryCode ?? reference.country ?? '',
    lat: reference.lat,
    lon: reference.lon,
    tz,
    source: `reference:${reference.source}`,
  }).onConflictDoNothing().returning()
  if (created) return created
  return (await db.select().from(airports).where(or(eq(sql`upper(${airports.iata})`, code), eq(sql`upper(${airports.icao})`, code))).limit(1))[0] ?? null
}

export async function resolveCanonicalAirline(db: Db, rawCode: string) {
  const code = rawCode.trim().toUpperCase()
  if (!code) return null
  const legacy = (await db.select().from(airlines).where(or(eq(sql`upper(${airlines.iata})`, code), eq(sql`upper(${airlines.icao})`, code))).limit(1))[0]
  if (legacy) return legacy
  const reference = (await db.select().from(refAirlines).where(or(eq(sql`upper(${refAirlines.iata})`, code), eq(sql`upper(${refAirlines.icao})`, code))).limit(1))[0]
  if (!reference) return null
  const [created] = await db.insert(airlines).values({
    iata: reference.iata,
    icao: reference.icao,
    name: reference.name,
    commonName: reference.name,
    callsign: reference.callsign,
    country: reference.country,
    source: `reference:${reference.source}`,
  }).onConflictDoNothing().returning()
  if (created) return created
  return (await db.select().from(airlines).where(or(eq(sql`upper(${airlines.iata})`, code), eq(sql`upper(${airlines.icao})`, code))).limit(1))[0] ?? null
}

export async function resolveCanonicalAircraftType(db: Db, rawCode: string) {
  const code = rawCode.trim().toUpperCase()
  if (!code) return null
  const legacy = (await db.select().from(aircraftTypes).where(or(eq(sql`upper(${aircraftTypes.icaoType})`, code), eq(sql`upper(${aircraftTypes.iataType})`, code))).limit(1))[0]
  if (legacy) return legacy
  const reference = (await db.select().from(refAircraftTypes).where(or(eq(sql`upper(${refAircraftTypes.icaoType})`, code), eq(sql`upper(${refAircraftTypes.iataType})`, code))).limit(1))[0]
  if (!reference) return null
  const [created] = await db.insert(aircraftTypes).values({
    icaoType: reference.icaoType,
    iataType: reference.iataType,
    manufacturer: reference.manufacturer ?? '',
    name: reference.name,
    family: null,
    source: `reference:${reference.source}`,
  }).onConflictDoNothing().returning()
  if (created) return created
  return (await db.select().from(aircraftTypes).where(or(eq(sql`upper(${aircraftTypes.icaoType})`, code), eq(sql`upper(${aircraftTypes.iataType})`, code))).limit(1))[0] ?? null
}

export async function searchAircraftTypes(db: Db, rawQuery: string, limit = 50): Promise<AircraftTypeSearchResult[]> {
  const query = rawQuery.trim().slice(0, 120)
  const legacyWhere = query
    ? or(ilike(aircraftTypes.name, pattern(query)), ilike(aircraftTypes.manufacturer, pattern(query)), ilike(aircraftTypes.icaoType, `${query}%`), ilike(aircraftTypes.iataType, `${query}%`))
    : sql`true`
  const referenceWhere = query
    ? or(ilike(refAircraftTypes.name, pattern(query)), ilike(refAircraftTypes.manufacturer, pattern(query)), ilike(refAircraftTypes.icaoType, `${query}%`), ilike(refAircraftTypes.iataType, `${query}%`))
    : sql`true`
  const [legacy, reference] = await Promise.all([
    db.select().from(aircraftTypes).where(legacyWhere).orderBy(aircraftTypes.manufacturer, aircraftTypes.name).limit(limit),
    db.select().from(refAircraftTypes).where(referenceWhere).orderBy(refAircraftTypes.manufacturer, refAircraftTypes.name).limit(limit),
  ])
  const rows = new Map<string, AircraftTypeSearchResult>()
  for (const row of legacy) {
    const result: AircraftTypeSearchResult = { id: row.id, iataType: row.iataType, icaoType: row.icaoType, manufacturer: row.manufacturer, name: row.name, family: row.family, source: `legacy:${row.source}` }
    rows.set((row.icaoType ?? row.iataType ?? row.id).toUpperCase(), result)
  }
  for (const row of reference) {
    const result: AircraftTypeSearchResult = { id: row.id, iataType: row.iataType, icaoType: row.icaoType, manufacturer: row.manufacturer, name: row.name, family: null, source: `reference:${row.source}` }
    const key = (row.icaoType ?? row.iataType ?? row.id).toUpperCase()
    if (!rows.has(key)) rows.set(key, result)
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit)
}
