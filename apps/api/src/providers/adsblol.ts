// adsb.lol live ADS-B positions adapter.
// API is ADSBExchange-compatible and free; optional key for higher limits.
// Docs: https://api.adsb.lol/docs

export type AdsbLolAircraft = {
  hex?: string
  flight?: string
  r?: string
  t?: string
  lat?: number
  lon?: number
  alt_baro?: number | string
  gs?: number
  track?: number
  baro_rate?: number
  seen?: number
  seen_pos?: number
  squawk?: string
}

export type AdsbLolResult = {
  ac?: AdsbLolAircraft[]
  total?: number
  ctime?: number
  msg?: string
}

export async function searchAdsbLolByCallsign(
  callsign: string,
  apiKey: string | null,
  fetcher: typeof fetch = fetch
): Promise<{ state: 'searched' | 'unconfigured' | 'error' | 'rate_limited' | 'timeout' | 'no_results'; aircraft: AdsbLolAircraft | null; message: string }> {
  const cleaned = callsign.replace(/\s+/g, '').toUpperCase()
  if (!cleaned) return { state: 'error', aircraft: null, message: 'No callsign provided.' }
  const url = `https://api.adsb.lol/v2/callsign/${encodeURIComponent(cleaned)}`
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey) headers['api-auth'] = apiKey
    const response = await fetcher(url, { signal: AbortSignal.timeout(8_000), headers })
    if (response.status === 429) return { state: 'rate_limited', aircraft: null, message: 'adsb.lol rate limit reached.' }
    if (!response.ok) return { state: 'error', aircraft: null, message: `adsb.lol returned HTTP ${response.status}.` }
    const body = await response.json() as AdsbLolResult
    const ac = (body.ac ?? [])[0] ?? null
    if (!ac || typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return { state: 'no_results', aircraft: null, message: 'No live position found for this callsign.' }
    return { state: 'searched', aircraft: ac, message: 'Live position retrieved from adsb.lol.' }
  } catch (cause) {
    const timeout = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    return { state: timeout ? 'timeout' : 'error', aircraft: null, message: timeout ? 'adsb.lol did not respond within 8 seconds.' : 'adsb.lol could not be reached.' }
  }
}

export async function testAdsbLolConnection(apiKey: string | null, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; status: string; message: string }> {
  const result = await searchAdsbLolByCallsign('AAL100', apiKey, fetcher)
  if (result.state === 'searched' || result.state === 'no_results') return { ok: true, status: 'ready', message: 'adsb.lol is reachable.' }
  if (result.state === 'rate_limited') return { ok: false, status: 'rate_limited', message: result.message }
  if (result.state === 'timeout') return { ok: false, status: 'timeout', message: result.message }
  return { ok: false, status: 'provider_error', message: result.message }
}