// Shared input schemas and TypeScript types for api, web and worker.
// These are the one validation truth (SYSTEM_ARCHITECTURE.md §3).

import { z } from 'zod'

export * from './geo.js'

/** Provider id stamping every demo dataset record. */
export const DEMO_PROVIDER_ID = 'demo'

export const FLIGHT_STATUSES = [
  'scheduled',
  'boarding',
  'enroute',
  'arrived',
  'cancelled',
  'diverted',
  'unknown',
] as const
export type FlightStatus = (typeof FLIGHT_STATUSES)[number]

export const DATA_CONDITIONS = ['fresh', 'stale', 'partial', 'unavailable', 'offline'] as const
export type DataCondition = (typeof DATA_CONDITIONS)[number]

export const CABIN_CLASSES = ['none', 'eco', 'premium', 'business', 'first'] as const
export type Cabin = (typeof CABIN_CLASSES)[number]

// ===== Auth =====

export const setupSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, 'Use at least 10 characters'),
  displayName: z.string().trim().min(1).max(80),
})
export type SetupInput = z.infer<typeof setupSchema>

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string(),
})
export type LoginInput = z.infer<typeof loginSchema>

// ===== Flight creation (manual entry) =====

export const normalizeFlightNumber = (raw: string): string =>
  raw
    .trim()
    .toUpperCase()
    .replace(/^([A-Z0-9]{2})(\d)/, '$1 $2') // "LH371" -> "LH 371"

export const manualFlightSchema = z.object({
  airlineIcao: z.string().trim().toUpperCase().optional(),
  flightNumber: z.string().trim().min(2).max(7).transform(normalizeFlightNumber),
  departureIata: z.string().trim().toUpperCase().length(3),
  arrivalIata: z.string().trim().toUpperCase().length(3),
  /** Local wall-clock times at the respective airport, ISO local form (YYYY-MM-DDTHH:mm). */
  departureLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  arrivalLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  aircraftIcaoType: z.string().trim().toUpperCase().optional(),
})
export type ManualFlightInput = z.infer<typeof manualFlightSchema>

// ===== User flight relations =====

export const addUserFlightSchema = z.object({
  /** Canonical (provider) flight id. */
  flightId: z.string().uuid().optional(),
  /** Self-entered manual record id. Exactly one of the two must be set. */
  manualFlightId: z.string().uuid().optional(),
  follow: z.boolean().default(false),
  logging: z
    .object({
      state: z.enum(['flown', 'planned']),
      seat: z.string().trim().max(8).optional(),
      cabin: z.enum(CABIN_CLASSES).default('none'),
      note: z.string().trim().max(4000).optional(),
      rating: z.number().int().min(0).max(5).optional(),
    })
    .optional(),
})
export type AddUserFlightInput = z.infer<typeof addUserFlightSchema>

export const updateUserFlightSchema = z.object({
  seat: z.string().trim().max(8).nullable().optional(),
  cabin: z.enum(CABIN_CLASSES).optional(),
  note: z.string().trim().max(4000).nullable().optional(),
  rating: z.number().int().min(0).max(5).nullable().optional(),
  markFlown: z.boolean().optional(),
  follow: z.boolean().optional(),
  logging: z.boolean().optional(),
  tripId: z.string().uuid().nullable().optional(),
})
export type UpdateUserFlightInput = z.infer<typeof updateUserFlightSchema>

// ===== Lookups =====

export const flightLookupSchema = z.object({
  code: z.string().trim().min(2).max(7).transform(normalizeFlightNumber),
  /** Local date at the departure airport or plain UTC date (YYYY-MM-DD). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})
export type FlightLookupInput = z.infer<typeof flightLookupSchema>

// ===== API payload shapes (read side) =====

export type AirportInfo = {
  id: string
  iata: string | null
  icao: string | null
  name: string
  city: string
  country: string
  tz: string
  lat: number
  lon: number
}

export type AirlineInfo = { id: string; iata: string | null; icao: string | null; name: string; country: string | null }

export type AircraftInfo = { registration: string | null; icaoType: string | null; typeName: string | null; manufacturer: string | null }

export type RoutePoint = { lat: number; lon: number; altFt: number | null; ts?: string }

export type FlightRead = {
  id: string
  flightCode: string
  airline: AirlineInfo | null
  departure: AirportInfo
  arrival: AirportInfo
  scheduledDeparture: string // ISO UTC
  scheduledArrival: string
  actualDeparture: string | null
  actualArrival: string | null
  status: FlightStatus
  depTerminal: string | null
  depGate: string | null
  arrTerminal: string | null
  arrGate: string | null
  arrBaggage: string | null
  aircraft: AircraftInfo | null
  distanceKm: number | null
  /** Provider attribution and demo marking come from providerRefs.demo. */
  providerId: string | null
  isDemo: boolean
  isManual: boolean
}

export type UserFlightItem = {
  id: string
  role: 'tracked' | 'logged'
  isFollowing: boolean
  loggedState: 'flown' | 'planned' | null
  seat: string | null
  cabin: Cabin
  note: string | null
  rating: number | null
  tripId: string | null
  source: 'manual' | 'tracked-auto' | 'import'
  flight: FlightRead
}

export type BoardItem = {
  userFlightId: string
  relation: 'following' | 'planned' | 'logged'
  isFollowing: boolean
  loggedState: 'flown' | 'planned' | null
  flight: FlightRead
  condition: DataCondition
  lastUpdateTime: string | null
}

export type BoardPayload = {
  generatedAt: string
  active: BoardItem[]
  upcoming: BoardItem[]
  landed: BoardItem[]
}

export type PositionData = {
  sourceLabel: string
  isDemo: boolean
  condition: DataCondition
  fetchedAt: string
  points: RoutePoint[]
  aircraft: AircraftInfo | null
}

export type AlertsPayload = {
  id: string
  type: string
  old: Record<string, unknown> | null
  new: Record<string, unknown> | null
  createdAt: string
}

export type StatsPayload = {
  flights: number
  distanceKm: number
  minutes: number
  uniqueAirports: number
  uniqueAirlines: number
  uniqueAircraftTypes: number
  countriesVisited: number
  routesFlown: Array<{ route: string; flights: number }>
  perYear: Array<{ year: string; flights: number; distanceKm: number }>
}

export type HealthPayload = {
  ok: boolean
  db: { ok: boolean; tables: string; migrations: string }
  providers: Array<{ id: string; configured: boolean; capabilities: string[]; status: string }>
  seed: { demo: boolean }
}

export type MePayload = { id: string; email: string; displayName: string; role: 'admin' | 'user' }
export type AuthedUser = MePayload

export type UserPreferences = {
  units: 'km' | 'mi'
  timezoneDisplay: 'airport' | 'local' | 'utc'
  themeOverride: 'system' | 'day' | 'night'
  notificationPrefs: { delays: boolean; gates: boolean; cancellations: boolean }
}

export type TripRead = {
  id: string
  name: string
  description: string | null
  startDate: string | null
  endDate: string | null
  flights: UserFlightItem[]
}

export const tripSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
})

export const preferencesSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  units: z.enum(['km', 'mi']).optional(),
  timezoneDisplay: z.enum(['airport', 'local', 'utc']).optional(),
  themeOverride: z.enum(['system', 'day', 'night']).optional(),
  notificationPrefs: z.object({ delays: z.boolean(), gates: z.boolean(), cancellations: z.boolean() }).optional(),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
})

export type ProviderStatus = {
  id: string
  displayName: string
  configured: boolean
  capabilities: string[]
  status: string
  attribution: string
  credentialHint: string | null
}
