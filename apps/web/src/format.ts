// Time presentation: airport-local wall clock is the default view; UTC and
// date helpers follow SCREEN_SPECIFICATIONS numerics rules.
import { toLocalIso } from '@gfloge/shared'

export function formatLocal(iso: string, tz: string): string {
  const preference = typeof localStorage === 'undefined' ? 'airport' : localStorage.getItem('gfloge-timezone-display') ?? 'airport'
  const selectedZone = preference === 'utc' ? 'UTC' : preference === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : tz
  return toLocalIso(new Date(iso), selectedZone).slice(11)
}

export function formatDate(iso: string, tz: string): string {
  const preference = typeof localStorage === 'undefined' ? 'airport' : localStorage.getItem('gfloge-timezone-display') ?? 'airport'
  const selectedZone = preference === 'utc' ? 'UTC' : preference === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : tz
  return toLocalIso(new Date(iso), selectedZone).slice(0, 10)
}

export function timeBasisLabel(airport: string, tz: string): string {
  const preference = typeof localStorage === 'undefined' ? 'airport' : localStorage.getItem('gfloge-timezone-display') ?? 'airport'
  if (preference === 'utc') return 'UTC'
  if (preference === 'local') return `${Intl.DateTimeFormat().resolvedOptions().timeZone} · device local`
  return `${airport} local · ${tz}`
}

export function formatDistance(distanceKm: number): string {
  const units = typeof localStorage === 'undefined' ? 'km' : localStorage.getItem('gfloge-units') ?? 'km'
  const value = units === 'mi' ? distanceKm * 0.621371 : distanceKm
  return `${Math.round(value).toLocaleString()} ${units}`
}

export function sameUtcDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10)
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
