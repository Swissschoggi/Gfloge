import { eq } from 'drizzle-orm'
import { referenceDatasets, refAirports, refAirlines, refAircraftTypes, refCountries } from '@gfloge/db'
import type { Db } from '@gfloge/db'
import { resolveAirportTimeZoneByCodes } from '../timezone.js'

export async function installReferenceDataset(db: Db, key: string): Promise<void> {
  const [row] = await db.select().from(referenceDatasets).where(eq(referenceDatasets.key, key)).limit(1)
  if (!row) throw new Error('Unknown reference dataset')
  await db.update(referenceDatasets).set({ status: 'downloading', progressBytes: 0, error: null, updatedAt: new Date() }).where(eq(referenceDatasets.key, key))
  try {
    let count = 0
    if (key === 'airports') {
      const res = await fetch(row.sourceUrl)
      if (!res.ok) throw new Error(`Download failed HTTP ${res.status}`)
      const text = await res.text()
      await db.update(referenceDatasets).set({ status: 'verifying', updatedAt: new Date() }).where(eq(referenceDatasets.key, key))
      const lines = text.split(/\r?\n/).filter(Boolean)
      const header = parseCsvLine(lines[0])
      const idx = (name: string) => header.indexOf(name)
      const iIcao = idx('ident'), iIata = idx('iata_code'), iName = idx('name'), iCity = idx('municipality'), iCountry = idx('iso_country'), iLat = idx('latitude_deg'), iLon = idx('longitude_deg'), iTz = idx('tz'), iType = idx('type')
      await db.delete(refAirports)
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i])
        const icao = cols[iIcao]
        if (!icao) continue
        if (iType >= 0 && (cols[iType] === 'closed')) continue
        await db.insert(refAirports).values({
          icao,
          iata: cols[iIata] || null,
          name: cols[iName] || icao,
          city: cols[iCity] || null,
          country: cols[iCountry] || null,
          countryCode: cols[iCountry] || null,
          lat: iLat >= 0 ? Number(cols[iLat]) : null,
          lon: iLon >= 0 ? Number(cols[iLon]) : null,
          tz: resolveAirportTimeZoneByCodes(icao, cols[iIata] || null, iTz >= 0 ? (cols[iTz] || null) : null),
          active: true,
          source: 'ourairports',
        }).onConflictDoNothing()
        count++
      }
    } else if (key === 'airlines') {
      // OurAirports airlines.csv
      const url = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Download failed HTTP ${res.status}`)
      const text = await res.text()
      await db.update(referenceDatasets).set({ status: 'verifying', updatedAt: new Date() }).where(eq(referenceDatasets.key, key))
      const lines = text.split(/\r?\n/).filter(Boolean)
      await db.delete(refAirlines)
      for (let i = 0; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i])
        const name = cols[1]
        if (!name) continue
        await db.insert(refAirlines).values({
          iata: cols[3] && cols[3] !== '\\N' ? cols[3] : null,
          icao: cols[4] && cols[4] !== '\\N' ? cols[4] : null,
          name,
          callsign: cols[5] && cols[5] !== '\\N' ? cols[5] : null,
          country: cols[6] && cols[6] !== '\\N' ? cols[6] : null,
          active: true,
          source: 'openflights',
        })
        count++
      }
    } else if (key === 'aircraft_types') {
      const url = 'https://raw.githubusercontent.com/rikgale/ICAOList/master/ICAOList.csv'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Download failed HTTP ${res.status}`)
      const text = await res.text()
      await db.update(referenceDatasets).set({ status: 'verifying', updatedAt: new Date() }).where(eq(referenceDatasets.key, key))
      const lines = text.split(/\r?\n/).filter(Boolean)
      // skip header
      await db.delete(refAircraftTypes)
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i])
        if (cols.length < 4) continue
        const icao = cols[0].trim()
        if (!icao) continue
        const manModel = cols[3] || ''
        const parts = manModel.split(',')
        const manufacturer = parts[0]?.trim() || null
        const model = parts.slice(1).join(',').trim() || null
        const name = model ? `${manufacturer ?? ''} ${model}`.trim() : (manufacturer ?? icao)
        await db.insert(refAircraftTypes).values({
          icaoType: icao,
          iataType: null,
          manufacturer,
          name: name || icao,
          category: cols[1]?.trim() || null,
          wake: null,
          source: 'rikgale',
        }).onConflictDoNothing()
        count++
      }
    } else if (key === 'countries') {
      const url = 'https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.json'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Download failed HTTP ${res.status}`)
      const data = await res.json() as Array<{ name: string; 'alpha-2': string; 'alpha-3': string }>
      await db.update(referenceDatasets).set({ status: 'verifying', updatedAt: new Date() }).where(eq(referenceDatasets.key, key))
      await db.delete(refCountries)
      for (const c of data) {
        if (!c['alpha-2']) continue
        await db.insert(refCountries).values({
          alpha2: c['alpha-2'],
          alpha3: c['alpha-3'] || null,
          name: c.name,
        }).onConflictDoNothing()
        count++
      }
    } else {
      throw new Error('Unknown reference dataset')
    }
    await db.update(referenceDatasets).set({ status: 'installed', recordCount: count, installedAt: new Date(), error: null, updatedAt: new Date() }).where(eq(referenceDatasets.key, key))
  } catch (e) {
    await db.update(referenceDatasets).set({ status: 'failed', error: e instanceof Error ? e.message : 'Failed', updatedAt: new Date() }).where(eq(referenceDatasets.key, key))
    throw e
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}
