// Historical dataset catalogue. The large files stay on disk; this table
// records the metadata needed to download, verify and query them.

import { historicalDatasets } from '@gfloge/db'
import type { Db } from '@gfloge/db'

export const HISTORICAL_CATALOG = [
  { source: 'mrairspace', datasetKey: '2026_Q3', title: 'Aircraft Flight Schedules 2026 Q3 (detailed)', releaseTag: 'aircraft_flight_schedules_2026_quarter3', assetName: '2026_Q3_detailed_github.parquet', downloadUrl: 'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2026_quarter3/2026_Q3_detailed_github.parquet', sizeBytes: 1026954012, sha256: 'd7cf25ffb128b4ceade6a2b898e6901f829ebf8ac065985fcdaf1787ffa1d1c1', dateStart: '2026-07-01', dateEnd: '2026-09-30', license: 'ODbL', attribution: 'MrAirspace / adsblol initiative' },
  { source: 'mrairspace', datasetKey: '2026_Q2', title: 'Aircraft Flight Schedules 2026 Q2 (detailed)', releaseTag: 'aircraft_flight_schedules_2026_quarter2', assetName: '2026_Q2_detailed_github.parquet', downloadUrl: 'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2026_quarter2/2026_Q2_detailed_github.parquet', sizeBytes: 911949077, sha256: '2bef8bc41b9c5fc0708271859362a10d9a703a15ad57863e7e934bf3738226db', dateStart: '2026-04-01', dateEnd: '2026-06-30', license: 'ODbL', attribution: 'MrAirspace / adsblol initiative' },
  { source: 'mrairspace', datasetKey: '2026_Q1', title: 'Aircraft Flight Schedules 2026 Q1 (detailed)', releaseTag: 'aircraft_flight_schedules_2026_quarter1', assetName: '2026_Q1_detailed_github.parquet', downloadUrl: 'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2026_quarter1/2026_Q1_detailed_github.parquet', sizeBytes: 840340093, sha256: '12ec161c7f1739934053d743625bb48e86b3785c3fcb0549b0e08ae93b1199ce', dateStart: '2026-01-01', dateEnd: '2026-03-31', license: 'ODbL', attribution: 'MrAirspace / adsblol initiative' },
  { source: 'mrairspace', datasetKey: '2025_Q4', title: 'Aircraft Flight Schedules 2025 Q4 (detailed)', releaseTag: 'aircraft_flight_schedules_2025_quarter4', assetName: '2025_Q4_detailed_github.parquet', downloadUrl: 'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2025_quarter4/2025_Q4_detailed_github.parquet', sizeBytes: 871154403, sha256: 'f540e9264292a0476b35302da2249d54c5f4833046258a0d75b7a979c7f884de', dateStart: '2025-10-01', dateEnd: '2025-12-31', license: 'ODbL', attribution: 'MrAirspace / adsblol initiative' },
  { source: 'mrairspace', datasetKey: '2025_Q3', title: 'Aircraft Flight Schedules 2025 Q3 (detailed)', releaseTag: 'aircraft_flight_schedules_2025_quarter3', assetName: '2025_Q3_detailed_github.parquet', downloadUrl: 'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2025_quarter3/2025_Q3_detailed_github.parquet', sizeBytes: 970997726, sha256: 'aa9936affcd07b3ad60b7d166484e4fdf71b52eb4d4085e8b53401f8e3ff889b', dateStart: '2025-07-01', dateEnd: '2025-09-30', license: 'ODbL', attribution: 'MrAirspace / adsblol initiative' },
]

export async function seedCatalog(db: Db): Promise<void> {
  for (const item of HISTORICAL_CATALOG) {
    await db.insert(historicalDatasets).values({
      source: item.source,
      datasetKey: item.datasetKey,
      title: item.title,
      releaseTag: item.releaseTag,
      assetName: item.assetName,
      downloadUrl: item.downloadUrl,
      sizeBytes: item.sizeBytes,
      sha256: item.sha256,
      dateStart: item.dateStart,
      dateEnd: item.dateEnd,
      license: item.license,
      attribution: item.attribution,
      status: 'available',
    }).onConflictDoNothing()
  }
}

export async function listDatasets(db: Db) {
  await seedCatalog(db)
  return db.select().from(historicalDatasets).orderBy(historicalDatasets.dateStart)
}

export function dataDir(env = process.env): string {
  return env.GF_HISTORICAL_DATA_DIR ?? env.GF_DATA_DIR ?? '/data'
}
