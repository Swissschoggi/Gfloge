import test from 'node:test'
import assert from 'node:assert/strict'
import { diagnoseFlight } from '@gfloge/shared'
import type { FlightRead } from '@gfloge/shared'

function flight(overrides: Partial<FlightRead> = {}): FlightRead {
  return {
    id: 'f1',
    flightCode: 'AA 100',
    airline: { id: 'a', iata: 'AA', icao: 'AAL', name: 'American', country: 'US' },
    departure: { id: 'd', iata: 'JFK', icao: 'KJFK', name: 'JFK', city: 'New York', country: 'US', tz: 'America/New_York', lat: 40, lon: -74 },
    arrival: { id: 'a', iata: 'LAX', icao: 'KLAX', name: 'LAX', city: 'Los Angeles', country: 'US', tz: 'America/Los_Angeles', lat: 34, lon: -118 },
    scheduledDeparture: '2026-11-04T10:00:00.000Z',
    scheduledArrival: '2026-11-04T14:00:00.000Z',
    actualDeparture: null,
    actualArrival: null,
    status: 'scheduled',
    depTerminal: null, depGate: null, arrTerminal: null, arrGate: null, arrBaggage: null,
    scheduledGateDeparture: null, actualGateDeparture: null, scheduledTakeoff: null, actualTakeoff: null,
    scheduledLanding: null, actualLanding: null, scheduledGateArrival: null, actualGateArrival: null,
    cancelled: false, divertedTo: null, seat: null, seatType: null, bookingReference: null, flightReason: null,
    sourceType: null, sourceName: null, sourceMetadata: null, fieldSources: null,
    aircraft: { registration: 'N123AA', icaoType: 'A320', typeName: 'Airbus A320', manufacturer: 'Airbus' },
    distanceKm: 1200, providerId: 'demo', isDemo: true, isManual: false,
    ...overrides,
  }
}

test('diagnostics: no issues for complete valid flight', () => {
  const d = diagnoseFlight(flight())
  assert.equal(d.length, 0)
})

test('diagnostics: arrival before departure', () => {
  const f = flight({ scheduledArrival: '2026-11-04T09:00:00.000Z' })
  assert.ok(diagnoseFlight(f).some((d) => d.code === 'arrival_before_departure' && d.severity === 'error'))
})

test('diagnostics: actual arrival without departure', () => {
  const f = flight({ actualArrival: '2026-11-04T14:00:00.000Z' })
  assert.ok(diagnoseFlight(f).some((d) => d.code === 'actual_arrival_without_departure'))
})

test('diagnostics: actual arrival before departure', () => {
  const f = flight({ actualDeparture: '2026-11-04T11:00:00.000Z', actualArrival: '2026-11-04T10:30:00.000Z' })
  assert.ok(diagnoseFlight(f).some((d) => d.code === 'actual_arrival_before_departure' && d.severity === 'error'))
})

test('diagnostics: missing timezones', () => {
  const f = flight({ departure: { id:'d', iata:'JFK', icao:'KJFK', name:'JFK', city:'NY', country:'US', tz: null, lat:40, lon:-74 }, arrival: { id:'a', iata:'LAX', icao:'KLAX', name:'LAX', city:'LA', country:'US', tz: null, lat:34, lon:-118 } })
  const codes = diagnoseFlight(f).map((d) => d.code)
  assert.ok(codes.includes('missing_departure_timezone'))
  assert.ok(codes.includes('missing_arrival_timezone'))
})

test('diagnostics: same airport', () => {
  const f = flight({ arrival: { id:'a', iata:'JFK', icao:'KJFK', name:'JFK', city:'NY', country:'US', tz:'America/New_York', lat:40, lon:-74 } })
  assert.ok(diagnoseFlight(f).some((d) => d.code === 'same_airport'))
})

test('diagnostics: invalid registration', () => {
  const f = flight({ aircraft: { registration: '!!!', icaoType: 'A320', typeName: 'Airbus A320', manufacturer: 'Airbus' } })
  assert.ok(diagnoseFlight(f).some((d) => d.code === 'invalid_registration'))
})

test('diagnostics: cancelled with arrival', () => {
  const f = flight({ cancelled: true, actualArrival: '2026-11-04T14:00:00.000Z' })
  assert.ok(diagnoseFlight(f).some((d) => d.code === 'cancelled_with_arrival'))
})

test('diagnostics: diversion same as destination', () => {
  const f = flight({ divertedTo: 'LAX' })
  assert.ok(diagnoseFlight(f).some((d) => d.code === 'diversion_same_as_destination'))
})

test('diagnostics: negative duration', () => {
  const f = flight({ scheduledArrival: '2026-11-04T09:00:00.000Z' })
  assert.ok(diagnoseFlight(f).some((d) => d.code === 'negative_duration' && d.severity === 'error'))
})

test('diagnostics: long duration', () => {
  const f = flight({ scheduledArrival: '2026-11-05T15:00:00.000Z' })
  assert.ok(diagnoseFlight(f).some((d) => d.code === 'long_duration'))
})

test('diagnostics: missing aircraft', () => {
  const f = flight({ aircraft: null })
  assert.ok(diagnoseFlight(f).some((d) => d.code === 'missing_aircraft'))
})

test('diagnostics: multiple issues', () => {
  const f = flight({ scheduledArrival: '2026-11-04T09:00:00.000Z', aircraft: null, departure: { id:'d', iata:'JFK', icao:'KJFK', name:'JFK', city:'NY', country:'US', tz: null, lat:40, lon:-74 } })
  const codes = diagnoseFlight(f).map((d) => d.code)
  assert.ok(codes.length >= 3)
})

test('diagnostics: null incomplete fields do not crash', () => {
  const f = flight({ aircraft: null, departure: { id:'d', iata: null, icao: null, name:'X', city:'Y', country:'Z', tz: null, lat:0, lon:0 } })
  assert.doesNotThrow(() => diagnoseFlight(f))
})

test('diagnostics: boundary 24h duration', () => {
  const f = flight({ scheduledArrival: '2026-11-05T10:00:00.000Z' }) // exactly 24h
  const codes = diagnoseFlight(f).map((d) => d.code)
  assert.ok(!codes.includes('long_duration'))
})
