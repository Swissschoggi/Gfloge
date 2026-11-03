// Historical lookup: DuckDB over installed Parquet files. No separate server;
// embedded DuckDB only. Returns candidates, never auto-selects one.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { eq } from 'drizzle-orm'
import { historicalDatasets, airlines, airports } from '@gfloge/db'
import type { Db } from '@gfloge/db'

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

async function iataToIcao(db: Db, iata: string): Promise<string[]> {
  const { refAirlines } = await import('@gfloge/db')
  const rows = await db.select({ icao: refAirlines.icao, iata: refAirlines.iata }).from(refAirlines)
  const matches = rows.filter((r) => r.iata?.toUpperCase() === iata.toUpperCase())
  const icaos = matches.map((r) => (r.icao ?? '').trim()).filter(Boolean)
  if (icaos.length) return icaos
  const legacy = await db.select({ icao: airlines.icao, iata: airlines.iata }).from(airlines)
  const m2 = legacy.filter((r) => r.iata?.toUpperCase() === iata.toUpperCase())
  const icaos2 = m2.map((r) => (r.icao ?? '').trim()).filter(Boolean)
  return icaos2.length ? icaos2 : [iata.trim().toUpperCase()]
}

export async function searchHistorical(
  db: Db,
  flightNumber: string,
  date: string
): Promise<{ duckdbAvailable: boolean; candidates: HistoricalCandidate[]; note: string }> {
  if (!duckdbAvailable()) {
    return { duckdbAvailable: false, candidates: [], note: 'DuckDB binding is not installed on this host, so installed Parquet datasets cannot be queried. Download and install remains available; querying requires the native binding.' }
  }
  // Dynamic require is intentional here: duckdb is an optional native binding.
  const duckdb = requireDuckdb('duckdb')
  const datasets = await installedDatasets(db, date)
  if (datasets.length === 0) {
    return { duckdbAvailable: true, candidates: [], note: 'No installed historical dataset covers this date. Install one in Settings, Historical data.' }
  }
  // Translate "LH 371" / "LH371" into possible callsigns using airline reference data.
  const raw = flightNumber.trim().toUpperCase().replace(/\s+/g, '')
  const m = raw.match(/^([A-Z]+)(\d+)$/)
  const carrier = m ? m[1] : raw
  const number = m ? m[2] : raw.replace(/^[A-Z]+/, '')
  // Wider UTC window to handle operating vs UTC date differences.
  const center = new Date(`${date}T00:00:00Z`)
  const windowStart = new Date(center.getTime() - 24 * 60 * 60_000).toISOString().slice(0, 10)
  const windowEnd = new Date(center.getTime() + 24 * 60 * 60_000).toISOString().slice(0, 10)

  const icaos = await iataToIcao(db, carrier)
  const callsignSet = new Set<string>()
  for (const icao of icaos) {
    callsignSet.add(`${icao}${number}`.replace(/\s+/g, ''))
    callsignSet.add(`${icao}${number.padStart(3, '0')}`.replace(/\s+/g, ''))
    callsignSet.add(`${icao}${number.padStart(4, '0')}`.replace(/\s+/g, ''))
  }
  callsignSet.add(`${carrier}${number}`.replace(/\s+/g, ''))
  callsignSet.add(`${carrier}${number.padStart(3, '0')}`.replace(/\s+/g, ''))
  callsignSet.add(`${carrier}${number.padStart(4, '0')}`.replace(/\s+/g, ''))
  const callsigns = Array.from(callsignSet)

  const candidates: HistoricalCandidate[] = []
  for (const dataset of datasets) {
    if (!existsSync(dataset.localPath)) continue
    const rows = await queryParquet(duckdb, dataset.localPath, callsigns, windowStart, windowEnd)
    for (const row of rows) {
      const routeParts = String(row.Route_Validation_Based_on_Callsign ?? '').split(/[-/]/)
      const depIcao = extractAirport(String(row.Track_Origin_ApplicableAirports ?? '')) ?? extractAirport(routeParts[0] ?? '')
      const arrIcao = extractAirport(String(row.Track_Destination_ApplicableAirports ?? '')) ?? extractAirport(routeParts[1] ?? '')
      const { refAirports } = await import('@gfloge/db')
      const depAirport = depIcao ? ((await db.select().from(refAirports).where(eq(refAirports.icao, depIcao)).limit(1))[0] ?? (await db.select().from(airports).where(eq(airports.icao, depIcao)).limit(1))[0] ?? null) : null
      const arrAirport = arrIcao ? ((await db.select().from(refAirports).where(eq(refAirports.icao, arrIcao)).limit(1))[0] ?? (await db.select().from(airports).where(eq(airports.icao, arrIcao)).limit(1))[0] ?? null) : null
      candidates.push({
        datasetKey: dataset.datasetKey,
        source: dataset.source,
        callsign: cleanValue(row.Callsign) ?? '',
        airlineIcao: cleanValue(row.Airline),
        registration: cleanValue(row.Reg),
        aircraftType: cleanValue(row.AC_Type),
        aircraftTypeDetail: cleanValue(row.AC_Type_Detailed),
        departureAirport: depIcao,
        arrivalAirport: arrIcao,
        departureIata: depAirport?.iata ?? null,
        arrivalIata: arrAirport?.iata ?? null,
        departureAirportName: depAirport?.name ?? null,
        arrivalAirportName: arrAirport?.name ?? null,
        trackOriginLat: toNumber(row.Track_Origin_Lat),
        trackOriginLon: toNumber(row.Track_Origin_Lon),
        trackDestinationLat: toNumber(row.Track_Destination_Lat),
        trackDestinationLon: toNumber(row.Track_Destination_Lon),
        departureTimeUtc: cleanValue(row.Track_Origin_DateTime_UTC),
        arrivalTimeUtc: cleanValue(row.Track_Destination_DateTime_UTC),
        routeValidation: cleanValue(row.Route_Validation_Based_on_Callsign),
      })
    }
  }
  return {
    duckdbAvailable: true,
    candidates,
    note:
      candidates.length === 0
        ? 'No matching historical flight found for that number and date.'
        : `${candidates.length} candidate${candidates.length === 1 ? '' : 's'} found. Multiple candidates may indicate codeshare or duplicate records; review before saving.`,
  }
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

function queryParquet(duckdb: unknown, filePath: string, callsigns: string[], startDate: string, endDate: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    type DuckDb = { connect(): DuckCon; close(cb: (err: Error | null) => void): void }
    type DuckCon = { all: (sql: string, ...args: unknown[]) => void }
    const db = new (duckdb as { Database: new (path: string) => DuckDb }).Database(':memory:')
    const con = db.connect()
    const placeholders = callsigns.map(() => '?').join(',')
    const sqlText = `SELECT * FROM read_parquet(?) WHERE trim("Callsign") IN (${placeholders}) AND Track_Origin_DateTime_UTC <> '-' AND CAST("Track_Origin_DateTime_UTC" AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE) LIMIT 50`
    const params = [filePath, ...callsigns, startDate, endDate]
    con.all(sqlText, ...params, (err: Error | null, rows: Array<Record<string, unknown>>) => {
      db.close((closeErr: Error | null) => {
        if (closeErr) console.error('duckdb close error', closeErr)
      })
      if (err) reject(err)
      else resolve(rows ?? [])
    })
  })
}
