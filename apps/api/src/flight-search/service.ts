import { createHash } from 'node:crypto'
import { and, gte, inArray, lt, or, sql } from 'drizzle-orm'
import { flights } from '@gfloge/db'
import type { Db } from '@gfloge/db'
import {
  localToUtc,
  toLocalIso,
} from '@gfloge/shared'
import type {
  AirlineSearchResult,
  AirportSearchResult,
  FlightRead,
  FlightSearchCandidate,
  FlightSearchInput,
  FlightSearchResponse,
  FlightSearchSource,
} from '@gfloge/shared'
import { flightsById } from '../flights-read.js'
import { searchHistoricalCriteria } from '../historical/query.js'
import type { ProviderRegistry } from '../providers/registry.js'
import { parseAirLabsInstant, searchAirLabsSchedules } from '../providers/airlabs-schedule.js'
import { searchTravelRiskFlights } from '../providers/travelrisk.js'
import { airlinesByCodes, airportsByCodes, searchAirlines, searchAirports } from '../reference/search.js'
import { signFlightCandidate } from './candidate-token.js'

type ProviderRefs = Record<string, unknown>

const DEMO_SOURCE = {
  id: 'demo',
  name: 'Gfloge demo data',
  attribution: 'Gfloge demo dataset (sample data; not real operational schedules)',
  license: 'Gfloge demo data',
}
const HISTORICAL_ATTRIBUTION = 'MrAirspace / adsblol initiative · ODbL'

export function compactFlightCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, '')
}

export function flightCodeVariants(code: string, airlines: Array<Pick<AirlineSearchResult, 'iata' | 'icao'>>): string[] {
  const compact = compactFlightCode(code)
  if (!compact) return []
  const variants = new Set<string>([compact])
  for (const airline of airlines) {
    const aliases = [airline.iata, airline.icao].filter((value): value is string => !!value).map((value) => value.toUpperCase())
    for (const prefix of aliases) {
      if (compact.startsWith(prefix) && compact.length > prefix.length) {
        const number = compact.slice(prefix.length)
        for (const alias of aliases) {
          variants.add(`${alias}${number}`)
          if (/^\d+$/.test(number)) {
            variants.add(`${alias}${number.padStart(3, '0')}`)
            variants.add(`${alias}${number.padStart(4, '0')}`)
          }
        }
      } else if (/^\d+[A-Z]?$/.test(compact)) {
        for (const alias of aliases) variants.add(`${alias}${compact}`)
      }
    }
  }
  return [...variants]
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}

function dateWindow(date: string, timezones: string[]): { start: Date; end: Date } {
  if (!timezones.length) {
    const midnight = new Date(`${date}T00:00:00.000Z`)
    return { start: new Date(midnight.getTime() - 14 * 60 * 60_000), end: new Date(midnight.getTime() + 38 * 60 * 60_000) }
  }
  const starts = timezones.map((timezone) => localToUtc(`${date}T00:00`, timezone).getTime())
  const ends = timezones.map((timezone) => localToUtc(`${nextDate(date)}T00:00`, timezone).getTime())
  return { start: new Date(Math.min(...starts)), end: new Date(Math.max(...ends)) }
}

function airportCodeMatches(airport: AirportSearchResult | null, term: string): boolean {
  if (!airport) return false
  const normalized = term.trim().toUpperCase()
  return [airport.iata, airport.icao].some((code) => code?.toUpperCase() === normalized)
}

function minuteOfDay(instant: Date, timezone: string): number {
  const local = toLocalIso(instant, timezone).slice(11, 16)
  const [hour, minute] = local.split(':').map(Number)
  return hour! * 60 + minute!
}

function isDateAndTimeMatch(
  departure: Date,
  airport: AirportSearchResult | null,
  input: FlightSearchInput
): boolean {
  const timezone = airport?.tz ?? 'UTC'
  if (toLocalIso(departure, timezone).slice(0, 10) !== input.date) return false
  if (!input.departureTime) return true
  const [hour, minute] = input.departureTime.split(':').map(Number)
  const difference = Math.abs(minuteOfDay(departure, timezone) - (hour! * 60 + minute!))
  return Math.min(difference, 1440 - difference) <= input.timeWindowMinutes
}

function missingFields(candidate: Pick<FlightSearchCandidate, 'flightCode' | 'airlineCode' | 'departureCode' | 'arrivalCode' | 'airline' | 'departure' | 'arrival' | 'departureTimeUtc' | 'arrivalTimeUtc' | 'aircraftRegistration' | 'aircraftType'>): FlightSearchCandidate['missingFields'] {
  const missing: FlightSearchCandidate['missingFields'] = []
  if (!candidate.flightCode) missing.push('flightNumber')
  if (!candidate.airline && !candidate.airlineCode) missing.push('airline')
  if (!candidate.departureCode && !candidate.departure?.iata && !candidate.departure?.icao) missing.push('departure')
  if (!candidate.arrivalCode && !candidate.arrival?.iata && !candidate.arrival?.icao) missing.push('arrival')
  if (!candidate.departure?.tz) missing.push('departureTimezone')
  if (!candidate.departureTimeUtc) missing.push('departureTime')
  if (!candidate.arrivalTimeUtc) missing.push('arrivalTime')
  if (!candidate.aircraftRegistration) missing.push('aircraftRegistration')
  if (!candidate.aircraftType) missing.push('aircraftType')
  return missing
}

function missingCoreFields(fields: FlightSearchCandidate['missingFields']): boolean {
  return fields.some((field) => ['flightNumber', 'departure', 'arrival', 'departureTimezone', 'departureTime', 'arrivalTime'].includes(field))
}

function scheduleStatus(value: string | null | undefined): FlightRead['status'] {
  switch (value?.toLowerCase()) {
    case 'scheduled': return 'scheduled'
    case 'boarding': return 'boarding'
    case 'active':
    case 'en-route':
    case 'enroute': return 'enroute'
    case 'landed':
    case 'arrived': return 'arrived'
    case 'cancelled':
    case 'canceled': return 'cancelled'
    case 'diverted': return 'diverted'
    default: return 'unknown'
  }
}

function sourceReference(id: string, name: string, attribution: string, license: string | null = null) {
  return { id, name, attribution, license }
}

function mergeKey(candidate: FlightSearchCandidate): string {
  const route = `${candidate.departureCode ?? candidate.departure?.icao ?? candidate.departure?.iata ?? ''}:${candidate.arrivalCode ?? candidate.arrival?.icao ?? candidate.arrival?.iata ?? ''}`
  const time = candidate.departureTimeUtc?.slice(0, 16) ?? ''
  const code = compactFlightCode(candidate.flightCode ?? '')
  const group = candidate.kind === 'demo' ? 'demo' : 'flight'
  return `${group}|${code}|${route}|${time}|${candidate.aircraftRegistration ?? ''}`
}

function combineCandidate(existing: FlightSearchCandidate, incoming: FlightSearchCandidate): FlightSearchCandidate {
  const rank = { incomplete: 0, demo_sample: 1, historical_observation: 2, verified_schedule: 3 } as const
  const primary = rank[incoming.evidence] > rank[existing.evidence] ? incoming : existing
  const secondary = primary === incoming ? existing : incoming
  const allSources = [primary.source, ...primary.additionalSources, secondary.source, ...secondary.additionalSources]
  const sources = [...new Map(allSources.map((source) => [source.id, source])).values()]
  const additionalSources = sources.filter((source) => source.id !== primary.source.id)
  const merged = { ...secondary, ...primary, additionalSources }
  merged.flightCode = primary.flightCode ?? secondary.flightCode
  merged.airlineCode = primary.airlineCode ?? secondary.airlineCode
  merged.departureCode = primary.departureCode ?? secondary.departureCode
  merged.arrivalCode = primary.arrivalCode ?? secondary.arrivalCode
  merged.airline = primary.airline ?? secondary.airline
  merged.departure = primary.departure ?? secondary.departure
  merged.arrival = primary.arrival ?? secondary.arrival
  merged.departureTimeUtc = primary.departureTimeUtc ?? secondary.departureTimeUtc
  merged.arrivalTimeUtc = primary.arrivalTimeUtc ?? secondary.arrivalTimeUtc
  merged.aircraftRegistration = primary.aircraftRegistration ?? secondary.aircraftRegistration
  merged.aircraftType = primary.aircraftType ?? secondary.aircraftType
  merged.missingFields = missingFields(merged)
  return merged
}

function utcFlightTime(value: string | null | undefined): Date | null {
  if (!value) return null
  const normalized = value.trim().replace(' ', 'T')
  const parsed = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function withinUtcDateEnvelope(instant: Date, date: string): boolean {
  const midnight = new Date(`${date}T00:00:00.000Z`).getTime()
  return instant.getTime() >= midnight - 14 * 60 * 60_000 && instant.getTime() < midnight + 38 * 60 * 60_000
}

function readProviderRefs(value: unknown): ProviderRefs {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ProviderRefs : {}
}

export async function searchFlights(
  db: Db,
  providers: ProviderRegistry,
  input: FlightSearchInput,
  userId: string,
  secret: string,
  now = new Date()
): Promise<FlightSearchResponse> {
  const [departureOptions, arrivalOptions, airlineOptions] = await Promise.all([
    input.departure ? searchAirports(db, input.departure, 30) : Promise.resolve([]),
    input.arrival ? searchAirports(db, input.arrival, 30) : Promise.resolve([]),
    input.airline ? searchAirlines(db, input.airline, 40) : Promise.resolve([]),
  ])
  const codePrefixes = input.code ? [input.code.slice(0, 2), input.code.slice(0, 3)] : []
  const inferredAirlines = input.code
    ? (await Promise.all(codePrefixes.map((prefix) => searchAirlines(db, prefix, 20)))).flat()
    : []
  const airlineMap = new Map<string, AirlineSearchResult>()
  for (const airline of [...airlineOptions, ...inferredAirlines]) airlineMap.set(airline.id, airline)
  const knownAirlines = [...airlineMap.values()]
  const codeVariants = input.code ? flightCodeVariants(input.code, knownAirlines) : []
  const sources: FlightSearchSource[] = []
  const candidates: FlightSearchCandidate[] = []
  const depTimezones = departureOptions.map((airport) => airport.tz).filter((timezone): timezone is string => !!timezone)
  const bounds = dateWindow(input.date, depTimezones)

  // Search canonical instance records first. Demo records are visible only in
  // demo mode and keep an explicit sample-data label; they never satisfy a real
  // provider search silently.
  const where = [gte(flights.scheduledDeparture, bounds.start), lt(flights.scheduledDeparture, bounds.end)]
  const legacyDepIds = departureOptions.filter((airport) => airport.source.startsWith('legacy:')).map((airport) => airport.id)
  const legacyArrIds = arrivalOptions.filter((airport) => airport.source.startsWith('legacy:')).map((airport) => airport.id)
  if (legacyDepIds.length) where.push(inArray(flights.departureAirportId, legacyDepIds))
  if (legacyArrIds.length) where.push(inArray(flights.arrivalAirportId, legacyArrIds))
  const legacyAirlineIds = knownAirlines.filter((airline) => airline.source.startsWith('legacy:')).map((airline) => airline.id)
  if (legacyAirlineIds.length) where.push(inArray(flights.airlineId, legacyAirlineIds))
  if (codeVariants.length) {
    where.push(or(...codeVariants.map((code) => sql`upper(regexp_replace(${flights.flightCode}, '[^A-Za-z0-9]', '', 'g')) = ${code}`))!)
  }
  if (input.registration) where.push(sql`upper(regexp_replace(coalesce(${flights.aircraftRegistration}, ''), '[^A-Za-z0-9]', '', 'g')) = ${compactFlightCode(input.registration)}`)
  const localRows = await db.select({ id: flights.id, providerRefs: flights.providerRefs }).from(flights).where(and(...where)).limit(800)
  const localFlights = await flightsById(db, localRows.map((row) => row.id))
  let demoCount = 0
  let instanceCount = 0
  for (const row of localRows) {
    const flight = localFlights.get(row.id)
    if (!flight) continue
    const refs = readProviderRefs(row.providerRefs)
    const isDemo = Object.hasOwn(refs, 'demo') || flight.isDemo
    if (isDemo && !providers.isDemoEnabled()) continue
    const departure = { ...flight.departure, source: 'instance', creatable: true }
    const arrival = { ...flight.arrival, source: 'instance', creatable: true }
    if (!isDateAndTimeMatch(new Date(flight.scheduledDeparture), departure, input)) continue
    if (departureOptions.length && !departureOptions.some((airport) => airportCodeMatches(departure, airport.iata ?? airport.icao ?? '') || airport.id === flight.departure.id)) continue
    if (arrivalOptions.length && !arrivalOptions.some((airport) => airportCodeMatches(arrival, airport.iata ?? airport.icao ?? '') || airport.id === flight.arrival.id)) continue
    const airline = flight.airline ? { ...flight.airline, callsign: null, source: 'instance' } : null
    const candidateSource = isDemo
      ? sourceReference('demo', 'Gfloge demo data', DEMO_SOURCE.attribution, 'Sample data')
      : sourceReference(flight.providerId ?? 'instance', flight.providerId ?? 'Stored instance flight', `Source recorded with this instance flight: ${flight.providerId ?? 'unknown'}`)
    const candidateBase = {
      id: flight.id,
      token: null,
      flightId: flight.id,
      kind: isDemo ? 'demo' as const : 'schedule' as const,
      evidence: isDemo ? 'demo_sample' as const : flight.providerId ? 'verified_schedule' as const : 'incomplete' as const,
      flightCode: flight.flightCode || null,
      airlineCode: flight.airline?.iata ?? flight.airline?.icao ?? null,
      departureCode: flight.departure.iata ?? flight.departure.icao,
      arrivalCode: flight.arrival.iata ?? flight.arrival.icao,
      airline,
      departure,
      arrival,
      departureTimeUtc: flight.scheduledDeparture,
      arrivalTimeUtc: flight.scheduledArrival,
      aircraftRegistration: flight.aircraft?.registration ?? null,
      aircraftType: flight.aircraft?.icaoType ?? null,
      status: flight.status,
      depTerminal: flight.depTerminal,
      depGate: flight.depGate,
      arrTerminal: flight.arrTerminal,
      arrGate: flight.arrGate,
      arrBaggage: flight.arrBaggage,
      source: candidateSource,
      additionalSources: [],
    }
    const candidate: FlightSearchCandidate = { ...candidateBase, missingFields: missingFields(candidateBase) }
    candidates.push(candidate)
    if (isDemo) demoCount++
    else instanceCount++
  }
  sources.push({
    id: 'instance-records',
    name: 'Stored flight records',
    kind: 'schedule',
    status: instanceCount ? 'searched' : 'no_results',
    message: instanceCount ? `${instanceCount} stored flight record${instanceCount === 1 ? '' : 's'} matched.` : 'No matching provider schedule is stored in this instance.',
    attribution: 'Source attribution is shown on each result.',
  })
  if (providers.isDemoEnabled()) {
    sources.push({ id: 'demo', name: DEMO_SOURCE.name, kind: 'demo', status: demoCount ? 'searched' : 'no_results', message: demoCount ? 'Sample matches from the explicitly enabled demo dataset. These are not real flights.' : 'The demo dataset was searched; it contains no sample matching this query.', attribution: DEMO_SOURCE.attribution })
  }

  const scheduleProviders = await providers.configuredScheduleProviders()
  if (!scheduleProviders.length) {
    sources.push({ id: 'schedule', name: 'Schedule providers', kind: 'schedule', status: 'not_configured', message: 'No schedule provider is configured. This search cannot confirm whether a flight operates.', attribution: 'No provider was queried.' })
  }
  for (const provider of scheduleProviders) {
    if (provider.state !== 'ready') {
      sources.push({
        id: provider.id,
        name: provider.name,
        kind: 'schedule',
        status: provider.state === 'unconfigured' ? 'not_configured' : 'unavailable',
        message: provider.message,
        attribution: provider.attribution,
      })
      continue
    }
    if (provider.id === 'travelrisk') {
      const credential = await providers.credentials(provider.id)
      const result = await searchTravelRiskFlights({
        code: input.code || undefined,
        departure: departureOptions[0]?.iata ?? departureOptions[0]?.icao ?? undefined,
        arrival: arrivalOptions[0]?.iata ?? arrivalOptions[0]?.icao ?? undefined,
        airline: airlineOptions[0]?.iata ?? airlineOptions[0]?.icao ?? undefined,
      }, credential?.apiKey ?? credential?.secret ?? null)
      if (result.state !== 'searched') {
        sources.push({ id: provider.id, name: provider.name, kind: 'schedule', status: result.state === 'unconfigured' ? 'not_configured' : result.state === 'rate_limited' ? 'rate_limited' : 'error', message: result.message, attribution: provider.attribution })
        continue
      }
      const codes = result.results.flatMap((row) => [row.dep_iata, row.dep_icao, row.arr_iata, row.arr_icao, row.airline_iata, row.airline_icao].filter((code): code is string => !!code))
      const [airportIndex, airlineIndex] = await Promise.all([airportsByCodes(db, codes), airlinesByCodes(db, codes)])
      let matchCount = 0
      for (const row of result.results) {
        const depCode = row.dep_iata?.toUpperCase() ?? row.dep_icao?.toUpperCase() ?? ''
        const arrCode = row.arr_iata?.toUpperCase() ?? row.arr_icao?.toUpperCase() ?? ''
        const airlineCode = row.airline_iata?.toUpperCase() ?? row.airline_icao?.toUpperCase() ?? ''
        const departure = airportIndex.get(depCode) ?? null
        const arrival = airportIndex.get(arrCode) ?? null
        const airline = airlineIndex.get(airlineCode) ?? null
        if (departureOptions.length && !departureOptions.some((option) => option.iata === departure?.iata || option.icao === departure?.icao)) continue
        if (arrivalOptions.length && !arrivalOptions.some((option) => option.iata === arrival?.iata || option.icao === arrival?.icao)) continue
        if (airlineOptions.length && !airlineOptions.some((option) => option.iata === airline?.iata || option.icao === airline?.icao)) continue
        const flightCode = row.flight_number ?? null
        if (input.code && !codeVariants.includes(compactFlightCode(flightCode ?? ''))) continue
        const depTime = row.dep_time_utc ? new Date(row.dep_time_utc) : null
        const arrTime = row.arr_time_utc ? new Date(row.arr_time_utc) : null
        if (!depTime || !isDateAndTimeMatch(depTime, departure, input)) continue
        const base = {
          id: `travelrisk:${candidateDigest([flightCode ?? '', depCode, arrCode, depTime?.toISOString() ?? ''].join('|'))}`,
          token: null,
          flightId: null,
          kind: 'schedule' as const,
          evidence: 'verified_schedule' as const,
          flightCode,
          airlineCode: row.airline_iata ?? row.airline_icao ?? null,
          departureCode: row.dep_iata ?? row.dep_icao ?? null,
          arrivalCode: row.arr_iata ?? row.arr_icao ?? null,
          airline,
          departure,
          arrival,
          departureTimeUtc: depTime?.toISOString() ?? null,
          arrivalTimeUtc: arrTime?.toISOString() ?? null,
          aircraftRegistration: row.reg_number ?? null,
          aircraftType: row.aircraft_icao ?? null,
          status: scheduleStatus(row.status),
          depTerminal: null,
          depGate: null,
          arrTerminal: null,
          arrGate: null,
          arrBaggage: null,
          seatType: null,
          bookingReference: null,
          flightReason: null,
          sourceType: 'scheduled',
          sourceName: 'travelrisk',
          sourceMetadata: null,
          source: sourceReference('travelrisk', 'Travel Risk API', 'Travel Risk API aviation data', null),
          additionalSources: [],
        }
        const missing = missingFields(base)
        candidates.push({ ...base, evidence: missingCoreFields(missing) ? 'incomplete' : 'verified_schedule', missingFields: missing })
        matchCount++
      }
      sources.push({ id: provider.id, name: provider.name, kind: 'schedule', status: matchCount ? 'searched' : 'no_results', message: matchCount ? `${matchCount} schedule candidate${matchCount === 1 ? '' : 's'} from Travel Risk API.` : 'Travel Risk API was queried successfully but returned no matching schedules.', attribution: provider.attribution })
      continue
    }
    if (provider.id !== 'airlabs') {
      sources.push({ id: provider.id, name: provider.name, kind: 'schedule', status: 'unavailable', message: `${provider.name} has no schedule adapter available in this version.`, attribution: provider.attribution })
      continue
    }

    const selectedDeparture = singleResolvedAirport(input.departure, departureOptions)
    const selectedArrival = singleResolvedAirport(input.arrival, arrivalOptions)
    const selectedAirline = singleResolvedAirline(input.airline, airlineOptions)
    let credential: Record<string, string> | null
    try {
      credential = await providers.credentials(provider.id)
    } catch {
      sources.push({ id: provider.id, name: provider.name, kind: 'schedule', status: 'error', message: 'AirLabs credentials could not be read. Replace the provider key in Settings.', attribution: provider.attribution })
      continue
    }
    const result = await searchAirLabsSchedules({
      search: input,
      departure: selectedDeparture,
      arrival: selectedArrival,
      airline: selectedAirline,
    }, credential?.apiKey ?? credential?.secret ?? null)
    if (result.state !== 'searched') {
      sources.push({
        id: provider.id,
        name: provider.name,
        kind: 'schedule',
        status: result.state === 'unconfigured' ? 'not_configured' : result.state === 'outside_window' ? 'outside_window' : result.state === 'unsupported' ? 'unsupported' : 'error',
        message: result.message,
        attribution: provider.attribution,
      })
      continue
    }
    const codes = result.results.flatMap((row) => [row.dep_iata, row.dep_icao, row.arr_iata, row.arr_icao, row.airline_iata, row.airline_icao].filter((code): code is string => !!code))
    const [airportIndex, airlineIndex] = await Promise.all([airportsByCodes(db, codes), airlinesByCodes(db, codes)])
    let providerMatches = 0
    for (const row of result.results) {
      const depCode = row.dep_iata?.toUpperCase() ?? row.dep_icao?.toUpperCase() ?? ''
      const arrCode = row.arr_iata?.toUpperCase() ?? row.arr_icao?.toUpperCase() ?? ''
      const airlineCode = row.airline_iata?.toUpperCase() ?? row.airline_icao?.toUpperCase() ?? ''
      const departure = airportIndex.get(depCode) ?? (row.dep_icao ? airportIndex.get(row.dep_icao.toUpperCase()) : undefined) ?? null
      const arrival = airportIndex.get(arrCode) ?? (row.arr_icao ? airportIndex.get(row.arr_icao.toUpperCase()) : undefined) ?? null
      const airline = airlineIndex.get(airlineCode) ?? (row.airline_icao ? airlineIndex.get(row.airline_icao.toUpperCase()) : undefined) ?? null
      if (departureOptions.length && !departureOptions.some((option) => option.iata === row.dep_iata || option.icao === row.dep_icao)) continue
      if (arrivalOptions.length && !arrivalOptions.some((option) => option.iata === row.arr_iata || option.icao === row.arr_icao)) continue
      if (airlineOptions.length && !airlineOptions.some((option) => option.iata === row.airline_iata || option.icao === row.airline_icao)) continue
      const flightCode = row.flight_iata ?? row.flight_icao ?? null
      if (input.code && !codeVariants.includes(compactFlightCode(flightCode ?? ''))) continue
      const depTime = parseAirLabsInstant(row.dep_time_utc, row.dep_time_ts, row.dep_time, departure?.tz ?? 'UTC')
      const arrTime = parseAirLabsInstant(row.arr_time_utc, row.arr_time_ts, row.arr_time, arrival?.tz ?? 'UTC')
      if (!depTime) continue
      if (departure?.tz) {
        if (!isDateAndTimeMatch(depTime, departure, input)) continue
      } else if (!withinUtcDateEnvelope(depTime, input.date)) {
        continue
      }
      const registration = row.reg_number ?? row.registration ?? null
      if (input.registration && compactFlightCode(registration ?? '') !== compactFlightCode(input.registration)) continue
      const base = {
        id: `airlabs:${candidateDigest([flightCode ?? '', depCode, arrCode, depTime?.toISOString() ?? ''].join('|'))}`,
        token: null,
        flightId: null,
        kind: 'schedule' as const,
        evidence: 'verified_schedule' as const,
        flightCode,
        airlineCode: row.airline_iata ?? row.airline_icao ?? null,
        departureCode: row.dep_iata ?? row.dep_icao ?? null,
        arrivalCode: row.arr_iata ?? row.arr_icao ?? null,
        airline,
        departure,
        arrival,
        departureTimeUtc: depTime?.toISOString() ?? null,
        arrivalTimeUtc: arrTime?.toISOString() ?? null,
        aircraftRegistration: registration,
        aircraftType: row.aircraft_icao ?? null,
        status: scheduleStatus(row.status),
        depTerminal: row.dep_terminal ?? null,
        depGate: row.dep_gate ?? null,
        arrTerminal: row.arr_terminal ?? null,
        arrGate: row.arr_gate ?? null,
        arrBaggage: row.arr_baggage ?? null,
        source: sourceReference('airlabs', 'AirLabs schedules', 'AirLabs flight schedule data · BYO API key', null),
        additionalSources: [],
      }
      const missing = missingFields(base)
       candidates.push({ ...base, evidence: missingCoreFields(missing) ? 'incomplete' : 'verified_schedule', missingFields: missing })
      providerMatches++
    }
    sources.push({
      id: provider.id,
      name: provider.name,
      kind: 'schedule',
      status: providerMatches ? 'searched' : 'no_results',
      message: providerMatches ? `${providerMatches} live schedule candidate${providerMatches === 1 ? '' : 's'} matched. AirLabs coverage is best-effort and limited to about ten hours ahead.` : 'AirLabs was queried successfully but returned no matching schedules. This does not prove the flight does not exist.',
      attribution: provider.attribution,
    })
  }

  if (input.date <= now.toISOString().slice(0, 10)) {
    try {
      const historical = await searchHistoricalCriteria(db, {
        date: input.date,
        callsigns: codeVariants,
        airlineCodes: knownAirlines.flatMap((airline) => [airline.iata, airline.icao].filter((code): code is string => !!code)),
        departureCodes: departureOptions.flatMap((airport) => [airport.iata, airport.icao].filter((code): code is string => !!code)),
        arrivalCodes: arrivalOptions.flatMap((airport) => [airport.iata, airport.icao].filter((code): code is string => !!code)),
        registration: input.registration || undefined,
        departureTime: input.departureTime,
        timeWindowMinutes: input.timeWindowMinutes,
      })
      if (!historical.duckdbAvailable || !historical.covered) {
        sources.push({ id: 'historical', name: 'Installed historical data', kind: 'historical', status: 'unavailable', message: historical.note, attribution: 'Historical dataset attribution appears on each result.' })
      } else {
        const codes = historical.candidates.flatMap((candidate) => [candidate.departureAirport, candidate.arrivalAirport, candidate.departureIata, candidate.arrivalIata, candidate.airlineIcao].filter((code): code is string => !!code))
        const [airportIndex, airlineIndex] = await Promise.all([airportsByCodes(db, codes), airlinesByCodes(db, codes)])
        let count = 0
        for (const historic of historical.candidates) {
          const dep = (historic.departureAirport ? airportIndex.get(historic.departureAirport.toUpperCase()) : undefined) ?? (historic.departureIata ? airportIndex.get(historic.departureIata.toUpperCase()) : undefined) ?? null
          const arr = (historic.arrivalAirport ? airportIndex.get(historic.arrivalAirport.toUpperCase()) : undefined) ?? (historic.arrivalIata ? airportIndex.get(historic.arrivalIata.toUpperCase()) : undefined) ?? null
          const airline = historic.airlineIcao ? airlineIndex.get(historic.airlineIcao.toUpperCase()) ?? null : null
          const departureTimeUtc = utcFlightTime(historic.departureTimeUtc)?.toISOString() ?? null
          const arrivalTimeUtc = utcFlightTime(historic.arrivalTimeUtc)?.toISOString() ?? null
          const base = {
            id: `historical:${candidateDigest([historic.callsign, historic.departureAirport ?? '', historic.arrivalAirport ?? '', departureTimeUtc ?? '', historic.registration ?? ''].join('|'))}`,
            token: null,
            flightId: null,
            kind: 'historical' as const,
            evidence: 'historical_observation' as const,
            flightCode: historic.callsign || null,
            airlineCode: historic.airlineIcao,
            departureCode: historic.departureIata ?? historic.departureAirport,
            arrivalCode: historic.arrivalIata ?? historic.arrivalAirport,
            airline,
            departure: dep,
            arrival: arr,
            departureTimeUtc,
            arrivalTimeUtc,
            aircraftRegistration: historic.registration,
            aircraftType: historic.aircraftType,
            status: arrivalTimeUtc ? 'arrived' as const : null,
            depTerminal: null,
            depGate: null,
            arrTerminal: null,
            arrGate: null,
            arrBaggage: null,
            source: sourceReference(historic.source, historic.source, `${historic.source} · ${historic.datasetKeys.join(', ')} · ODbL`, 'ODbL'),
            additionalSources: historic.datasetKeys.slice(1).map((key) => sourceReference(`${historic.source}:${key}`, historic.source, key, 'ODbL')),
          }
          const missing = missingFields(base)
          candidates.push({ ...base, evidence: missingCoreFields(missing) ? 'incomplete' : 'historical_observation', missingFields: missing })
          count++
        }
        sources.push({
          id: 'historical',
          name: 'Installed historical data',
          kind: 'historical',
          status: count ? 'searched' : 'no_results',
          message: historical.note,
          attribution: HISTORICAL_ATTRIBUTION,
        })
      }
    } catch {
      sources.push({ id: 'historical', name: 'Installed historical data', kind: 'historical', status: 'error', message: 'Historical search failed while reading the installed dataset. Your criteria were not changed.', attribution: HISTORICAL_ATTRIBUTION })
    }
  } else {
    sources.push({ id: 'historical', name: 'Installed historical data', kind: 'historical', status: 'not_applicable', message: 'Historical observations are only searched for dates up to today.', attribution: HISTORICAL_ATTRIBUTION })
  }

  const deduped = new Map<string, FlightSearchCandidate>()
  for (const candidate of candidates) {
    const key = candidate.kind === 'demo' ? `demo|${mergeKey(candidate)}` : mergeKey(candidate)
    const existing = deduped.get(key)
    if (existing) deduped.set(key, combineCandidate(existing, candidate))
    else deduped.set(key, candidate)
  }
  const finalCandidates = [...deduped.values()]
    .sort((a, b) => Number(b.evidence === 'verified_schedule') - Number(a.evidence === 'verified_schedule') || (a.departureTimeUtc ?? '').localeCompare(b.departureTimeUtc ?? ''))
    .slice(0, 100)
    .map((candidate) => candidate.flightId ? candidate : { ...candidate, token: signFlightCandidate(secret, userId, candidate) })
  const hasFailure = sources.some((source) => source.status === 'error' || source.status === 'unavailable' || source.status === 'unsupported')
  const hasSearchedSource = sources.some((source) => source.status === 'searched' || source.status === 'no_results')
  const outcome: FlightSearchResponse['outcome'] = finalCandidates.length
    ? hasFailure ? 'partial' : 'matches'
    : !hasSearchedSource ? 'sources_unavailable' : hasFailure ? 'sources_unavailable' : 'no_matches'
  return { query: input, outcome, sources, candidates: finalCandidates }
}

function singleResolvedAirport(term: string, matches: AirportSearchResult[]): { iata: string | null; icao: string | null; tz: string } | null {
  if (!term || !matches.length) return null
  const normalized = term.trim().toUpperCase()
  const exact = matches.filter((airport) => airport.iata?.toUpperCase() === normalized || airport.icao?.toUpperCase() === normalized)
  const selected = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null
  if (!selected) return null
  return { iata: selected.iata, icao: selected.icao, tz: selected.tz ?? 'UTC' }
}

function singleResolvedAirline(term: string, matches: AirlineSearchResult[]): { iata: string | null; icao: string | null } | null {
  if (!term || !matches.length) return null
  const normalized = term.trim().toUpperCase()
  const exact = matches.filter((airline) => airline.iata?.toUpperCase() === normalized || airline.icao?.toUpperCase() === normalized || airline.name.toUpperCase() === normalized)
  const selected = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null
  return selected ? { iata: selected.iata, icao: selected.icao } : null
}

function candidateDigest(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 18)
}
