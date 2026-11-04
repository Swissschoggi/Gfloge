import type { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { manualFlights, userFlights, importBatches } from '@gfloge/db'
import { distanceKm, localToUtc, utcDateKey } from '@gfloge/shared'
import { resolveCanonicalAirport, resolveCanonicalAirline, resolveCanonicalAircraftType } from '../reference/search.js'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 5000

type ParsedRow = {
  rowIndex: number
  flightNumber?: string
  airline?: string
  departureIata?: string
  departureIcao?: string
  arrivalIata?: string
  arrivalIcao?: string
  departureLocal?: string
  arrivalLocal?: string
  aircraftType?: string
  registration?: string
  seat?: string
  cabin?: string
  note?: string
  status?: string
  sourceRecordId?: string
  raw: Record<string, string>
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += char
    } else {
      if (char === '"') inQuotes = true
      else if (char === ',') { current.push(field); field = '' }
      else if (char === '\n') { current.push(field); rows.push(current); current = []; field = '' }
      else if (char === '\r') { /* skip */ }
      else field += char
    }
  }
  if (field || current.length) { current.push(field); rows.push(current) }
  return rows.filter((row) => row.some((cell) => cell.trim() !== ''))
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalizeHeader)
  for (const candidate of candidates) {
    const index = normalized.indexOf(normalizeHeader(candidate))
    if (index >= 0) return index
  }
  return -1
}

function parseGenericCsv(text: string): { headers: string[]; rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = []
  const allRows = parseCsv(text)
  if (allRows.length === 0) return { headers: [], rows: [], errors: ['The file is empty.'] }
  const headers = allRows[0]
  const dataRows = allRows.slice(1)
  if (dataRows.length > MAX_ROWS) return { headers, rows: [], errors: [`The file contains ${dataRows.length} rows; the maximum is ${MAX_ROWS}.`] }

  const idx = (names: string[]) => findColumn(headers, names)
  const iFlight = idx(['flightnumber', 'flight', 'flightno', 'flightnum', 'callsign'])
  const iAirline = idx(['airline', 'airlinecode', 'carrier', 'airlineiata', 'airlineicao'])
  const iDep = idx(['departure', 'dep', 'origin', 'from', 'departureairport', 'departureiata', 'departureicao', 'originiata', 'originicao'])
  const iArr = idx(['arrival', 'arr', 'destination', 'to', 'arrivalairport', 'arrivaliata', 'arrivalicao', 'destinationiata', 'destinationicao'])
  const iDepTime = idx(['departuretime', 'deptime', 'departurelocal', 'scheduleddeparture', 'deputctime', 'departureutc'])
  const iArrTime = idx(['arrivaltime', 'arrtime', 'arrivallocal', 'scheduledarrival', 'arrutctime', 'arrivalutc'])
  const iDate = idx(['date', 'departuredate', 'flightdate', 'traveldate'])
  const iAircraft = idx(['aircraft', 'aircrafttype', 'aircraftmodel', 'equipment'])
  const iReg = idx(['registration', 'reg', 'tail', 'tailnumber', 'aircraftregistration'])
  const iSeat = idx(['seat', 'seatnumber'])
  const iCabin = idx(['cabin', 'cabinclass', 'class'])
  const iNote = idx(['note', 'notes', 'comment', 'comments'])
  const iStatus = idx(['status', 'flightstatus'])

  const rows: ParsedRow[] = []
  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i]
    const row: ParsedRow = { rowIndex: i + 2, raw: {} }
    headers.forEach((header, index) => { row.raw[header] = cells[index] ?? '' })
    if (iFlight >= 0 && cells[iFlight]?.trim()) row.flightNumber = cells[iFlight].trim()
    if (iAirline >= 0 && cells[iAirline]?.trim()) row.airline = cells[iAirline].trim()
    if (iDep >= 0 && cells[iDep]?.trim()) {
      const val = cells[iDep].trim().toUpperCase()
      if (val.length === 3) row.departureIata = val
      else if (val.length === 4) row.departureIcao = val
      else row.departureIata = val.slice(0, 3)
    }
    if (iArr >= 0 && cells[iArr]?.trim()) {
      const val = cells[iArr].trim().toUpperCase()
      if (val.length === 3) row.arrivalIata = val
      else if (val.length === 4) row.arrivalIcao = val
      else row.arrivalIata = val.slice(0, 3)
    }
    if (iDate >= 0 && cells[iDate]?.trim()) {
      const dateVal = cells[iDate].trim()
      if (iDepTime >= 0 && cells[iDepTime]?.trim()) row.departureLocal = `${dateVal}T${cells[iDepTime].trim()}`
      else row.departureLocal = `${dateVal}T00:00`
      if (iArrTime >= 0 && cells[iArrTime]?.trim()) row.arrivalLocal = `${dateVal}T${cells[iArrTime].trim()}`
    } else {
      if (iDepTime >= 0 && cells[iDepTime]?.trim()) row.departureLocal = cells[iDepTime].trim()
      if (iArrTime >= 0 && cells[iArrTime]?.trim()) row.arrivalLocal = cells[iArrTime].trim()
    }
    if (iAircraft >= 0 && cells[iAircraft]?.trim()) row.aircraftType = cells[iAircraft].trim()
    if (iReg >= 0 && cells[iReg]?.trim()) row.registration = cells[iReg].trim()
    if (iSeat >= 0 && cells[iSeat]?.trim()) row.seat = cells[iSeat].trim()
    if (iCabin >= 0 && cells[iCabin]?.trim()) row.cabin = cells[iCabin].trim()
    if (iNote >= 0 && cells[iNote]?.trim()) row.note = cells[iNote].trim()
    if (iStatus >= 0 && cells[iStatus]?.trim()) row.status = cells[iStatus].trim()
    if (iDep < 0 && iArr < 0 && iFlight < 0) {
      errors.push(`Row ${i + 2}: no recognizable flight data columns found.`)
      continue
    }
    rows.push(row)
  }
  return { headers, rows, errors }
}

function parseOpenFlightsCsv(text: string): { headers: string[]; rows: ParsedRow[]; errors: string[] } {
  const cleaned = text.replace(/^\uFEFF/, '')
  const generic = parseGenericCsv(cleaned)
  const rows = generic.rows.map((row) => {
    if (row.departureLocal && row.departureLocal.includes(' ')) {
      const parts = row.departureLocal.split(' ')
      if (parts.length === 2 && /^\d{2}:\d{2}/.test(parts[1])) {
        row.departureLocal = `${parts[0]}T${parts[1].slice(0, 5)}`
      }
    }
    if (row.cabin) {
      const cabinMap: Record<string, string> = { F: 'first', C: 'business', P: 'premium', Y: 'eco', B: 'business' }
      row.cabin = cabinMap[row.cabin.toUpperCase()] ?? row.cabin
    }
    const seatType = (row.raw['Seat_Type'] || row.raw['seat_type'] || '').toUpperCase()
    if (seatType && { W: 'Window', A: 'Aisle', M: 'Middle' }[seatType]) {
      const label = { W: 'Window', A: 'Aisle', M: 'Middle' }[seatType]!
      row.note = row.note ? `${row.note} (${label} seat)` : `${label} seat`
    }
    const reason = (row.raw['Reason'] || row.raw['reason'] || '').toUpperCase()
    if (reason && { B: 'Business', L: 'Personal', C: 'Crew', O: 'Other' }[reason]) {
      const label = { B: 'Business', L: 'Personal', C: 'Crew', O: 'Other' }[reason]!
      row.note = row.note ? `${row.note} · ${label}` : label
    }
    const plane = (row.raw['Plane'] || row.raw['plane'] || '').trim()
    if (plane && !row.aircraftType) row.aircraftType = plane
    return row
  })
  return { headers: generic.headers, rows, errors: generic.errors }
}

function parseFlightyCsv(text: string): { rows: ParsedRow[]; errors: string[] } {
  const allRows = parseCsv(text.replace(/^\uFEFF/, ''))
  if (allRows.length === 0) return { rows: [], errors: ['The file is empty.'] }
  const headers = allRows[0]
  const dataRows = allRows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ''))
  if (dataRows.length > MAX_ROWS) return { rows: [], errors: [`The file contains ${dataRows.length} rows; the maximum is ${MAX_ROWS}.`] }

  const col = (name: string) => headers.indexOf(name)
  const get = (cells: string[], name: string) => {
    const idx = col(name)
    return idx >= 0 ? (cells[idx] ?? '').trim() : ''
  }

  const errors: string[] = []
  const rows: ParsedRow[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i]
    const raw: Record<string, string> = {}
    headers.forEach((header, index) => { raw[header] = cells[index] ?? '' })

    const date = get(cells, 'Date')
    const airline = get(cells, 'Airline')
    const flightNumber = get(cells, 'Flight')
    const from = get(cells, 'From').toUpperCase()
    const to = get(cells, 'To').toUpperCase()
    const canceled = get(cells, 'Canceled')
    const divertedTo = get(cells, 'Diverted To').toUpperCase()
    const schedGateDep = get(cells, 'Gate Departure (Scheduled)')
    const schedGateArr = get(cells, 'Gate Arrival (Scheduled)')
    const aircraftType = get(cells, 'Aircraft Type Name')
    const tailNumber = get(cells, 'Tail Number')
    const seat = get(cells, 'Seat')
    const cabinClass = get(cells, 'Cabin Class')
    const notes = get(cells, 'Notes')
    const flightFlightyId = get(cells, 'Flight Flighty ID')

    if (!from || !to) {
      errors.push(`Row ${i + 2}: missing departure or arrival airport.`)
      continue
    }

    const cabinMap: Record<string, string> = { economy: 'eco', premiumeconomy: 'premium', business: 'business', first: 'first' }
    const cabinNormalized = cabinClass ? (cabinMap[cabinClass.toLowerCase().replace(/[^a-z]/g, '')] ?? cabinClass) : undefined

    const isCancelled = canceled.toLowerCase() === 'true' || canceled.toLowerCase() === 'yes' || canceled === '1'

    const arrivalAirport = divertedTo || to

    // Flighty timestamps are ISO local (YYYY-MM-DDTHH:MM or with seconds).
    // Use them directly when available; fall back to date + midnight.
    const depLocal = schedGateDep && schedGateDep.includes('T') ? schedGateDep.slice(0, 16) : (date ? `${date}T00:00` : undefined)
    const arrLocal = schedGateArr && schedGateArr.includes('T') ? schedGateArr.slice(0, 16) : (date && schedGateArr ? schedGateArr : undefined)

    const row: ParsedRow = {
      rowIndex: i + 2,
      flightNumber: flightNumber || undefined,
      airline: airline || undefined,
      departureIata: from.length === 3 ? from : undefined,
      departureIcao: from.length === 4 ? from : undefined,
      arrivalIata: arrivalAirport.length === 3 ? arrivalAirport : undefined,
      arrivalIcao: arrivalAirport.length === 4 ? arrivalAirport : undefined,
      departureLocal: depLocal,
      arrivalLocal: arrLocal,
      aircraftType: aircraftType || undefined,
      registration: tailNumber || undefined,
      seat: seat || undefined,
      cabin: cabinNormalized,
      note: notes || undefined,
      status: isCancelled ? 'cancelled' : undefined,
      sourceRecordId: flightFlightyId || undefined,
      raw,
    }

    // Store operational timestamps and extra fields in raw (already there)
    // The commit endpoint will extract them from raw
    rows.push(row)
  }

  if (rows.length === 0 && errors.length === 0) errors.push('No flight records found.')
  return { rows, errors }
}

function parseIcsText(text: string): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = []
  const rows: ParsedRow[] = []
  const lines = text.split(/\r?\n/)
  let inEvent = false
  let event: Record<string, string> = {}
  const events: Record<string, string>[] = []
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; event = {}; continue }
    if (line === 'END:VEVENT') { if (inEvent) events.push(event); inEvent = false; continue }
    if (!inEvent) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).split(';')[0].toUpperCase()
    const value = line.slice(colonIdx + 1)
    event[key] = event[key] ? event[key] + ' ' + value : value
  }
  for (const ev of events) {
    const summary = ev['SUMMARY'] ?? ''
    const description = ev['DESCRIPTION'] ?? ''
    const combined = `${summary} ${description}`
    const flightMatch = combined.match(/(?:flight|fl)\s*[:#]?\s*([A-Z]{2,3}\s*\d{1,4})/i)
    const flightNumber = flightMatch ? flightMatch[1].replace(/\s+/g, ' ').trim() : undefined
    const airports = combined.match(/\b([A-Z]{3})\b/g) ?? []
    const departure = airports.length >= 1 ? airports[0] : undefined
    const arrival = airports.length >= 2 ? airports[1] : undefined
    const dtStart = ev['DTSTART'] ?? ''
    const dtEnd = ev['DTEND'] ?? ''
    let departureLocal: string | undefined
    let arrivalLocal: string | undefined
    if (dtStart) {
      const cleaned = dtStart.replace(/[^0-9T]/g, '')
      if (cleaned.length >= 8) {
        const date = `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`
        const time = cleaned.length >= 13 ? `${cleaned.slice(9, 11)}:${cleaned.slice(11, 13)}` : '00:00'
        departureLocal = `${date}T${time}`
      }
    }
    if (dtEnd) {
      const cleaned = dtEnd.replace(/[^0-9T]/g, '')
      if (cleaned.length >= 8) {
        const date = `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`
        const time = cleaned.length >= 13 ? `${cleaned.slice(9, 11)}:${cleaned.slice(11, 13)}` : '00:00'
        arrivalLocal = `${date}T${time}`
      }
    }
    if (!departure && !arrival && !flightNumber) {
      errors.push(`VEVENT "${summary.slice(0, 60)}" could not be identified as a flight.`)
      continue
    }
    rows.push({
      rowIndex: rows.length + 2,
      flightNumber,
      departureIata: departure,
      arrivalIata: arrival,
      departureLocal,
      arrivalLocal,
      raw: ev,
    })
  }
  if (events.length === 0) errors.push('No VEVENT entries found in this ICS file.')
  return { rows, errors }
}

export function registerImportRoutes(app: FastifyInstance): void {
  const db = app.db

  app.post('/api/v1/import/preview', async (req, reply) => {
    const body = req.body as { content?: string; format?: string; fileName?: string }
    if (!body?.content || typeof body.content !== 'string') {
      return reply.code(400).send({ error: { code: 'validation', message: 'Upload file content is required.' } })
    }
    if (body.content.length > MAX_FILE_BYTES) {
      return reply.code(413).send({ error: { code: 'too_large', message: 'File exceeds 5 MB.' } })
    }
    const format = body.format ?? 'auto'
    let parsed: { headers: string[]; rows: ParsedRow[]; errors: string[] }
    if (format === 'ics') {
      const result = parseIcsText(body.content)
      parsed = { headers: ['VEVENT'], rows: result.rows, errors: result.errors }
    } else if (format === 'flighty') {
      const result = parseFlightyCsv(body.content)
      parsed = { headers: parseCsv(body.content.replace(/^\uFEFF/, ''))[0] ?? [], rows: result.rows, errors: result.errors }
    } else if (format === 'openflights') {
      const result = parseOpenFlightsCsv(body.content)
      parsed = { headers: result.headers, rows: result.rows, errors: result.errors }
    } else {
      parsed = parseGenericCsv(body.content)
    }
    return {
      fileName: body.fileName ?? null,
      format: format === 'auto' ? 'generic' : format,
      headers: parsed.headers,
      totalRows: parsed.rows.length,
      errors: parsed.errors,
      preview: parsed.rows.map((row) => ({
        rowIndex: row.rowIndex,
        flightNumber: row.flightNumber ?? null,
        airline: row.airline ?? null,
        departure: row.departureIata ?? row.departureIcao ?? null,
        arrival: row.arrivalIata ?? row.arrivalIcao ?? null,
        departureTime: row.departureLocal ?? null,
        arrivalTime: row.arrivalLocal ?? null,
        aircraft: row.aircraftType ?? null,
        registration: row.registration ?? null,
        seat: row.seat ?? null,
        cabin: row.cabin ?? null,
      })),
    }
  })

  app.post('/api/v1/import/commit', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const body = req.body as { content?: string; format?: string; fileName?: string; selectedRows?: number[] }
    if (!body?.content || typeof body.content !== 'string') {
      return reply.code(400).send({ error: { code: 'validation', message: 'Upload file content is required.' } })
    }
    if (body.content.length > MAX_FILE_BYTES) {
      return reply.code(413).send({ error: { code: 'too_large', message: 'File exceeds 5 MB.' } })
    }
    let parsed: { headers: string[]; rows: ParsedRow[]; errors: string[] }
    if (body.format === 'ics') {
      const result = parseIcsText(body.content)
      parsed = { headers: ['VEVENT'], rows: result.rows, errors: result.errors }
    } else if (body.format === 'flighty') {
      const result = parseFlightyCsv(body.content)
      parsed = { headers: parseCsv(body.content.replace(/^\uFEFF/, ''))[0] ?? [], rows: result.rows, errors: result.errors }
    } else if (body.format === 'openflights') {
      const result = parseOpenFlightsCsv(body.content)
      parsed = { headers: result.headers, rows: result.rows, errors: result.errors }
    } else {
      parsed = parseGenericCsv(body.content)
    }
    if (parsed.rows.length === 0) {
      return reply.code(400).send({ error: { code: 'validation', message: 'No flight records found in the file.' } })
    }

    const selectedSet = body.selectedRows ? new Set(body.selectedRows) : null
    const rowsToImport = selectedSet ? parsed.rows.filter((row) => selectedSet.has(row.rowIndex)) : parsed.rows

    const [batch] = await db.insert(importBatches).values({
      userId,
      sourceFormat: body.format ?? 'generic',
      fileName: body.fileName ?? null,
      totalRows: parsed.rows.length,
      status: 'processing',
    }).returning({ id: importBatches.id })

    const batchId = batch!.id
    let imported = 0
    let enriched = 0
    let skipped = 0
    let failed = 0
    const failures: Array<{ row: number; reason: string }> = []

    for (const row of rowsToImport) {
      try {
        const depAirport = await resolveCanonicalAirport(db, row.departureIata ?? row.departureIcao ?? '')
        const arrAirport = await resolveCanonicalAirport(db, row.arrivalIata ?? row.arrivalIcao ?? '')
        if (!depAirport || !arrAirport) {
          failures.push({ row: row.rowIndex, reason: 'Airport not found in reference data.' })
          failed++
          continue
        }
        const airportTz = depAirport.tz ?? 'UTC'
        let depUtc: Date
        if (row.departureLocal) {
          try { depUtc = localToUtc(row.departureLocal, airportTz) } catch { depUtc = new Date(row.departureLocal) }
        } else {
          failures.push({ row: row.rowIndex, reason: 'Missing departure time.' })
          failed++
          continue
        }
        let arrUtc: Date | null = null
        if (row.arrivalLocal) {
          const arrTz = arrAirport.tz ?? 'UTC'
          try { arrUtc = localToUtc(row.arrivalLocal, arrTz) } catch { arrUtc = new Date(row.arrivalLocal) }
        }

        const existing = await db.select({ id: manualFlights.id }).from(manualFlights)
          .where(and(eq(manualFlights.userId, userId), eq(manualFlights.depDateKey, utcDateKey(depUtc)), eq(manualFlights.departureAirportId, depAirport.id), eq(manualFlights.arrivalAirportId, arrAirport.id)))
          .limit(1)
        if (existing.length > 0 && row.flightNumber) {
          const existingFlight = await db.select({ flightNumber: manualFlights.flightNumber }).from(manualFlights).where(eq(manualFlights.id, existing[0].id)).limit(1)
          if (existingFlight[0]?.flightNumber === row.flightNumber) {
            skipped++
            continue
          }
        }

        let airlineId: string | null = null
        if (row.airline) {
          const resolved = await resolveCanonicalAirline(db, row.airline)
          airlineId = resolved?.id ?? null
        }
        let aircraftTypeId: string | null = null
        if (row.aircraftType) {
          const resolved = await resolveCanonicalAircraftType(db, row.aircraftType)
          aircraftTypeId = resolved?.id ?? null
        }

        const raw = row.raw ?? {}
        const depTerminal = raw['Dep Terminal']?.trim() || raw['dep_terminal']?.trim() || null
        const depGate = raw['Dep Gate']?.trim() || raw['dep_gate']?.trim() || null
        const arrTerminal = raw['Arr Terminal']?.trim() || raw['arr_terminal']?.trim() || null
        const arrGate = raw['Arr Gate']?.trim() || raw['arr_gate']?.trim() || null
        const pnr = raw['PNR']?.trim() || raw['pnr']?.trim() || null
        const seatType = raw['Seat Type']?.trim() || raw['seat_type']?.trim() || null
        const flightReason = raw['Flight Reason']?.trim() || raw['flight_reason']?.trim() || null
        const cancelled = raw['Canceled']?.trim()?.toLowerCase() === 'true' || raw['Canceled']?.trim()?.toLowerCase() === 'yes' || raw['Canceled']?.trim() === '1'
        const divertedTo = (raw['Diverted To']?.trim() || raw['diverted_to']?.trim() || '').toUpperCase()
        let divertedAirportId: string | null = null
        if (divertedTo) {
          const resolved = await resolveCanonicalAirport(db, divertedTo.length === 3 ? divertedTo : divertedTo.slice(0, 3))
          divertedAirportId = resolved?.id ?? null
        }

        function parseTs(value: string | undefined): Date | null {
          if (!value?.trim()) return null
          try { return localToUtc(value.trim().replace(' ', 'T').slice(0, 16), airportTz) } catch { return null }
        }
        const scheduledGateDeparture = parseTs(raw['Gate Departure (Scheduled)'])
        const actualGateDeparture = parseTs(raw['Gate Departure (Actual)'])
        const scheduledTakeoff = parseTs(raw['Take off (Scheduled)'])
        const actualTakeoff = parseTs(raw['Take off (Actual)'])
        const scheduledLanding = parseTs(raw['Landing (Scheduled)'])
        const actualLanding = parseTs(raw['Landing (Actual)'])
        const scheduledGateArrival = parseTs(raw['Gate Arrival (Scheduled)'])
        const actualGateArrival = parseTs(raw['Gate Arrival (Actual)'])

        const [created] = await db.insert(manualFlights).values({
          userId,
          airlineId,
          flightNumber: row.flightNumber ?? null,
          departureAirportId: depAirport.id,
          arrivalAirportId: arrAirport.id,
          scheduledDeparture: depUtc,
          scheduledArrival: arrUtc ?? depUtc,
          actualDeparture: actualGateDeparture ?? actualTakeoff ?? null,
          actualArrival: actualLanding ?? actualGateArrival ?? null,
          scheduledGateDeparture,
          actualGateDeparture,
          scheduledTakeoff,
          actualTakeoff,
          scheduledLanding,
          actualLanding,
          scheduledGateArrival,
          actualGateArrival,
          cancelled,
          divertedToAirportId: divertedAirportId,
          depTerminal,
          depGate,
          arrTerminal,
          arrGate,
          aircraftRegistration: row.registration ?? null,
          seat: row.seat ?? null,
          seatType,
          cabin: (row.cabin?.toLowerCase() as 'none' | 'eco' | 'premium' | 'business' | 'first') ?? 'none',
          bookingReference: pnr,
          flightReason,
          note: row.note ?? null,
          sourceType: 'imported',
          sourceName: body.format ?? 'generic',
          sourceRecordId: row.sourceRecordId ?? null,
          importBatchId: batchId,
          importedAt: new Date(),
          depDateKey: utcDateKey(depUtc),
          distanceKm: Math.round(distanceKm(depAirport, arrAirport)),
        }).returning({ id: manualFlights.id })

        await db.insert(userFlights).values({
          userId,
          manualFlightId: created!.id,
          role: 'logged',
          loggedState: 'flown',
          source: 'import',
          importBatchId: batchId,
          seat: row.seat ?? null,
          cabin: (row.cabin?.toLowerCase() as 'none' | 'eco' | 'premium' | 'business' | 'first') ?? 'none',
          note: row.note ?? null,
        })

        imported++
        if (airlineId || aircraftTypeId) enriched++
      } catch (cause) {
        failures.push({ row: row.rowIndex, reason: cause instanceof Error ? cause.message : 'Unknown error' })
        failed++
      }
    }

    await db.update(importBatches).set({
      importedCount: imported,
      enrichedCount: enriched,
      skippedCount: skipped,
      failedCount: failed,
      status: 'completed',
      completedAt: new Date(),
    }).where(eq(importBatches.id, batchId))

    return { batchId, totalRows: parsed.rows.length, imported, enriched, skipped, failed, failures }
  })
}

// requireUser is inlined as (req.user as { id: string })