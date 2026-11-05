// Pure trip maths: no React, no network. Everything the Trips screens derive
// from a TripRead lives here so it can be unit-tested.
import type { AirportInfo, TripRead } from '@gfloge/shared'

export type TripLeg = TripRead['flights'][number]
export type TripPhase = 'empty' | 'upcoming' | 'active' | 'done'

const DAY = 86_400_000

export const airportCode = (a: Pick<AirportInfo, 'iata' | 'icao'>): string => a.iata ?? a.icao ?? '—'

export function sortLegs(flights: TripLeg[]): TripLeg[] {
  return [...flights].sort((a, b) => Date.parse(a.flight.scheduledDeparture) - Date.parse(b.flight.scheduledDeparture))
}

const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function countdownLabel(startMs: number, now: number): string {
  const days = Math.round((startOfDay(startMs) - startOfDay(now)) / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

/** ZRH → JFK → SIN: departure of the first leg, then each arrival, skipping repeats. */
export function routeChain(legs: TripLeg[]): string[] {
  const chain: string[] = []
  for (const { flight } of legs) {
    for (const code of [airportCode(flight.departure), airportCode(flight.arrival)]) {
      if (chain[chain.length - 1] !== code) chain.push(code)
    }
  }
  return chain
}

export type TripSummary = {
  legs: TripLeg[]
  phase: TripPhase
  phaseLabel: string | null
  chain: string[]
  distanceKm: number
  daysAway: number | null
  nextLegId: string | null
}

export function summarizeTrip(trip: TripRead, now = Date.now()): TripSummary {
  const legs = sortLegs(trip.flights)
  const first = legs[0]
  const last = legs[legs.length - 1]
  const start = first ? Date.parse(first.flight.scheduledDeparture) : trip.startDate ? Date.parse(trip.startDate) : NaN
  const end = last
    ? Date.parse(last.flight.actualArrival ?? last.flight.scheduledArrival)
    : trip.endDate
      ? Date.parse(trip.endDate)
      : NaN

  let phase: TripPhase = 'empty'
  if (Number.isFinite(start)) {
    if (now < start) phase = 'upcoming'
    else if (Number.isFinite(end) && now > end) phase = 'done'
    else phase = 'active'
  }

  const phaseLabel =
    phase === 'upcoming' ? countdownLabel(start, now) : phase === 'active' ? 'In progress' : phase === 'done' ? 'Completed' : null

  const daysAway =
    Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.max(1, Math.round((end - start) / DAY)) : null

  const next = legs.find((l) => l.flight.status !== 'arrived' && l.flight.status !== 'cancelled') ?? first

  return {
    legs,
    phase,
    phaseLabel,
    chain: routeChain(legs),
    distanceKm: legs.reduce((sum, l) => sum + (l.flight.distanceKm ?? 0), 0),
    daysAway,
    nextLegId: next?.id ?? null,
  }
}

export type Layover = {
  minutes: number | null
  /** 'ok' | 'tight' | 'stay' (a night or more) | 'airport-change' | 'check-times' */
  kind: 'ok' | 'tight' | 'stay' | 'airport-change' | 'check-times'
  inboundDelayed: boolean
  city: string
}

/** What happens between two consecutive legs. `isTight` comes from @gfloge/shared. */
export function describeLayover(
  prev: TripLeg,
  next: TripLeg,
  minutesBetween: (arrIso: string, depIso: string) => number,
  isTight: (minutes: number, domestic: boolean) => boolean,
): Layover {
  const arrIso = prev.flight.actualArrival ?? prev.flight.scheduledArrival
  const minutes = minutesBetween(arrIso, next.flight.scheduledDeparture)
  const city = prev.flight.arrival.city || airportCode(prev.flight.arrival)
  const delayedMs =
    prev.flight.actualArrival ? Date.parse(prev.flight.actualArrival) - Date.parse(prev.flight.scheduledArrival) : 0
  const inboundDelayed = delayedMs >= 10 * 60_000

  if (!Number.isFinite(minutes) || minutes < 0) return { minutes: null, kind: 'check-times', inboundDelayed, city }
  if (airportCode(prev.flight.arrival) !== airportCode(next.flight.departure))
    return { minutes, kind: 'airport-change', inboundDelayed, city }
  if (minutes >= DAY / 60_000) return { minutes, kind: 'stay', inboundDelayed, city }
  const domestic = !!prev.flight.arrival.country && prev.flight.arrival.country === next.flight.departure.country
  return { minutes, kind: isTight(minutes, domestic) ? 'tight' : 'ok', inboundDelayed, city }
}
