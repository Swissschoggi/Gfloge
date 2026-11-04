import { localToUtc, toLocalIso } from '@gfloge/shared'
import type { FlightSearchInput } from '@gfloge/shared'

export type AirLabsSchedule = {
  airline_iata?: string | null
  airline_icao?: string | null
  flight_iata?: string | null
  flight_icao?: string | null
  flight_number?: string | null
  dep_iata?: string | null
  dep_icao?: string | null
  dep_time_utc?: string | null
  dep_time_ts?: number | null
  dep_time?: string | null
  dep_estimated_utc?: string | null
  arr_iata?: string | null
  arr_icao?: string | null
  arr_time_utc?: string | null
  arr_time_ts?: number | null
  arr_time?: string | null
  arr_estimated_utc?: string | null
  dep_terminal?: string | null
  dep_gate?: string | null
  arr_terminal?: string | null
  arr_gate?: string | null
  arr_baggage?: string | null
  status?: string | null
  aircraft_icao?: string | null
  reg_number?: string | null
  registration?: string | null
}

export type AirLabsResult =
  | { state: 'searched'; results: AirLabsSchedule[]; message: string }
  | { state: 'outside_window' | 'unsupported' | 'unconfigured' | 'error'; results: []; message: string }

type AirportCriteria = { iata: string | null; icao: string | null; tz: string }
type AirlineCriteria = { iata: string | null; icao: string | null }
type AirLabsCriteria = {
  search: FlightSearchInput
  departure?: AirportCriteria | null
  arrival?: AirportCriteria | null
  airline?: AirlineCriteria | null
}

export function airLabsSearchParams(criteria: AirLabsCriteria, apiKey: string, now = new Date()): URLSearchParams | AirLabsResult {
  const { search } = criteria
  const params = new URLSearchParams({ api_key: apiKey, limit: '50' })
  let hasRemoteFilter = false

  if (search.code) {
    params.set(/^([A-Z]{3})\d/.test(search.code) ? 'flight_icao' : 'flight_iata', search.code)
    hasRemoteFilter = true
  }
  if (criteria.departure?.iata) {
    params.set('dep_iata', criteria.departure.iata)
    hasRemoteFilter = true
  } else if (criteria.departure?.icao) {
    params.set('dep_icao', criteria.departure.icao)
    hasRemoteFilter = true
  }
  if (criteria.arrival?.iata) {
    params.set('arr_iata', criteria.arrival.iata)
    hasRemoteFilter = true
  } else if (criteria.arrival?.icao) {
    params.set('arr_icao', criteria.arrival.icao)
    hasRemoteFilter = true
  }
  if (criteria.airline?.iata) {
    params.set('airline_iata', criteria.airline.iata)
    hasRemoteFilter = true
  } else if (criteria.airline?.icao) {
    params.set('airline_icao', criteria.airline.icao)
    hasRemoteFilter = true
  }

  if (!hasRemoteFilter) {
    return { state: 'unsupported', results: [], message: 'AirLabs cannot search by aircraft registration alone. An installed historical dataset may still match it.' }
  }
  if (search.registration) {
    return { state: 'unsupported', results: [], message: 'AirLabs schedules do not support registration filtering. An installed historical dataset may still match it.' }
  }

  // AirLabs' current schedule queue only reaches about ten hours ahead. Avoid
  // an unnecessary API call when the requested local departure day is outside it.
  let dayStart: Date
  let dayEnd: Date
  if (criteria.departure?.tz) {
    const dayStartLocal = localToUtc(`${search.date}T00:00`, criteria.departure.tz)
    const nextDay = new Date(`${search.date}T00:00:00.000Z`)
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    const nextDate = nextDay.toISOString().slice(0, 10)
    dayStart = dayStartLocal
    dayEnd = localToUtc(`${nextDate}T00:00`, criteria.departure.tz)
  } else {
    // Flight-number-only searches have no known departure zone yet. Use the
    // world-wide UTC offset envelope; exact local-date matching happens after
    // each provider result has resolved its departure airport.
    const midnight = new Date(`${search.date}T00:00:00.000Z`).getTime()
    dayStart = new Date(midnight - 14 * 60 * 60_000)
    dayEnd = new Date(midnight + 38 * 60 * 60_000)
  }
  const horizon = new Date(now.getTime() + 10 * 60 * 60_000)
  if (dayEnd <= now || dayStart > horizon) {
    return { state: 'outside_window', results: [], message: 'AirLabs schedules cover the live queue only, up to about ten hours ahead. This departure date is outside that window.' }
  }

  return params
}

export async function searchAirLabsSchedules(
  criteria: AirLabsCriteria,
  apiKey: string | null,
  fetcher: typeof fetch = fetch,
  now = new Date()
): Promise<AirLabsResult> {
  if (!apiKey) return { state: 'unconfigured', results: [], message: 'AirLabs is selected for schedules, but no API key is configured.' }
  const params = airLabsSearchParams(criteria, apiKey, now)
  if (!(params instanceof URLSearchParams)) return params

  try {
    const response = await fetcher(`https://airlabs.co/api/v9/schedules?${params.toString()}`, {
      signal: AbortSignal.timeout(8_000),
      headers: { accept: 'application/json' },
    })
    if (response.status === 401 || response.status === 403) {
      return { state: 'error', results: [], message: 'AirLabs rejected its configured key. Check the provider credentials in Settings.' }
    }
    if (response.status === 429) {
      return { state: 'error', results: [], message: 'AirLabs rate limit or allowance was reached. Try again later or review the provider plan.' }
    }
    if (!response.ok) {
      return { state: 'error', results: [], message: `AirLabs could not return schedules (HTTP ${response.status}).` }
    }
    const body = await response.json() as unknown
    const payload = Array.isArray(body)
      ? body
      : body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).response)
        ? (body as { response: unknown[] }).response
        : null
    if (!payload) {
      const error = body && typeof body === 'object' ? (body as { error?: { message?: string } }).error : undefined
      return { state: 'error', results: [], message: error?.message ? `AirLabs returned an error: ${error.message}` : 'AirLabs returned an unreadable schedule response.' }
    }
    return {
      state: 'searched',
      results: payload.filter((row): row is AirLabsSchedule => !!row && typeof row === 'object'),
      message: 'AirLabs live schedule queue queried. Coverage depends on the flight and is limited to about ten hours ahead.',
    }
  } catch (cause) {
    const timeout = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    return {
      state: 'error',
      results: [],
      message: timeout ? 'AirLabs did not respond within eight seconds. This is a data retrieval failure, not evidence that the flight is not operating.' : 'AirLabs could not be reached. This is a data retrieval failure, not evidence that the flight is not operating.',
    }
  }
}

export function parseAirLabsInstant(
  utcValue: string | null | undefined,
  timestamp: number | null | undefined,
  localValue: string | null | undefined,
  timezone: string
): Date | null {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return new Date(timestamp * 1000)
  if (utcValue) {
    const value = utcValue.trim().replace(' ', 'T')
    const parsed = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`)
    if (Number.isFinite(parsed.getTime())) return parsed
  }
  if (localValue) {
    try {
      const value = localValue.replace(' ', 'T').slice(0, 16)
      return localToUtc(value, timezone)
    } catch {
      return null
    }
  }
  return null
}

export function matchesLocalDate(instant: Date | null, date: string, timezone: string): boolean {
  if (!instant) return false
  try {
    return toLocalIso(instant, timezone).slice(0, 10) === date
  } catch {
    return false
  }
}

export function isWithinLocalTimeWindow(instant: Date | null, time: string | undefined, windowMinutes: number, timezone: string): boolean {
  if (!time) return true
  if (!instant) return false
  try {
    const local = toLocalIso(instant, timezone).slice(11, 16)
    const [hour, minute] = local.split(':').map(Number)
    const [targetHour, targetMinute] = time.split(':').map(Number)
    const delta = Math.abs((hour! * 60 + minute!) - (targetHour! * 60 + targetMinute!))
    return Math.min(delta, 1440 - delta) <= windowMinutes
  } catch {
    return false
  }
}
