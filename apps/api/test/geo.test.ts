import test from 'node:test'
import assert from 'node:assert/strict'
import { distanceKm, greatCircleInterp, bearingDeg, localToUtc, toLocalIso, utcDateKey } from '@gfloge/shared'

test('haversine distance matches known airport pair (FRA to JFK)', () => {
  const fra = { lat: 50.0379, lon: 8.5622 }
  const jfk = { lat: 40.6413, lon: -73.7781 }
  const d = distanceKm(fra, jfk)
  // Published great-circle distance is about 6200 km
  assert.ok(d > 6000 && d < 6400, `unexpected distance ${d}`)
})

test('great circle interpolation keeps endpoints and midpoint distance', () => {
  const a = { lat: 50, lon: 8 }
  const b = { lat: 40, lon: -73 }
  const p1 = greatCircleInterp(a, b, 1)
  assert.ok(Math.abs(p1.lat - 40) < 1e-8)
  const mid = greatCircleInterp(a, b, 0.5)
  const half = distanceKm(a, b) / 2
  assert.ok(Math.abs(distanceKm(a, mid) - half) / half < 0.02, 'midpoint not at half distance')
})

test('bearing is roughly northwest for FRA to JFK', () => {
  const deg = bearingDeg({ lat: 50, lon: 8 }, { lat: 40, lon: -73 })
  assert.ok(deg > 280 && deg < 320, `unexpected bearing ${deg}`)
})

test('local wall clock round trips in fixed offset zone', () => {
  const instant = new Date('2026-03-01T10:30:00Z')
  const local = toLocalIso(instant, 'Europe/Berlin')
  assert.equal(local, '2026-03-01T11:30')
  const back = localToUtc(local, 'Europe/Berlin')
  assert.equal(back.toISOString(), instant.toISOString())
})

test('daylight saving boundary handled by wall-clock resolution', () => {
  // 2026-10-25 02:30 local is ambiguous in Berlin (clocks fall back); the
  // parse must resolve deterministically to a valid instant and the
  // round trip must land on one of the two wall-clock interpretations.
  const utc = localToUtc('2026-10-25T02:30', 'Europe/Berlin')
  assert.ok(!Number.isNaN(utc.getTime()))
  const roundTrip = toLocalIso(utc, 'Europe/Berlin')
  assert.match(roundTrip, /T0[23]:30$/)
})

test('utcDateKey uses the UTC calendar day', () => {
  assert.equal(utcDateKey(new Date('2026-03-01T23:30:00Z')), '2026-03-01')
  assert.equal(utcDateKey(new Date('2026-03-02T00:30:00Z')), '2026-03-02')
})

