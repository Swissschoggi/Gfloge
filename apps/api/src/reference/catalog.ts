import type { Db } from '@gfloge/db'
import { referenceDatasets } from '@gfloge/db'

export const REFERENCE_CATALOG = [
  {
    key: 'airports',
    name: 'Airports',
    description: 'Global airport reference (ICAO/IATA, name, city, country, coordinates, timezone).',
    source: 'OurAirports',
    sourceUrl: 'https://davidmegginson.github.io/ourairports-data/airports.csv',
    license: 'Public domain (OurAirports)',
    attribution: 'OurAirports (https://ourairports.com)',
  },
  {
    key: 'airlines',
    name: 'Airlines',
    description: 'Airline IATA/ICAO codes, names, callsigns and countries.',
    source: 'OurAirports',
    sourceUrl: 'https://davidmegginson.github.io/ourairports-data/airlines.csv',
    license: 'Public domain / open data',
    attribution: 'See source',
  },
  {
    key: 'aircraft_types',
    name: 'Aircraft types',
    description: 'ICAO type designators, manufacturers and models.',
    source: 'rikgale/ICAOList',
    sourceUrl: 'https://raw.githubusercontent.com/rikgale/ICAOList/master/ICAOList.csv',
    license: 'Public domain / open data',
    attribution: 'See source',
  },
  {
    key: 'countries',
    name: 'Countries',
    description: 'ISO country codes and names.',
    source: 'lukes/ISO-3166',
    sourceUrl: 'https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.json',
    license: 'Public domain / open data',
    attribution: 'See source',
  },
]

export async function seedReferenceCatalog(db: Db): Promise<void> {
  for (const item of REFERENCE_CATALOG) {
    await db.insert(referenceDatasets).values({
      key: item.key,
      name: item.name,
      description: item.description,
      source: item.source,
      sourceUrl: item.sourceUrl,
      license: item.license,
      attribution: item.attribution,
      status: 'installed',
      recordCount: item.source === 'seed' ? 0 : null,
      installedAt: item.source === 'seed' ? new Date() : null,
    }).onConflictDoUpdate({ target: referenceDatasets.key, set: { name: item.name, description: item.description, source: item.source, sourceUrl: item.sourceUrl, license: item.license, attribution: item.attribution, updatedAt: new Date() } })
  }
}

export async function listReferenceDatasets(db: Db) {
  await seedReferenceCatalog(db)
  const { referenceDatasets: t } = await import('@gfloge/db')
  return db.select().from(t)
}
