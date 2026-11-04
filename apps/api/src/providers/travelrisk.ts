// Travel Risk API adapter: aviation data + travel risk.
// Single API key shared across all capabilities.
// Docs: https://travelriskapi.com/docs
// Base: https://api.travelriskapi.com
// Auth: X-API-Key header (also ?api_key= for aviation endpoints).

export type TravelRiskFlight = {
  flight_number?: string
  airline_iata?: string
  airline_icao?: string
  airline_name?: string
  dep_iata?: string
  dep_icao?: string
  arr_iata?: string
  arr_icao?: string
  dep_time?: string
  dep_time_utc?: string
  arr_time?: string
  arr_time_utc?: string
  status?: string
  aircraft_icao?: string
  reg_number?: string
  duration?: number
}

export type TravelRiskResult =
  | { state: 'searched'; results: TravelRiskFlight[]; message: string }
  | { state: 'unconfigured' | 'error' | 'timeout' | 'rate_limited'; results: []; message: string }

function authHeaders(apiKey: string): Record<string, string> {
  return { 'X-API-Key': apiKey, accept: 'application/json' }
}

export async function searchTravelRiskFlights(
  params: { code?: string; departure?: string; arrival?: string; date?: string; airline?: string },
  apiKey: string | null,
  fetcher: typeof fetch = fetch
): Promise<TravelRiskResult> {
  if (!apiKey) return { state: 'unconfigured', results: [], message: 'Travel Risk API is selected but no API key is configured.' }

  const url = new URL('https://api.travelriskapi.com/api/v9/schedules')
  if (params.code) url.searchParams.set('flight_iata', params.code)
  if (params.departure) url.searchParams.set('dep_iata', params.departure)
  if (params.arrival) url.searchParams.set('arr_iata', params.arrival)
  if (params.airline) url.searchParams.set('airline_iata', params.airline)
  if (params.date) url.searchParams.set('dep_date', params.date)
  url.searchParams.set('api_key', apiKey)

  try {
    const response = await fetcher(url.toString(), {
      signal: AbortSignal.timeout(8_000),
      headers: authHeaders(apiKey),
    })
    if (response.status === 401 || response.status === 403) return { state: 'error', results: [], message: 'Travel Risk API rejected the configured key.' }
    if (response.status === 429) return { state: 'rate_limited', results: [], message: 'Travel Risk API rate limit reached.' }
    if (!response.ok) return { state: 'error', results: [], message: `Travel Risk API returned HTTP ${response.status}.` }
    const body = await response.json() as { response?: TravelRiskFlight[]; error?: { message?: string; code?: string } }
    if (body.error?.message) return { state: 'error', results: [], message: `Travel Risk API error: ${body.error.message}` }
    return { state: 'searched', results: body.response ?? [], message: 'Travel Risk API schedule search completed.' }
  } catch (cause) {
    const timeout = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    return { state: timeout ? 'timeout' : 'error', results: [], message: timeout ? 'Travel Risk API did not respond within 8 seconds.' : 'Travel Risk API could not be reached.' }
  }
}

export async function lookupTravelRiskFlight(
  number: string,
  date: string | null,
  apiKey: string | null,
  fetcher: typeof fetch = fetch
): Promise<{ ok: boolean; data: unknown; message: string }> {
  if (!apiKey) return { ok: false, data: null, message: 'Travel Risk API is not configured.' }
  const path = date ? `/ext/v1/flight/${encodeURIComponent(number)}?date=${encodeURIComponent(date)}` : `/ext/v1/flight/${encodeURIComponent(number)}`
  try {
    const response = await fetcher(`https://api.travelriskapi.com${path}`, {
      signal: AbortSignal.timeout(8_000),
      headers: authHeaders(apiKey),
    })
    if (response.status === 401 || response.status === 403) return { ok: false, data: null, message: 'Travel Risk API rejected the configured key.' }
    if (response.status === 429) return { ok: false, data: null, message: 'Travel Risk API rate limit reached.' }
    if (response.status === 404) return { ok: false, data: null, message: 'Flight not found in Travel Risk API.' }
    if (!response.ok) return { ok: false, data: null, message: `Travel Risk API returned HTTP ${response.status}.` }
    const data = await response.json()
    return { ok: true, data, message: 'Flight lookup completed.' }
  } catch (cause) {
    const timeout = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    return { ok: false, data: null, message: timeout ? 'Travel Risk API did not respond within 8 seconds.' : 'Travel Risk API could not be reached.' }
  }
}

export async function getTravelRiskCountryRisk(iso: string, apiKey: string | null, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; data: unknown; message: string }> {
  if (!apiKey) return { ok: false, data: null, message: 'Travel Risk API is not configured.' }
  try {
    const response = await fetcher(`https://api.travelriskapi.com/api/v1/risk-score/${encodeURIComponent(iso)}`, {
      signal: AbortSignal.timeout(8_000),
      headers: authHeaders(apiKey),
    })
    if (response.status === 401 || response.status === 403) return { ok: false, data: null, message: 'Travel Risk API rejected the configured key.' }
    if (response.status === 429) return { ok: false, data: null, message: 'Travel Risk API rate limit reached.' }
    if (!response.ok) return { ok: false, data: null, message: `Travel Risk API returned HTTP ${response.status}.` }
    const data = await response.json()
    return { ok: true, data, message: 'Country risk score retrieved.' }
  } catch (cause) {
    const timeout = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    return { ok: false, data: null, message: timeout ? 'Travel Risk API did not respond within 8 seconds.' : 'Travel Risk API could not be reached.' }
  }
}

export async function getTravelRiskAdvisories(iso: string | null, apiKey: string | null, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; data: unknown; message: string }> {
  if (!apiKey) return { ok: false, data: null, message: 'Travel Risk API is not configured.' }
  const url = new URL('https://api.travelriskapi.com/api/v1/advisories')
  if (iso) url.searchParams.set('country_iso', iso)
  try {
    const response = await fetcher(url.toString(), { signal: AbortSignal.timeout(8_000), headers: authHeaders(apiKey) })
    if (response.status === 401 || response.status === 403) return { ok: false, data: null, message: 'Travel Risk API rejected the configured key.' }
    if (response.status === 429) return { ok: false, data: null, message: 'Travel Risk API rate limit reached.' }
    if (!response.ok) return { ok: false, data: null, message: `Travel Risk API returned HTTP ${response.status}.` }
    const data = await response.json()
    return { ok: true, data, message: 'Advisories retrieved.' }
  } catch (cause) {
    const timeout = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    return { ok: false, data: null, message: timeout ? 'Travel Risk API did not respond within 8 seconds.' : 'Travel Risk API could not be reached.' }
  }
}

export async function getTravelRiskAlerts(params: { iso?: string; severity?: string; alertType?: string; days?: number }, apiKey: string | null, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; data: unknown; message: string }> {
  if (!apiKey) return { ok: false, data: null, message: 'Travel Risk API is not configured.' }
  const url = new URL('https://api.travelriskapi.com/api/v1/alerts')
  if (params.iso) url.searchParams.set('country_iso', params.iso)
  if (params.severity) url.searchParams.set('severity', params.severity)
  if (params.alertType) url.searchParams.set('alert_type', params.alertType)
  if (params.days) url.searchParams.set('days', String(params.days))
  try {
    const response = await fetcher(url.toString(), { signal: AbortSignal.timeout(8_000), headers: authHeaders(apiKey) })
    if (response.status === 401 || response.status === 403) return { ok: false, data: null, message: 'Travel Risk API rejected the configured key.' }
    if (response.status === 429) return { ok: false, data: null, message: 'Travel Risk API rate limit reached.' }
    if (!response.ok) return { ok: false, data: null, message: `Travel Risk API returned HTTP ${response.status}.` }
    const data = await response.json()
    return { ok: true, data, message: 'Alerts retrieved.' }
  } catch (cause) {
    const timeout = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    return { ok: false, data: null, message: timeout ? 'Travel Risk API did not respond within 8 seconds.' : 'Travel Risk API could not be reached.' }
  }
}

export async function getTravelRiskConflicts(params: { iso?: string; days?: number; minSeverity?: string }, apiKey: string | null, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; data: unknown; message: string }> {
  if (!apiKey) return { ok: false, data: null, message: 'Travel Risk API is not configured.' }
  const url = new URL('https://api.travelriskapi.com/api/v1/conflicts')
  if (params.iso) url.searchParams.set('country_iso', params.iso)
  if (params.days) url.searchParams.set('days', String(params.days))
  if (params.minSeverity) url.searchParams.set('min_severity', params.minSeverity)
  try {
    const response = await fetcher(url.toString(), { signal: AbortSignal.timeout(8_000), headers: authHeaders(apiKey) })
    if (response.status === 401 || response.status === 403) return { ok: false, data: null, message: 'Travel Risk API rejected the configured key.' }
    if (response.status === 429) return { ok: false, data: null, message: 'Travel Risk API rate limit reached.' }
    if (!response.ok) return { ok: false, data: null, message: `Travel Risk API returned HTTP ${response.status}.` }
    const data = await response.json()
    return { ok: true, data, message: 'Conflicts retrieved.' }
  } catch (cause) {
    const timeout = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    return { ok: false, data: null, message: timeout ? 'Travel Risk API did not respond within 8 seconds.' : 'Travel Risk API could not be reached.' }
  }
}

export async function testTravelRiskConnection(apiKey: string | null, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; status: string; message: string }> {
  if (!apiKey) return { ok: false, status: 'unconfigured', message: 'No API key is configured.' }
  try {
    const response = await fetcher('https://api.travelriskapi.com/api/v1/risk-score/USA', {
      signal: AbortSignal.timeout(8_000),
      headers: authHeaders(apiKey),
    })
    if (response.status === 401 || response.status === 403) return { ok: false, status: 'invalid_credentials', message: 'Travel Risk API rejected the configured key.' }
    if (response.status === 429) return { ok: false, status: 'rate_limited', message: 'Travel Risk API rate limit reached.' }
    if (!response.ok) return { ok: false, status: 'provider_error', message: `Travel Risk API returned HTTP ${response.status}.` }
    const body = await response.json() as { risk_score?: number }
    if (typeof body.risk_score !== 'number') return { ok: false, status: 'provider_error', message: 'Travel Risk API returned an unexpected response.' }
    return { ok: true, status: 'ready', message: 'Travel Risk API credentials are valid (risk endpoint).' }
  } catch (cause) {
    const timeout = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    return { ok: false, status: timeout ? 'timeout' : 'unreachable', message: timeout ? 'Travel Risk API did not respond within 8 seconds.' : 'Travel Risk API could not be reached.' }
  }
}