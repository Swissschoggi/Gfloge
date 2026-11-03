// Demo dataset: reference data + flights + demo relations, clearly identified
// as demo data everywhere via provider id "demo". Times are generated relative
// to the seed moment so the Board always shows a live-looking, but demo, view.
import { distanceKm, utcDateKey } from '@gfloge/shared'

export const DEMO_PROVIDER_ID = 'demo'

export type DemoAirportSeed = {
  iata: string
  icao: string
  name: string
  city: string
  country: string
  lat: number
  lon: number
  tz: string
}

export const DEMO_AIRPORTS: DemoAirportSeed[] = [
  { iata: 'MUC', icao: 'EDDM', name: 'Munich Airport', city: 'Munich', country: 'DE', lat: 48.35378, lon: 11.78608, tz: 'Europe/Berlin' },
  { iata: 'FRA', icao: 'EDDF', name: 'Frankfurt am Main Airport', city: 'Frankfurt', country: 'DE', lat: 50.03793, lon: 8.56202, tz: 'Europe/Berlin' },
  { iata: 'AMS', icao: 'EHAM', name: 'Amsterdam Airport Schiphol', city: 'Amsterdam', country: 'NL', lat: 52.31055, lon: 4.76827, tz: 'Europe/Amsterdam' },
  { iata: 'JFK', icao: 'KJFK', name: 'John F. Kennedy International Airport', city: 'New York', country: 'US', lat: 40.64131, lon: -73.77814, tz: 'America/New_York' },
  { iata: 'NRT', icao: 'RJAA', name: 'Narita International Airport', city: 'Tokyo', country: 'JP', lat: 35.77198, lon: 140.39285, tz: 'Asia/Tokyo' },
  { iata: 'LIS', icao: 'LPPT', name: 'Humberto Delgado Airport', city: 'Lisbon', country: 'PT', lat: 38.77559, lon: -9.13537, tz: 'Europe/Lisbon' },
  { iata: 'VIE', icao: 'LOWW', name: 'Vienna International Airport', city: 'Vienna', country: 'AT', lat: 48.11035, lon: 16.56972, tz: 'Europe/Vienna' },
  { iata: 'PRG', icao: 'LKPR', name: 'Vaclav Havel Airport Prague', city: 'Prague', country: 'CZ', lat: 50.10083, lon: 14.26055, tz: 'Europe/Prague' },
  { iata: 'SIN', icao: 'WSSS', name: 'Singapore Changi Airport', city: 'Singapore', country: 'SG', lat: 1.36442, lon: 103.99155, tz: 'Asia/Singapore' },
  { iata: 'ZRH', icao: 'LSZH', name: 'Zurich Airport', city: 'Zurich', country: 'CH', lat: 47.46469, lon: 8.54917, tz: 'Europe/Zurich' },
  { iata: 'HKG', icao: 'VHHH', name: 'Hong Kong International Airport', city: 'Hong Kong', country: 'HK', lat: 22.30805, lon: 113.91848, tz: 'Asia/Hong_Kong' },
  { iata: 'KTI', icao: 'VDTI', name: 'Techo International Airport', city: 'Phnom Penh', country: 'KH', lat: 11.359, lon: 104.92, tz: 'Asia/Phnom_Penh' },
]

export type DemoAirlineSeed = { iata: string; icao: string; name: string; callsign: string; country: string }

export const DEMO_AIRLINES: DemoAirlineSeed[] = [
  { iata: 'LH', icao: 'DLH', name: 'Deutsche Lufthansa AG', callsign: 'LUFTHANSA', country: 'DE' },
  { iata: 'KL', icao: 'KLM', name: 'KLM Royal Dutch Airlines', callsign: 'KLM', country: 'NL' },
  { iata: 'OS', icao: 'AUA', name: 'Austrian Airlines AG', callsign: 'AUSTRIAN', country: 'AT' },
  { iata: 'JL', icao: 'JAL', name: 'Japan Airlines Co., Ltd.', callsign: 'JAPANAIR', country: 'JP' },
  { iata: 'CX', icao: 'CPA', name: 'Cathay Pacific Airways', callsign: 'CATHAY', country: 'HK' },
]

export type DemoAircraftTypeSeed = { icaoType: string; iataType: string; manufacturer: string; name: string }

export const DEMO_AIRCRAFT_TYPES: DemoAircraftTypeSeed[] = [
  { icaoType: 'A320', iataType: '320', manufacturer: 'Airbus', name: 'Airbus A320' },
  { icaoType: 'A21N', iataType: '32N', manufacturer: 'Airbus', name: 'Airbus A321neo' },
  { icaoType: 'B789', iataType: '789', manufacturer: 'Boeing', name: 'Boeing 787-9 Dreamliner' },
  { icaoType: 'A359', iataType: '359', manufacturer: 'Airbus', name: 'Airbus A350-900' },
  { icaoType: 'B77W', iataType: '77W', manufacturer: 'Boeing', name: 'Boeing 777-300ER' },
]

export type DemoAircraftSeed = { registration: string; hexIcao: string; icaoType: string; owner: string }

export const DEMO_AIRCRAFT: DemoAircraftSeed[] = [
  { registration: 'D-AIZW', hexIcao: '3C6758', icaoType: 'A320', owner: 'Lufthansa' },
  { registration: 'D-AIXP', hexIcao: '3C6B21', icaoType: 'A21N', owner: 'Lufthansa' },
  { registration: 'D-AIXJ', hexIcao: '3C6E34', icaoType: 'A359', owner: 'Lufthansa' },
  { registration: 'PH-BHO', hexIcao: '4842B0', icaoType: 'B789', owner: 'KLM' },
  { registration: 'JA871J', hexIcao: '86D1A1', icaoType: 'B789', owner: 'JAL' },
]

export type DemoFlightIntent = {
  code: string
  airlineIcao: string
  depIata: string
  arrIata: string
  /** Departure in minutes relative to the seed moment (negative = past). */
  depOffsetMin: number
  blockMinutes: number
  status: 'scheduled' | 'boarding' | 'enroute' | 'arrived' | 'cancelled' | 'diverted'
  registration?: string
  depGate?: string
  /** Injects position samples with an age of this many minutes: demo for the stale condition. */
  airframeStaleMin?: number
  /** Flew to another airport; used by the diverted demo flight. */
  diversionIata?: string
}

export const DEMO_FLIGHT_INTENTS: DemoFlightIntent[] = [
  { code: 'LH 371', airlineIcao: 'DLH', depIata: 'MUC', arrIata: 'JFK', depOffsetMin: -35, blockMinutes: 505, status: 'enroute', registration: 'D-AIXP' },
  { code: 'KL 1840', airlineIcao: 'KLM', depIata: 'AMS', arrIata: 'LIS', depOffsetMin: -140, blockMinutes: 195, status: 'enroute', registration: 'PH-BHO', airframeStaleMin: 95 },
  { code: 'LH 684', airlineIcao: 'DLH', depIata: 'FRA', arrIata: 'PRG', depOffsetMin: -6, blockMinutes: 70, status: 'boarding', registration: 'D-AIZW', depGate: 'A12' },
  { code: 'LH 1802', airlineIcao: 'DLH', depIata: 'MUC', arrIata: 'VIE', depOffsetMin: 175, blockMinutes: 65, status: 'scheduled', registration: 'D-AIZW' },
  { code: 'JL 711', airlineIcao: 'JAL', depIata: 'FRA', arrIata: 'NRT', depOffsetMin: 720, blockMinutes: 655, status: 'scheduled', registration: 'JA871J' },
  { code: 'OS 886', airlineIcao: 'AUA', depIata: 'VIE', arrIata: 'PRG', depOffsetMin: -215, blockMinutes: 55, status: 'arrived', registration: 'D-AIXJ' },
  { code: 'OS 434', airlineIcao: 'AUA', depIata: 'VIE', arrIata: 'LIS', depOffsetMin: 55, blockMinutes: 210, status: 'cancelled' },
  { code: 'KL 1822', airlineIcao: 'KLM', depIata: 'AMS', arrIata: 'PRG', depOffsetMin: -1515, blockMinutes: 80, status: 'diverted', diversionIata: 'FRA', registration: 'PH-BHO' },
]

// Prior flights for the demo logbook (personal entries; all demo).
export type DemoLogEntry = {
  code: string
  airlineIcao: string
  depIata: string
  arrIata: string
  departOffsetMin: number
  blockMinutes: number
  registration: string
  seat?: string
  cabin: 'none' | 'eco' | 'premium' | 'business' | 'first'
  note?: string
  rating?: number
  diverted?: boolean
}

export const DEMO_LOGBOOK: DemoLogEntry[] = [
  { code: 'LH 371', airlineIcao: 'DLH', depIata: 'MUC', arrIata: 'JFK', departOffsetMin: -60 * 24 * 3, blockMinutes: 510, registration: 'D-AIXP', seat: '4A', cabin: 'business', note: 'Repositioning trip for the same routing I track today.', rating: 4 },
  { code: 'KL 1840', airlineIcao: 'KLM', depIata: 'AMS', arrIata: 'LIS', departOffsetMin: -60 * 24 * 61, blockMinutes: 205, registration: 'PH-BHO', seat: '17F', cabin: 'eco', note: 'Delayed departure, friendly crew.', rating: 3 },
  { code: 'LH 1802', airlineIcao: 'DLH', depIata: 'MUC', arrIata: 'VIE', departOffsetMin: -60 * 24 * 120, blockMinutes: 70, registration: 'D-AIZW', seat: '12A', cabin: 'eco', rating: 4 },
  { code: 'OS 886', airlineIcao: 'AUA', depIata: 'VIE', arrIata: 'PRG', departOffsetMin: -60 * 24 * 200, blockMinutes: 65, registration: 'D-AIXJ', seat: '3C', cabin: 'premium', note: 'Fog delay out of Vienna.', rating: 3 },
  { code: 'JL 711', airlineIcao: 'JAL', depIata: 'FRA', arrIata: 'NRT', departOffsetMin: -60 * 24 * 330, blockMinutes: 660, registration: 'JA871J', seat: '8K', cabin: 'first', note: 'Anniversary weekend trip, first JAL longhaul.', rating: 5 },
  { code: 'LH 371', airlineIcao: 'DLH', depIata: 'MUC', arrIata: 'JFK', departOffsetMin: -60 * 24 * 410, blockMinutes: 500, registration: 'D-AIXJ', seat: '6C', cabin: 'business', rating: 4 },
  { code: 'KL 1822', airlineIcao: 'KLM', depIata: 'AMS', arrIata: 'PRG', departOffsetMin: -60 * 24 * 500, blockMinutes: 90, registration: 'PH-BHO', seat: '20D', cabin: 'eco', rating: 4, diverted: true },
]

export type DemoFlightConcrete = {
  code: string
  airlineIcao: string
  depIata: string
  arrIata: string
  scheduledDeparture: Date
  scheduledArrival: Date
  status: DemoFlightIntent['status']
  registration?: string
  depGate?: string
  airframeStaleMin?: number
  diversionIata?: string
  distanceKm: number
  depDateKey: string
}

/** Resolves the intents against a seed moment. */
export function buildDemoFlights(now = new Date()): DemoFlightConcrete[] {
  return DEMO_FLIGHT_INTENTS.map((intent) => {
    const dep = new Date(now.getTime() + intent.depOffsetMin * 60_000)
    const scheduled = new Date(dep.getTime() + intent.blockMinutes * 60_000)
    const distance = Math.round(
      distanceKm(
        DEMO_AIRPORTS.find((a) => a.iata === intent.depIata)!,
        DEMO_AIRPORTS.find((a) => a.iata === intent.arrIata)!
      )
    )
    return {
      code: intent.code,
      airlineIcao: intent.airlineIcao,
      depIata: intent.depIata,
      arrIata: intent.arrIata,
      scheduledDeparture: dep,
      scheduledArrival: scheduled,
      status: intent.status,
      registration: intent.registration,
      depGate: intent.depGate,
      airframeStaleMin: intent.airframeStaleMin,
      diversionIata: intent.diversionIata,
      distanceKm: distance,
      depDateKey: utcDateKey(dep),
    }
  })
}

export function buildDemoLogFlights(now = new Date()): DemoFlightConcrete[] {
  return DEMO_LOGBOOK.map((entry) => {
    const dep = new Date(now.getTime() + entry.departOffsetMin * 60_000)
    const scheduled = new Date(dep.getTime() + entry.blockMinutes * 60_000)
    const distance = Math.round(
      distanceKm(
        DEMO_AIRPORTS.find((a) => a.iata === entry.depIata)!,
        DEMO_AIRPORTS.find((a) => a.iata === entry.arrIata)!
      )
    )
    return {
      code: entry.code,
      airlineIcao: entry.airlineIcao,
      depIata: entry.depIata,
      arrIata: entry.arrIata,
      scheduledDeparture: dep,
      scheduledArrival: scheduled,
      status: 'arrived' as const,
      registration: entry.registration,
      depDateKey: utcDateKey(dep),
      distanceKm: distance,
    }
  })
}
