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
  airlineIata: z.string().trim().toUpperCase().length(2).optional(),
  airlineIcao: z.string().trim().toUpperCase().min(2).max(3).optional(),
  flightNumber: z.string().trim().max(16).transform((value) => value ? normalizeFlightNumber(value) : undefined).optional(),
  departureIata: z.string().trim().toUpperCase().length(3).optional(),
  departureIcao: z.string().trim().toUpperCase().length(4).optional(),
  arrivalIata: z.string().trim().toUpperCase().length(3).optional(),
  arrivalIcao: z.string().trim().toUpperCase().length(4).optional(),
  /** Local wall-clock times at the respective airport, ISO local form (YYYY-MM-DDTHH:mm). */
  departureLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  arrivalLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  aircraftIcaoType: z.string().trim().toUpperCase().optional(),
}).superRefine((input, context) => {
  if (!input.departureIata && !input.departureIcao) context.addIssue({ code: z.ZodIssueCode.custom, path: ['departureIata'], message: 'Choose a departure airport.' })
  if (!input.arrivalIata && !input.arrivalIcao) context.addIssue({ code: z.ZodIssueCode.custom, path: ['arrivalIata'], message: 'Choose an arrival airport.' })
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

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Choose a valid travel date.')

/** Search needs a date and at least one remembered flight/route detail. */
export const flightSearchSchema = z.object({
  date: calendarDate,
  code: z.string().trim().max(16).transform((value) => value.toUpperCase().replace(/[\s-]+/g, '')).optional().default(''),
  departure: z.string().trim().max(160).optional().default(''),
  arrival: z.string().trim().max(160).optional().default(''),
  airline: z.string().trim().max(160).optional().default(''),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  timeWindowMinutes: z.coerce.number().int().min(15).max(360).default(90),
  registration: z.string().trim().max(16).transform((value) => value.toUpperCase().replace(/[\s-]+/g, '')).optional().default(''),
}).superRefine((value, context) => {
  if (!value.code && !value.departure && !value.arrival && !value.airline && !value.registration) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['code'], message: 'Add a flight number, airport, airline or aircraft registration to search.' })
  }
})
export type FlightSearchInput = z.infer<typeof flightSearchSchema>

// ===== API payload shapes (read side) =====

export type AirportInfo = {
  id: string
  iata: string | null
  icao: string | null
  name: string
  city: string
  country: string
  tz: string | null
  lat: number
  lon: number
}

export type AirportSearchResult = {
  id: string
  iata: string | null
  icao: string | null
  name: string
  city: string | null
  country: string | null
  tz: string | null
  lat: number | null
  lon: number | null
  source: string
  creatable: boolean
}

export type AirlineInfo = { id: string; iata: string | null; icao: string | null; name: string; country: string | null }
export type AirlineSearchResult = AirlineInfo & { callsign: string | null; source: string }
export type AircraftTypeSearchResult = { id: string; iataType: string | null; icaoType: string | null; manufacturer: string | null; name: string; family: string | null; source: string }

export type FlightSearchSource = {
  id: string
  name: string
  kind: 'schedule' | 'historical' | 'demo'
  status: 'searched' | 'no_results' | 'not_configured' | 'not_applicable' | 'unavailable' | 'error' | 'outside_window' | 'unsupported' | 'rate_limited'
  message: string
  attribution: string
}

export type FlightSearchCandidate = {
  id: string
  token: string | null
  flightId: string | null
  kind: 'schedule' | 'historical' | 'demo'
  evidence: 'verified_schedule' | 'historical_observation' | 'demo_sample' | 'incomplete'
  flightCode: string | null
  airlineCode: string | null
  departureCode: string | null
  arrivalCode: string | null
  airline: AirlineSearchResult | null
  departure: AirportSearchResult | null
  arrival: AirportSearchResult | null
  departureTimeUtc: string | null
  arrivalTimeUtc: string | null
  aircraftRegistration: string | null
  aircraftType: string | null
  status: FlightStatus | null
  depTerminal: string | null
  depGate: string | null
  arrTerminal: string | null
  arrGate: string | null
  arrBaggage: string | null
  source: { id: string; name: string; attribution: string; license: string | null }
  additionalSources: Array<{ id: string; name: string; attribution: string; license: string | null }>
  missingFields: Array<'flightNumber' | 'airline' | 'departure' | 'arrival' | 'departureTimezone' | 'departureTime' | 'arrivalTime' | 'aircraftRegistration' | 'aircraftType'>
}

export type FlightSearchResponse = {
  query: FlightSearchInput
  outcome: 'matches' | 'no_sources' | 'sources_unavailable' | 'no_matches' | 'partial'
  sources: FlightSearchSource[]
  candidates: FlightSearchCandidate[]
}

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
  scheduledGateDeparture: string | null
  actualGateDeparture: string | null
  scheduledTakeoff: string | null
  actualTakeoff: string | null
  scheduledLanding: string | null
  actualLanding: string | null
  scheduledGateArrival: string | null
  actualGateArrival: string | null
  cancelled: boolean
  divertedTo: string | null
  seat: string | null
  seatType: string | null
  bookingReference: string | null
  flightReason: string | null
  sourceType: string | null
  sourceName: string | null
  sourceMetadata: Record<string, string> | null
  fieldSources: Record<string, unknown> | null
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
  flightId: string | null
  flightCode: string | null
  headline: string
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
  implemented?: boolean
}

// ===== Flight discovery (SerpApi Google Flights offers) =====

export type FlightDiscoveryAirport = {
  name?: string
  id?: string
  time?: string
}

export type FlightDiscoveryLeg = {
  departure_airport?: FlightDiscoveryAirport
  arrival_airport?: FlightDiscoveryAirport
  duration?: number
  airplane?: string
  airline?: string
  airline_logo?: string
  flight_number?: string
  legroom?: string
  extensions?: string[]
  ticket_also_sold_by?: string[]
  overnight?: boolean
}

export type FlightDiscoveryOffer = {
  flights?: FlightDiscoveryLeg[]
  layovers?: Array<{ duration?: number; name?: string; id?: string; overnight?: boolean }>
  total_duration?: number
  carbon_emissions?: { this_flight?: number; typical_for_this_route?: number; difference_percent?: number }
  price?: number
  type?: string
  airline_logo?: string
  departure_token?: string
  booking_token?: string
}

export type FlightDiscoveryResult = {
  retrievedAt?: string
  best_flights?: FlightDiscoveryOffer[]
  other_flights?: FlightDiscoveryOffer[]
  price_insights?: { lowest_price?: number; price_level?: string; typical_price_range?: number[] }
  search_metadata?: { status?: string; created_at?: string }
  error?: string
}
