// Historical lookup: DuckDB over installed Parquet files. No separate server;
// embedded DuckDB only. Returns candidates, never auto-selects one.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { eq, inArray, or, sql } from 'drizzle-orm'
import { historicalDatasets, airlines, airports, refAirlines, refAirports } from '@gfloge/db'
import type { Db } from '@gfloge/db'
import { toLocalIso } from '@gfloge/shared'

export type HistoricalCandidate = {
  datasetKey: string
  source: string
  callsign: string
  airlineIcao: string | null
  registration: string | null
  aircraftType: string | null
  aircraftTypeDetail: string | null
  departureAirport: string | null // ICAO
  arrivalAirport: string | null // ICAO
  departureIata: string | null
  arrivalIata: string | null
  departureAirportName: string | null
  arrivalAirportName: string | null
  trackOriginLat: number | null
  trackOriginLon: number | null
  trackDestinationLat: number | null
  trackDestinationLon: number | null
  departureTimeUtc: string | null
  arrivalTimeUtc: string | null
  routeValidation: string | null
  datasetKeys: string[]
}

export type HistoricalSearchCriteria = {
  date: string
  callsigns?: string[]
  airlineCodes?: string[]
  departureCodes?: string[]
  arrivalCodes?: string[]
  registration?: string
  departureTime?: string
  timeWindowMinutes?: number
}

export type HistoricalSearchResult = {
  duckdbAvailable: boolean
  covered: boolean
  candidates: HistoricalCandidate[]
  note: string
}

const requireDuckdb = createRequire(import.meta.url)

function duckdbAvailable(): boolean {
  try {
    requireDuckdb('duckdb')
    return true
  } catch {
    return false
  }
}

async function installedDatasets(db: Db, date: string): Promise<Array<{ id: string; localPath: string; datasetKey: string; source: string }>> {
  const rows = await db.select().from(historicalDatasets).where(eq(historicalDatasets.status, 'installed'))
  return rows
    .filter((r) => r.localPath && r.dateStart <= date && r.dateEnd >= date)
    .map((r) => ({ id: r.id, localPath: r.localPath!, datasetKey: r.datasetKey, source: r.source }))
}

export async function searchHistorical(
  db: Db,
  flightNumber: string,
  date: string
): Promise<{ duckdbAvailable: boolean; candidates: HistoricalCandidate[]; note: string }> {
  const result = await searchHistoricalCriteria(db, { date, callsigns: await flightCallsigns(db, flightNumber) })
  return { duckdbAvailable: result.duckdbAvailable, candidates: result.candidates, note: result.note }
}

export async function searchHistoricalCriteria(db: Db, criteria: HistoricalSearchCriteria): Promise<HistoricalSearchResult> {
  if (!duckdbAvailable()) {
    return { duckdbAvailable: false, covered: false, candidates: [], note: 'DuckDB binding is not installed on this host, so installed Parquet datasets cannot be queried.' }
  }
  // Dynamic require is intentional here: duckdb is an optional native binding.
  const duckdb = requireDuckdb('duckdb')
  const datasets = await installedDatasets(db, criteria.date)
  if (datasets.length === 0) return { duckdbAvailable: true, covered: false, candidates: [], note: 'No installed historical dataset covers this departure date. This is not a negative flight search.' }

  const start = new Date(`${criteria.date}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - 1)
  const end = new Date(`${criteria.date}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + 2)
  const windowStart = start.toISOString().slice(0, 10)
  const windowEnd = end.toISOString().slice(0, 10)
  const rawCandidates: Array<{ datasetKey: string; source: string; row: Record<string, unknown>; depIcao: string | null; arrIcao: string | null }> = []
  for (const dataset of datasets) {
    if (!existsSync(dataset.localPath)) continue
    const rows = await queryParquetCriteria(duckdb, dataset.localPath, criteria, windowStart, windowEnd)
    for (const row of rows) {
      const routeParts = String(row.Route_Validation_Based_on_Callsign ?? '').split(/[-/]/)
      const depIcao = extractAirport(String(row.Track_Origin_ApplicableAirports ?? '')) ?? extractAirport(routeParts[0] ?? '')
      const arrIcao = extractAirport(String(row.Track_Destination_ApplicableAirports ?? '')) ?? extractAirport(routeParts[1] ?? '')
      rawCandidates.push({ datasetKey: dataset.datasetKey, source: dataset.source, row, depIcao, arrIcao })
    }
  }

  const airportCodes = [...new Set(rawCandidates.flatMap((item) => [item.depIcao, item.arrIcao]).filter((value): value is string => !!value))]
  const airlineCodes = [...new Set(rawCandidates.map(({ row }) => cleanValue(row.Airline)?.toUpperCase()).filter((value): value is string => !!value))]
  const [referenceAirports, legacyAirports, referenceAirlines, legacyAirlines] = await Promise.all([
    airportCodes.length ? db.select().from(refAirports).where(inArray(refAirports.icao, airportCodes)) : Promise.resolve([]),
    airportCodes.length ? db.select().from(airports).where(inArray(airports.icao, airportCodes)) : Promise.resolve([]),
    airlineCodes.length ? db.select().from(refAirlines).where(inArray(refAirlines.icao, airlineCodes)) : Promise.resolve([]),
    airlineCodes.length ? db.select().from(airlines).where(inArray(airlines.icao, airlineCodes)) : Promise.resolve([]),
  ])
  const airportByIcao = new Map<string, { iata: string | null; name: string; tz: string | null }>()
  for (const airport of [...referenceAirports, ...legacyAirports]) if (airport.icao) airportByIcao.set(airport.icao.toUpperCase(), { iata: airport.iata, name: airport.name, tz: airport.tz })
  const airlineByIcao = new Map<string, { iata: string | null; name: string }>()
  for (const airline of [...referenceAirlines, ...legacyAirlines]) if (airline.icao) airlineByIcao.set(airline.icao.toUpperCase(), { iata: airline.iata, name: airline.name })

  const deduped = new Map<string, HistoricalCandidate>()
  for (const item of rawCandidates) {
    const row = item.row
    const departureTimeUtc = cleanValue(row.Track_Origin_DateTime_UTC)
    const arrivalTimeUtc = cleanValue(row.Track_Destination_DateTime_UTC)
    const depAirport = item.depIcao ? airportByIcao.get(item.depIcao) : null
    const arrAirport = item.arrIcao ? airportByIcao.get(item.arrIcao) : null
    if (criteria.departureCodes?.length && !criteria.departureCodes.some((code) => [item.depIcao, depAirport?.iata].some((value) => value?.toUpperCase() === code.toUpperCase()))) continue
    if (criteria.arrivalCodes?.length && !criteria.arrivalCodes.some((code) => [item.arrIcao, arrAirport?.iata].some((value) => value?.toUpperCase() === code.toUpperCase()))) continue
    const airlineIcao = cleanValue(row.Airline)?.toUpperCase() ?? null
    if (criteria.airlineCodes?.length && !criteria.airlineCodes.some((code) => code.toUpperCase() === airlineIcao || code.toUpperCase() === airlineByIcao.get(airlineIcao ?? '')?.iata?.toUpperCase())) continue
    const registration = cleanValue(row.Reg)?.toUpperCase().replace(/[\s-]+/g, '') ?? null
    if (criteria.registration && registration !== criteria.registration.toUpperCase().replace(/[\s-]+/g, '')) continue
    const departureInstant = parseHistoricalUtc(departureTimeUtc)
    const timezone = depAirport?.tz ?? 'UTC'
    // Keep observations across the UTC window; local-date filtering is applied by the caller when needed.
    // A missing timezone prevents a reliable local-date/time comparison. Keep
    // the observation as incomplete instead of dropping it or inventing UTC.
    if (criteria.departureTime && depAirport?.tz && !withinLocalTime(departureInstant, criteria.departureTime, criteria.timeWindowMinutes ?? 90, timezone)) continue
    const callsign = cleanValue(row.Callsign) ?? ''
    if (criteria.callsigns?.length && !criteria.callsigns.includes(compactCode(callsign))) continue

    const candidate: HistoricalCandidate = {
        datasetKey: item.datasetKey,
        datasetKeys: [item.datasetKey],
        source: item.source,
        callsign,
        airlineIcao,
        registration,
        aircraftType: cleanValue(row.AC_Type),
        aircraftTypeDetail: cleanValue(row.AC_Type_Detailed),
        departureAirport: item.depIcao,
        arrivalAirport: item.arrIcao,
        departureIata: depAirport?.iata ?? null,
        arrivalIata: arrAirport?.iata ?? null,
        departureAirportName: depAirport?.name ?? null,
        arrivalAirportName: arrAirport?.name ?? null,
        trackOriginLat: toNumber(row.Track_Origin_Lat),
        trackOriginLon: toNumber(row.Track_Origin_Lon),
        trackDestinationLat: toNumber(row.Track_Destination_Lat),
        trackDestinationLon: toNumber(row.Track_Destination_Lon),
        departureTimeUtc,
        arrivalTimeUtc,
        routeValidation: cleanValue(row.Route_Validation_Based_on_Callsign),
      }
    const key = [compactCode(callsign), item.depIcao ?? '', item.arrIcao ?? '', departureTimeUtc ?? '', registration ?? ''].join('|')
    const existing = deduped.get(key)
    if (existing) {
      if (!existing.datasetKeys.includes(item.datasetKey)) existing.datasetKeys.push(item.datasetKey)
      continue
    }
    deduped.set(key, candidate)
  }
  const candidates = [...deduped.values()].sort((a, b) => (a.departureTimeUtc ?? '').localeCompare(b.departureTimeUtc ?? '')).slice(0, 200)
  return {
    duckdbAvailable: true,
    covered: true,
    candidates,
    note: candidates.length === 0
      ? 'Installed historical datasets covering this date were searched and contained no matching observation.'
      : `${candidates.length} historical observation${candidates.length === 1 ? '' : 's'} found. Review each candidate; these are not confirmed future schedules.`,
  }
}

function compactCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, '')
}

function parseHistoricalUtc(value: string | null): Date | null {
  if (!value) return null
  const normalized = value.trim().replace(' ', 'T')
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`)
  return Number.isFinite(date.getTime()) ? date : null
}

function withinLocalTime(instant: Date | null, time: string, windowMinutes: number, timezone: string): boolean {
  if (!instant) return false
  const local = toLocalIso(instant, timezone).slice(11, 16)
  const [hour, minute] = local.split(':').map(Number)
  const [targetHour, targetMinute] = time.split(':').map(Number)
  const difference = Math.abs(hour! * 60 + minute! - (targetHour! * 60 + targetMinute!))
  return Math.min(difference, 1440 - difference) <= windowMinutes
}

async function flightCallsigns(db: Db, flightNumber: string): Promise<string[]> {
  const raw = compactCode(flightNumber)
  const candidates = new Set<string>([raw])
  const aliases = new Set<string>()
  for (const prefixLength of [2, 3]) {
    if (raw.length <= prefixLength) continue
    const prefix = raw.slice(0, prefixLength)
    const [reference, legacy] = await Promise.all([
      db.select({ iata: refAirlines.iata, icao: refAirlines.icao }).from(refAirlines).where(or(eq(sql`upper(${refAirlines.iata})`, prefix), eq(sql`upper(${refAirlines.icao})`, prefix))),
      db.select({ iata: airlines.iata, icao: airlines.icao }).from(airlines).where(or(eq(sql`upper(${airlines.iata})`, prefix), eq(sql`upper(${airlines.icao})`, prefix))),
    ])
    for (const airline of [...reference, ...legacy]) {
      for (const alias of [airline.iata, airline.icao]) if (alias) aliases.add(alias.toUpperCase())
    }
  }
  for (const prefix of aliases) {
    if (!raw.startsWith(prefix)) continue
    const number = raw.slice(prefix.length)
    const rows = await db.select({ icao: refAirlines.icao, iata: refAirlines.iata }).from(refAirlines)
      .where(or(eq(sql`upper(${refAirlines.iata})`, prefix), eq(sql`upper(${refAirlines.icao})`, prefix)))
    const legacyRows = await db.select({ icao: airlines.icao, iata: airlines.iata }).from(airlines)
      .where(or(eq(sql`upper(${airlines.iata})`, prefix), eq(sql`upper(${airlines.icao})`, prefix)))
    for (const airline of [...rows, ...legacyRows]) {
      for (const alias of [airline.iata, airline.icao]) {
        if (alias) candidates.add(compactCode(`${alias}${number}`))
      }
    }
  }
  return [...candidates]
}

async function queryParquetCriteria(duckdb: unknown, filePath: string, criteria: HistoricalSearchCriteria, startDate: string, endDate: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    type DuckDb = { connect(): DuckCon; close(cb: (err: Error | null) => void): void }
    type DuckCon = { all: (sql: string, ...args: unknown[]) => void }
    const connection = new (duckdb as { Database: new (path: string) => DuckDb }).Database(':memory:')
    const con = connection.connect()
    const where = [
      'TRY_CAST("Track_Origin_DateTime_UTC" AS TIMESTAMP) >= CAST(? AS TIMESTAMP)',
      'TRY_CAST("Track_Origin_DateTime_UTC" AS TIMESTAMP) < CAST(? AS TIMESTAMP)',
    ]
    const params: unknown[] = [filePath, `${startDate} 00:00:00`, `${endDate} 00:00:00`]
    const addCodes = (column: string, values: string[] | undefined) => {
      const normalized = [...new Set((values ?? []).map(compactCode).filter(Boolean))]
      if (!normalized.length) return
      where.push(`regexp_replace(upper(trim("${column}")), '[^A-Z0-9]', '', 'g') IN (${normalized.map(() => '?').join(',')})`)
      params.push(...normalized)
    }
    addCodes('Callsign', criteria.callsigns)
    addCodes('Airline', criteria.airlineCodes)
    addCodes('Reg', criteria.registration ? [criteria.registration] : undefined)
    const addAirportFilter = (primary: string, values: string[] | undefined) => {
      const codes = [...new Set((values ?? []).map(compactCode).filter(Boolean))]
      if (!codes.length) return
      const alternatives = codes.flatMap(() => [
        `contains(upper(coalesce("${primary}", '')), ?)` ,
        `contains(upper(coalesce("Route_Validation_Based_on_Callsign", '')), ?)` ,
      ])
      where.push(`(${alternatives.join(' OR ')})`)
      for (const code of codes) params.push(code, code)
    }
    addAirportFilter('Track_Origin_ApplicableAirports', criteria.departureCodes)
    addAirportFilter('Track_Destination_ApplicableAirports', criteria.arrivalCodes)
    const sqlText = `SELECT * FROM read_parquet(?) WHERE ${where.join(' AND ')} LIMIT 2000`
    con.all(sqlText, ...params, (error: Error | null, rows: Array<Record<string, unknown>>) => {
      connection.close((closeError) => { if (closeError) console.error('duckdb close error', closeError) })
      if (error) reject(error)
      else resolve(rows ?? [])
    })
  })
}

function extractAirport(value: string): string | null {
  const m = value.match(/[A-Z]{3,4}/)
  return m ? m[0] : null
}

function cleanValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (s === '' || s === '-' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null') return null
  return s
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
