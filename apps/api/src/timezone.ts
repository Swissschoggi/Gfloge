import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const bundled = JSON.parse(readFileSync(path.join(__dirname, 'data', 'airport-tz.json'), 'utf8')) as Record<string, string>

const validZones = new Set(Intl.supportedValuesOf('timeZone'))

export function isValidTimeZone(tz: string | null | undefined): boolean {
  return typeof tz === 'string' && tz.length > 0 && validZones.has(tz)
}

export function resolveAirportTimeZone(codeOrTz: string | null | undefined): string | null {
  if (!codeOrTz) return null
  const trimmed = codeOrTz.trim()
  if (isValidTimeZone(trimmed)) return trimmed
  const upper = trimmed.toUpperCase()
  const mapped = bundled[upper]
  if (mapped && isValidTimeZone(mapped)) return mapped
  return null
}

export function resolveAirportTimeZoneByCodes(icao: string | null | undefined, iata: string | null | undefined, current: string | null | undefined): string | null {
  const cur = current ?? null
  if (isValidTimeZone(cur)) return cur
  if (icao) {
    const r = resolveAirportTimeZone(icao)
    if (r) return r
  }
  if (iata) {
    const r = resolveAirportTimeZone(iata)
    if (r) return r
  }
  return null
}