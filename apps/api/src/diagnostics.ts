import type { FlightRead } from '@gfloge/shared'

export type Diagnostic = { severity: 'info' | 'warning' | 'error'; code: string; message: string }

export function diagnoseFlight(flight: FlightRead): Diagnostic[] {
  const out: Diagnostic[] = []
  const dep = new Date(flight.scheduledDeparture)
  const arr = new Date(flight.scheduledArrival)
  if (arr.getTime() < dep.getTime()) out.push({ severity: 'error', code: 'arrival_before_departure', message: 'Scheduled arrival is before scheduled departure.' })
  if (flight.actualArrival && !flight.actualDeparture) out.push({ severity: 'warning', code: 'actual_arrival_without_departure', message: 'Actual arrival is recorded but actual departure is missing.' })
  if (flight.actualDeparture && flight.actualArrival) {
    const a = new Date(flight.actualDeparture); const b = new Date(flight.actualArrival)
    if (b.getTime() < a.getTime()) out.push({ severity: 'error', code: 'actual_arrival_before_departure', message: 'Actual arrival is before actual departure.' })
  }
  if (!flight.departure?.tz) out.push({ severity: 'warning', code: 'missing_departure_timezone', message: 'Departure airport has no IANA timezone; local times may be unreliable.' })
  if (!flight.arrival?.tz) out.push({ severity: 'warning', code: 'missing_arrival_timezone', message: 'Arrival airport has no IANA timezone; local times may be unreliable.' })
  if (flight.departure?.iata && flight.arrival?.iata && flight.departure.iata === flight.arrival.iata) out.push({ severity: 'warning', code: 'same_airport', message: 'Departure and arrival airports are the same.' })
  if (flight.aircraft?.registration && !/^[A-Z0-9-]{2,12}$/i.test(flight.aircraft.registration)) out.push({ severity: 'warning', code: 'invalid_registration', message: 'Aircraft registration looks malformed.' })
  if (flight.cancelled && flight.actualArrival) out.push({ severity: 'info', code: 'cancelled_with_arrival', message: 'Flight is marked cancelled but has an actual arrival time.' })
  if (flight.divertedTo && flight.divertedTo === (flight.arrival?.iata ?? flight.arrival?.icao)) out.push({ severity: 'info', code: 'diversion_same_as_destination', message: 'Diversion destination matches the scheduled destination.' })
  return out
}