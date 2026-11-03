// Seeding: run after migrations. Two modes:
//  1. Demo seeding (when enabled and instance is empty): a complete, clearly
//     labeled demo dataset incl. users, canonical flights, personal logbook.
//  2. Admin bootstrap: GF_ADMIN_EMAIL + GF_ADMIN_PASSWORD create the admin.
import { eq, sql } from 'drizzle-orm'
import {
  aircraft,
  aircraftTypes,
  airlines,
  airports,
  alerts,
  flights,
  users,
  userFlights,
} from '@gfloge/db'
import type { Db } from '@gfloge/db'
import {
  DEMO_AIRCRAFT,
  DEMO_AIRCRAFT_TYPES,
  DEMO_AIRLINES,
  DEMO_AIRPORTS,
  DEMO_LOGBOOK,
  buildDemoFlights,
  buildDemoLogFlights,
} from './demo-data.js'
import { DEMO_PROVIDER_ID } from './providers/types.js'
import { hashPassword } from './crypto.js'

export type SeedResult = { demo: boolean; users: number; flights: number }

export async function isEmptyInstance(db: Db): Promise<boolean> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users)
  return count === 0
}

/** Reference data insert, idempotent by iata/icao unique keys. */
export async function seedReferenceData(db: Db): Promise<Map<string, string>> {
  const airportIdByIata = new Map<string, string>()
  for (const a of DEMO_AIRPORTS) {
    const [row] = await db
      .insert(airports)
      .values({
        iata: a.iata,
        icao: a.icao,
        name: a.name,
        city: a.city,
        country: a.country,
        lat: a.lat,
        lon: a.lon,
        tz: a.tz,
        source: 'seed',
      })
      .onConflictDoNothing()
      .returning({ id: airports.id })
    if (row) airportIdByIata.set(a.iata, row.id)
    else {
      const existing = await db.select({ id: airports.id }).from(airports).where(eq(airports.iata, a.iata)).limit(1)
      if (existing[0]) airportIdByIata.set(a.iata, existing[0].id)
    }
  }

  const airlineIdByIcao = new Map<string, string>()
  for (const al of DEMO_AIRLINES) {
    const [row] = await db
      .insert(airlines)
      .values({ iata: al.iata, icao: al.icao, name: al.name, callsign: al.callsign, country: al.country, source: 'seed' })
      .onConflictDoNothing()
      .returning({ id: airlines.id })
    if (row) airlineIdByIcao.set(al.icao, row.id)
    else {
      const existing = await db.select({ id: airlines.id }).from(airlines).where(eq(airlines.icao, al.icao)).limit(1)
      if (existing[0]) airlineIdByIcao.set(al.icao, existing[0].id)
    }
  }

  const typeIdByIcao = new Map<string, string>()
  for (const t of DEMO_AIRCRAFT_TYPES) {
    const existing = await db
      .select({ id: aircraftTypes.id })
      .from(aircraftTypes)
      .where(eq(aircraftTypes.icaoType, t.icaoType))
      .limit(1)
    if (existing[0]) typeIdByIcao.set(t.icaoType, existing[0].id)
    else {
      const [row] = await db
        .insert(aircraftTypes)
        .values({ icaoType: t.icaoType, iataType: t.iataType, manufacturer: t.manufacturer, name: t.name, source: 'seed' })
        .returning({ id: aircraftTypes.id })
      typeIdByIcao.set(t.icaoType, row!.id)
    }
  }

  for (const ac of DEMO_AIRCRAFT) {
    const existing = await db
      .select({ id: aircraft.id })
      .from(aircraft)
      .where(eq(aircraft.registration, ac.registration))
      .limit(1)
    if (!existing[0]) {
      await db.insert(aircraft).values({
        registration: ac.registration,
        hexIcao: ac.hexIcao,
        aircraftTypeId: typeIdByIcao.get(ac.icaoType) ?? null,
        source: 'seed',
      })
    }
  }

  return airportIdByIata
}

/**
 * Demo seeding: an entire instance's worth of test data, every record tied to
 * provider id "demo" so UI attribution can label it.
 */
export async function seedDemoInstance(db: Db): Promise<SeedResult> {
  const now = new Date()
  await seedReferenceData(db)
  const airportIdByIata = new Map<string, string>()
  const airportRows = await db.select({ id: airports.id, iata: airports.iata }).from(airports)
  for (const row of airportRows) if (row.iata) airportIdByIata.set(row.iata, row.id)
  const airlineRows = await db.select({ id: airlines.id, icao: airlines.icao }).from(airlines)
  const airlineIdByIcao = new Map(airlineRows.map((r) => [r.icao ?? '', r.id]))
  const typeRows = await db.select({ id: aircraftTypes.id, icao: aircraftTypes.icaoType }).from(aircraftTypes)
  const typeIdByIcao = new Map(typeRows.map((r) => [r.icao ?? '', r.id]))

  // Users: admin + ordinary user, both demo-labelled in the audit trail.
  const inserted: Array<{ id: string; email: string; role: 'admin' | 'user' }> = []
  for (const spec of [
    { email: 'marta@gfloge.demo', password: 'flighty-demo-1', displayName: 'Marta (demo)', role: 'user' as const },
    { email: 'admin@gfloge.demo', password: 'demo-admin-1', displayName: 'Admin (demo)', role: 'admin' as const },
  ]) {
    const hash = await hashPassword(spec.password)
    const [u] = await db
      .insert(users)
      .values({ email: spec.email, passwordHash: hash, displayName: spec.displayName, role: spec.role })
      .returning({ id: users.id, email: users.email, role: users.role })
    inserted.push({ id: u!.id, email: u!.email, role: u!.role as 'admin' | 'user' })
  }
  const martaId = inserted[0]!.id

  // Canonical flights (provider demo), upsert by identity key.
  const def = buildDemoFlights(now)
  const flightsMap = new Map<string, string>()
  const registrationType = new Map(DEMO_AIRCRAFT.map((ac) => [ac.registration, ac.icaoType]))
  for (const f of def) {
    const [row] = await db
      .insert(flights)
      .values({
        airlineId: airlineIdByIcao.get(f.airlineIcao) ?? null,
        flightCode: f.code,
        departureAirportId: airportIdByIata.get(f.depIata)!,
        arrivalAirportId: airportIdByIata.get(f.arrIata)!,
        depDateKey: f.depDateKey,
        scheduledDeparture: f.scheduledDeparture,
        scheduledArrival: f.scheduledArrival,
        status: f.status,
        actualDeparture: ['enroute', 'arrived', 'diverted'].includes(f.status) ? f.scheduledDeparture : null,
        actualArrival: ['arrived', 'diverted'].includes(f.status) ? f.scheduledArrival : null,
        depGate: f.depGate ?? null,
        aircraftRegistration: f.registration ?? null,
        aircraftTypeId: f.registration ? (typeIdByIcao.get(registrationType.get(f.registration) ?? '') ?? null) : null,
        distanceKm: f.distanceKm,
        providerRefs: { [DEMO_PROVIDER_ID]: { dataset: 'demo-2026-11' } },
      })
      .onConflictDoNothing()
      .returning({ id: flights.id })
    const flightId: string | undefined =
      row?.id ??
      (
        await db
          .select({ id: flights.id })
          .from(flights)
          .where(eq(flights.flightCode, f.code))
          .limit(20)
      )[0]?.id
    if (typeof flightId === 'string') {
      flightsMap.set(`${f.code}|${f.depDateKey}|${f.depIata}`, flightId)
    }
  }

  // Demo relations for Marta: track the live ones, one planned trip, and the logbook history.
  const today = now.toISOString().slice(0, 10)
  const relations: Array<{ mapKey: string; role: 'tracked' | 'logged'; loggedState?: 'flown' | 'planned'; personal?: Partial<{ seat: string; cabin: 'none' | 'eco' | 'premium' | 'business' | 'first'; note: string; rating: number }> }> = [
    { mapKey: `LH 371|${today}|MUC`, role: 'tracked' },
    { mapKey: `KL 1840|${today}|AMS`, role: 'tracked' },
    { mapKey: `LH 684|${today}|FRA`, role: 'tracked' },
    { mapKey: `LH 1802|${today}|MUC`, role: 'tracked' },
    { mapKey: `JL 711|${today}|FRA`, role: 'tracked' },
    { mapKey: `OS 434|${today}|VIE`, role: 'tracked' },
  ]
  // Planned personal entries: intent to fly, not yet flown.
  const plannedFlights = [def.find((f) => f.code === 'LH 1802')!, def.find((f) => f.code === 'JL 711')!]
  for (const pf of plannedFlights) {
    relations.push({
      mapKey: `${pf.code}|${pf.depDateKey}|${pf.depIata}`,
      role: 'logged',
      loggedState: 'planned',
      personal: { cabin: 'eco' },
    })
  }

  for (const relation of relations) {
    const flightId = flightsMap.get(relation.mapKey) as string | undefined
    if (!flightId) continue
    await db
      .insert(userFlights)
      .values({
        userId: martaId,
        flightId,
        role: relation.role,
        loggedState: relation.role === 'logged' ? (relation.loggedState ?? 'flown') : null,
        trackedFrom: relation.role === 'tracked' ? now : null,
        source: relation.role === 'tracked' ? 'tracked-auto' : 'manual',
        seat: relation.personal?.seat ?? null,
        cabin: relation.personal?.cabin ?? 'none',
        note: relation.personal?.note ?? null,
        rating: relation.personal?.rating ?? null,
      })
      .onConflictDoNothing()
  }

  // Logbook history: canonical arrived flights + flown personal records.
  const history = buildDemoLogFlights(now)
  for (let i = 0; i < history.length; i++) {
    const f = history[i]!
    const entry = DEMO_LOGBOOK[i]!
    const [row] = await db
      .insert(flights)
      .values({
        airlineId: airlineIdByIcao.get(f.airlineIcao) ?? null,
        flightCode: f.code,
        departureAirportId: airportIdByIata.get(f.depIata)!,
        arrivalAirportId: airportIdByIata.get(f.arrIata)!,
        depDateKey: f.depDateKey,
        scheduledDeparture: f.scheduledDeparture,
        scheduledArrival: f.scheduledArrival,
        status: 'arrived',
        actualDeparture: f.scheduledDeparture,
        actualArrival: f.scheduledArrival,
        aircraftRegistration: f.registration ?? null,
        distanceKm: f.distanceKm,
        providerRefs: { [DEMO_PROVIDER_ID]: { dataset: 'demo-2026-11' } },
      })
      .onConflictDoNothing()
      .returning({ id: flights.id })
    const flightId: string | undefined =
      row?.id ??
      (await db.select({ id: flights.id }).from(flights).where(eq(flights.flightCode, f.code)).limit(20))[0]?.id
    await db
      .insert(userFlights)
      .values({
        userId: martaId,
        flightId,
        role: 'logged',
        loggedState: 'flown',
        seat: entry.seat ?? null,
        cabin: entry.cabin,
        note: entry.note ?? null,
        rating: entry.rating ?? null,
        source: 'manual',
        createdAt: f.scheduledDeparture,
      })
      .onConflictDoNothing()
  }

  // One time-shift alert on the delayed Lokal flight, for AlertBanner demo.
  const klKey = `KL 1840|${now.toISOString().slice(0, 10)}|AMS`
  const klId = flightsMap.get(klKey)
  if (klId) {
    await db.insert(alerts).values({
      flightId: klId,
      type: 'time_shift',
      old: { departure: new Date(now.getTime() - 95 * 60_000).toISOString() },
      new: { departure: new Date(now.getTime() - 60 * 60_000).toISOString() },
    })
  }

  const flightCount = (await db.select({ c: sql<number>`count(*)::int` }).from(flights))[0]!.c
  return { demo: true, users: inserted.length, flights: flightCount }
}

/** Admin bootstrap without demo data. */
export async function seedAdminOnly(
  db: Db,
  email: string,
  password: string,
  displayName: string | undefined
): Promise<void> {
  const hash = await hashPassword(password)
  await db
    .insert(users)
    .values({ email: email.toLowerCase(), passwordHash: hash, displayName: displayName ?? email.split('@')[0] ?? 'Admin', role: 'admin' })
    .onConflictDoNothing()
}
