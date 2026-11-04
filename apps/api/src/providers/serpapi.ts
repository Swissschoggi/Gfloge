// SerpApi Google Flights adapter.
// Docs: https://serpapi.com/google-flights-api
// Endpoint: https://serpapi.com/search?engine=google_flights

export type SerpApiFlight = {
  flights?: Array<{
    departure_airport?: { name?: string; id?: string; time?: string }
    arrival_airport?: { name?: string; id?: string; time?: string }
    duration?: number
    airplane?: string
    airline?: string
    airline_logo?: string
    flight_number?: string
    legroom?: string
    extensions?: string[]
    ticket_also_sold_by?: string[]
    overnight?: boolean
  }>
  layovers?: Array<{ duration?: number; name?: string; id?: string; overnight?: boolean }>
  total_duration?: number
  carbon_emissions?: { this_flight?: number; typical_for_this_route?: number; difference_percent?: number }
  price?: number
  type?: string
  airline_logo?: string
  departure_token?: string
  booking_token?: string
}

export type SerpApiResult = {
  best_flights?: SerpApiFlight[]
  other_flights?: SerpApiFlight[]
  price_insights?: { lowest_price?: number; price_level?: string; typical_price_range?: number[] }
  search_metadata?: { status?: string; created_at?: string }
  error?: string
}

export async function searchSerpApi(
  params: {
    departureId: string
    arrivalId: string
    outboundDate: string
    returnDate?: string
    type?: '1' | '2' | '3'
    adults?: number
    children?: number
    currency?: string
    hl?: string
    gl?: string
    travelClass?: '1' | '2' | '3' | '4'
    stops?: '0' | '1' | '2'
    maxPrice?: number
  },
  apiKey: string | null,
  fetcher: typeof fetch = fetch
): Promise<{ state: 'searched' | 'unconfigured' | 'error' | 'rate_limited' | 'timeout'; result: SerpApiResult | null; message: string }> {
  if (!apiKey) return { state: 'unconfigured', result: null, message: 'SerpApi is not configured.' }

  const url = new URL('https://serpapi.com/search')
  url.searchParams.set('engine', 'google_flights')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('departure_id', params.departureId)
  url.searchParams.set('arrival_id', params.arrivalId)
  url.searchParams.set('outbound_date', params.outboundDate)
  if (params.returnDate) url.searchParams.set('return_date', params.returnDate)
  if (params.type) url.searchParams.set('type', params.type)
  if (params.adults) url.searchParams.set('adults', String(params.adults))
  if (params.children) url.searchParams.set('children', String(params.children))
  if (params.currency) url.searchParams.set('currency', params.currency)
  if (params.hl) url.searchParams.set('hl', params.hl)
  if (params.gl) url.searchParams.set('gl', params.gl)
  if (params.travelClass) url.searchParams.set('travel_class', params.travelClass)
  if (params.stops) url.searchParams.set('stops', params.stops)
  if (params.maxPrice) url.searchParams.set('max_price', String(params.maxPrice))

  try {
    const response = await fetcher(url.toString(), { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } })
    if (response.status === 401 || response.status === 403) return { state: 'error', result: null, message: 'SerpApi rejected the configured key.' }
    if (response.status === 429) return { state: 'rate_limited', result: null, message: 'SerpApi rate limit reached.' }
    if (!response.ok) return { state: 'error', result: null, message: `SerpApi returned HTTP ${response.status}.` }
    const body = await response.json() as SerpApiResult
    if (body.error) return { state: 'error', result: null, message: `SerpApi error: ${body.error}` }
    return { state: 'searched', result: body, message: 'Google Flights search completed.' }
  } catch (cause) {
    const timeout = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    return { state: timeout ? 'timeout' : 'error', result: null, message: timeout ? 'SerpApi did not respond within 15 seconds.' : 'SerpApi could not be reached.' }
  }
}

export async function testSerpApiConnection(apiKey: string | null, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; status: string; message: string }> {
  if (!apiKey) return { ok: false, status: 'unconfigured', message: 'No API key is configured.' }
  const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const result = await searchSerpApi({ departureId: 'JFK', arrivalId: 'LHR', outboundDate: futureDate, type: '2', adults: 1 }, apiKey, fetcher)
  if (result.state === 'searched') return { ok: true, status: 'ready', message: 'SerpApi credentials are valid.' }
  if (result.state === 'unconfigured') return { ok: false, status: 'unconfigured', message: result.message }
  if (result.state === 'rate_limited') return { ok: false, status: 'rate_limited', message: result.message }
  if (result.state === 'timeout') return { ok: false, status: 'timeout', message: result.message }
  return { ok: false, status: 'provider_error', message: result.message }
}