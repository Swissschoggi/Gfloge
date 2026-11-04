import { and, eq, isNull } from 'drizzle-orm'
import { flights, manualFlights, userFlights } from '@gfloge/db'
import type { Db } from '@gfloge/db'
import { distanceKm, normalizeFlightNumber, utcDateKey } from '@gfloge/shared'
import type { FlightSearchCandidate } from '@gfloge/shared'
import { resolveCanonicalAirline, resolveCanonicalAirport, resolveCanonicalAircraftType } from '../reference/search.js'
import { verifyFlightCandidate } from './candidate-token.js'

export class CandidateResolveError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message)
  }
}

export type ResolvedCandidate = { flightId: string; manualFlightId?: string; userFlightId?: string; kind: 'schedule' | 'historical' }

export async function resolveCandidate(
  db: Db,
  secret: string,
  userId: string,
  token: string
): Promise<ResolvedCandidate> {
  const candidate = verifyFlightCandidate(secret, userId, token)
  if (!candidate) throw new CandidateResolveError(400, 'candidate_expired', 'This result expired. Search again to refresh its source data.')
  const missingRequired = candidate.missingFields.filter((field) => ['flightNumber', 'departure', 'arrival', 'departureTime', 'arrivalTime'].includes(field))
  if (missingRequired.length) {
    throw new CandidateResolveError(409, 'candidate_incomplete', 'This result is missing the route or full departure/arrival times. Complete those details in the manual form instead.')
  }
  if (candidate.kind === 'historical') return saveHistoricalCandidate(db, userId, candidate)
  if (candidate.kind !== 'schedule' || candidate.source.id !== 'airlabs') {
    throw new CandidateResolveError(400, 'candidate_source', 'This result source cannot create a scheduled flight.')
  }
  return saveScheduleCandidate(db, candidate)
}

async function saveScheduleCandidate(db: Db, candidate: Omit<FlightSearchCandidate, 'token'>): Promise<ResolvedCandidate> {
  const departure = await resolveCanonicalAirport(db, candidate.departure?.iata ?? candidate.departure?.icao ?? candidate.departureCode ?? '')
  const arrival = await resolveCanonicalAirport(db, candidate.arrival?.iata ?? candidate.arrival?.icao ?? candidate.arrivalCode ?? '')
  if (!departure || !arrival) throw new CandidateResolveError(409, 'reference_missing', 'One of these airports is not installed as a complete local reference record. Install/update airport reference data or enter the flight manually.')

  const departureTime = parseUtc(candidate.departureTimeUtc)
  const arrivalTime = parseUtc(candidate.arrivalTimeUtc)
  if (!candidate.flightCode || !departureTime || !arrivalTime || arrivalTime <= departureTime) {
    throw new CandidateResolveError(409, 'candidate_incomplete', 'This schedule is missing a valid flight number, departure or arrival time. Complete the flight manually instead.')
  }
  const airlineCode = candidate.airline?.iata ?? candidate.airline?.icao ?? candidate.airlineCode ?? ''
  const airline = airlineCode
    ? await resolveCanonicalAirline(db, airlineCode)
    : null
  const aircraftType = candidate.aircraftType ? await resolveCanonicalAircraftType(db, candidate.aircraftType) : null
  const flightCode = canonicalFlightCode(candidate.flightCode, candidate.airline?.iata, candidate.airline?.icao)
  const depDateKey = utcDateKey(departureTime)
  const identity = and(
    eq(flights.flightCode, flightCode),
    eq(flights.depDateKey, depDateKey),
    eq(flights.departureAirportId, departure.id),
    eq(flights.arrivalAirportId, arrival.id),
    airline ? eq(flights.airlineId, airline.id) : isNull(flights.airlineId)
  )
  const existing = (await db.select().from(flights).where(identity).limit(1))[0]
  const refs = existing?.providerRefs && typeof existing.providerRefs === 'object' ? existing.providerRefs as Record<string, unknown> : {}
  const providerRefs: Record<string, unknown> = { ...refs, airlabs: { attribution: candidate.source.attribution, license: candidate.source.license, retrievedAt: new Date().toISOString() } }
  // A current provider response replaces a conflicting seeded demo fixture of
  // the same identity; it never inherits the demo label.
  delete providerRefs.demo
  let flightId = existing?.id
  if (existing) {
    await db.update(flights).set({
      scheduledDeparture: departureTime,
      scheduledArrival: arrivalTime,
      status: candidate.status && candidate.status !== 'unknown' ? candidate.status : existing.status,
      depTerminal: candidate.depTerminal,
      depGate: candidate.depGate,
      arrTerminal: candidate.arrTerminal,
      arrGate: candidate.arrGate,
      arrBaggage: candidate.arrBaggage,
      aircraftRegistration: candidate.aircraftRegistration,
      aircraftTypeId: aircraftType?.id ?? existing.aircraftTypeId,
      providerRefs,
      fetchedAt: new Date(),
      statusUpdatedAt: new Date(),
    }).where(eq(flights.id, existing.id))
  } else {
    const [inserted] = await db.insert(flights).values({
      flightCode,
      airlineId: airline?.id ?? null,
      departureAirportId: departure.id,
      arrivalAirportId: arrival.id,
      depDateKey,
      scheduledDeparture: departureTime,
      scheduledArrival: arrivalTime,
      status: candidate.status ?? 'scheduled',
      depTerminal: candidate.depTerminal,
      depGate: candidate.depGate,
      arrTerminal: candidate.arrTerminal,
      arrGate: candidate.arrGate,
      arrBaggage: candidate.arrBaggage,
      aircraftRegistration: candidate.aircraftRegistration,
      aircraftTypeId: aircraftType?.id ?? null,
      distanceKm: Math.round(distanceKm(departure, arrival)),
      providerRefs,
      fetchedAt: new Date(),
      statusUpdatedAt: new Date(),
    }).onConflictDoNothing().returning({ id: flights.id })
    flightId = inserted?.id
    if (!flightId) {
      const concurrent = (await db.select({ id: flights.id }).from(flights).where(identity).limit(1))[0]
      if (!concurrent) throw new CandidateResolveError(409, 'duplicate_conflict', 'This flight was added by another request. Search again to select the current record.')
      flightId = concurrent.id
    }
  }
  return { flightId, kind: 'schedule' }
}

async function saveHistoricalCandidate(db: Db, userId: string, candidate: Omit<FlightSearchCandidate, 'token'>): Promise<ResolvedCandidate> {
  const departureTime = parseUtc(candidate.departureTimeUtc)
  const arrivalTime = parseUtc(candidate.arrivalTimeUtc)
  if (!departureTime || !arrivalTime || arrivalTime <= departureTime) {
    throw new CandidateResolveError(409, 'candidate_incomplete', 'This historical observation has no complete pair of timestamps. Enter the missing journey details manually.')
  }
  const departure = await resolveCanonicalAirport(db, candidate.departure?.iata ?? candidate.departure?.icao ?? candidate.departureCode ?? '')
  const arrival = await resolveCanonicalAirport(db, candidate.arrival?.iata ?? candidate.arrival?.icao ?? candidate.arrivalCode ?? '')
  if (!departure || !arrival) throw new CandidateResolveError(409, 'reference_missing', 'The observation references an airport that is not installed. Install/update airport reference data or enter the flight manually.')
  const airlineCode = candidate.airline?.iata ?? candidate.airline?.icao ?? candidate.airlineCode ?? ''
  const airline = airlineCode ? await resolveCanonicalAirline(db, airlineCode) : null
  const aircraftType = candidate.aircraftType ? await resolveCanonicalAircraftType(db, candidate.aircraftType) : null
  const [manual] = await db.insert(manualFlights).values({
    userId,
    airlineId: airline?.id ?? null,
    flightNumber: candidate.flightCode,
    departureAirportId: departure.id,
    arrivalAirportId: arrival.id,
    scheduledDeparture: departureTime,
    scheduledArrival: arrivalTime,
    depDateKey: utcDateKey(departureTime),
    aircraftTypeId: aircraftType?.id ?? null,
    distanceKm: Math.round(distanceKm(departure, arrival)),
  }).returning({ id: manualFlights.id })
  const sourceNote = `Historical observation from ${candidate.source.name}. ${candidate.source.attribution}`
  const [relation] = await db.insert(userFlights).values({
    userId,
    manualFlightId: manual!.id,
    role: 'logged',
    loggedState: 'flown',
    source: 'import',
    note: sourceNote,
  }).returning({ id: userFlights.id })
  return { flightId: `manual:${manual!.id}`, manualFlightId: manual!.id, userFlightId: relation!.id, kind: 'historical' }
}

function parseUtc(value: string | null): Date | null {
  if (!value) return null
  const normalized = value.trim().replace(' ', 'T')
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`)
  return Number.isFinite(date.getTime()) ? date : null
}

function canonicalFlightCode(value: string, iata: string | null | undefined, icao: string | null | undefined): string {
  const compact = value.trim().toUpperCase().replace(/[\s-]+/g, '')
  const airlineIata = iata?.toUpperCase()
  const airlineIcao = icao?.toUpperCase()
  if (airlineIata && airlineIcao && compact.startsWith(airlineIcao)) return `${airlineIata} ${compact.slice(airlineIcao.length)}`
  if (airlineIata && compact.startsWith(airlineIata)) return `${airlineIata} ${compact.slice(airlineIata.length)}`
  if (airlineIcao && compact.startsWith(airlineIcao)) return `${airlineIcao} ${compact.slice(airlineIcao.length)}`
  return normalizeFlightNumber(compact)
}
