// Domain helpers shared by api, web and demo seeding: great-circle geometry,
// time conversions. Pure functions, unit-testable.

export type LatLon = { lat: number; lon: number }

const EARTH_RADIUS_KM = 6371
const toRad = (deg: number): number => (deg * Math.PI) / 180
const toDeg = (rad: number): number => (rad * 180) / Math.PI

/** Haversine distance in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Interpolate along the great circle between a and b at fraction f (0..1).
 * Uses the spherical linear interpolation of the two unit vectors.
 */
export function greatCircleInterp(a: LatLon, b: LatLon, f: number): LatLon {
  const φ1 = toRad(a.lat)
  const λ1 = toRad(a.lon)
  const φ2 = toRad(b.lat)
  const λ2 = toRad(b.lon)
  const x1 = Math.cos(φ1) * Math.cos(λ1)
  const y1 = Math.cos(φ1) * Math.sin(λ1)
  const z1 = Math.sin(φ1)
  const x2 = Math.cos(φ2) * Math.cos(λ2)
  const y2 = Math.cos(φ2) * Math.sin(λ2)
  const z2 = Math.sin(φ2)
  const d = Math.hypot(x2 - x1, y2 - y1, z2 - z1)
  if (d === 0) return { lat: a.lat, lon: a.lon }
  const t1 = Math.sin((1 - f) * Math.asin(d)) / Math.sin(Math.asin(d))
  const t2 = Math.sin(f * Math.asin(d)) / Math.sin(Math.asin(d))
  const x = t1 * x1 + t2 * x2
  const y = t1 * y1 + t2 * y2
  const z = t1 * z1 + t2 * z2
  // Guard "atan2(0, 0)" style edge cases by normalizing the vector.
  const norm = Math.hypot(x, y, z) || 1
  return { lat: toDeg(Math.asin(z / norm)), lon: toDeg(Math.atan2(y, x)) }
}

/** Initial bearing (degrees clockwise from true north) from a to b. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat)
  const φ2 = toRad(b.lat)
  const Δλ = toRad(b.lon - a.lon)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/**
 * Read side of timezone handling: express a UTC instant in an airport's
 * IANA timezone, returning a compact local form (YYYY-MM-DDTHH:mm) for the
 * API and a sortable UTC date key for flight identity.
 */
export function toLocalIso(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

/** Interpret a local wall-clock time in tz as the matching UTC instant. */
export function fromLocalIso(local: string, tz: string): Date {
  return localToUtc(local, tz)
}

/** Formats the wall-clock time in tz as an offset string like "+02:00". */
export function tzOffsetString(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(instant)
  const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
  return off.replace('GMT', 'UTC') || 'UTC'
}

type DtfCache = Map<string, Intl.DateTimeFormat>
const dtfCache: DtfCache = new Map()
function fmt(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    dtfCache.set(tz, f)
  }
  return f
}

/**
 * Interpret "YYYY-MM-DDTHH:mm" as wall-clock time in tz.
 * Implemented as UTC-rendered parts plus the zone offset for those parts.
 */
export function localToUtc(local: string, tz: string): Date {
  const [day = '', time = ''] = local.split('T')
  const [y = 0, mo = 1, d = 1] = day.split('-').map(Number)
  const [h = 0, mi = 0] = time.split(':').map(Number)
  const f = fmt(tz)
  // Solve for the instant T whose wall clock in tz equals `local`:
  // iterate T = T - (render(T) projected to UTC - wall clock projected to UTC),
  // which converges in 1-2 steps (3 for safety). On DST fold boundaries this
  // deterministically picks one of the two valid instants.
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi)
  let guess = wallAsUtc
  for (let i = 0; i < 3; i++) {
    const p = f.formatToParts(new Date(guess))
    const get = (t: string): number => Number(p.find((x) => x.type === t)?.value)
    const renderAsUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second')
    )
    const diff = renderAsUtc - wallAsUtc
    if (diff === 0) break
    guess = wallAsUtc - diff
  }
  return new Date(guess)
}

export function utcDateKey(instant: Date): string {
  return instant.toISOString().slice(0, 10)
}
