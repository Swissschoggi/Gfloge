import type { Db } from '@gfloge/db'
import { refAirports, refAirlines, refAircraftTypes } from '@gfloge/db'
import { DEMO_AIRPORTS, DEMO_AIRLINES, DEMO_AIRCRAFT_TYPES } from '../demo-data.js'

export async function seedReferenceData(db: Db): Promise<void> {
  for (const a of DEMO_AIRPORTS) {
    await db.insert(refAirports).values({ icao: a.icao, iata: a.iata, name: a.name, city: a.city, country: a.country, lat: a.lat, lon: a.lon, tz: a.tz, source: 'seed' }).onConflictDoNothing()
  }
  for (const al of DEMO_AIRLINES) {
    await db.insert(refAirlines).values({ iata: al.iata, icao: al.icao, name: al.name, callsign: al.callsign, country: al.country, source: 'seed' }).onConflictDoNothing()
  }
  for (const t of DEMO_AIRCRAFT_TYPES) {
    await db.insert(refAircraftTypes).values({ icaoType: t.icaoType, iataType: t.iataType, manufacturer: t.manufacturer, name: t.name, source: 'seed' }).onConflictDoNothing()
  }
}
