import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { calendarFeeds, trips, userFlights } from '@gfloge/db'
import type { Db } from '@gfloge/db'
import { newSessionToken, hashToken } from '../crypto.js'
import { flightsById, manualFlightsById } from '../flights-read.js'
import type { FlightRead } from '@gfloge/shared'

function requireUser(req: FastifyRequest): { id: string } {
  return req.user as { id: string }
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function foldLine(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let remaining = line
  chunks.push(remaining.slice(0, 75))
  remaining = remaining.slice(75)
  while (remaining.length > 0) {
    chunks.push(' ' + remaining.slice(0, 74))
    remaining = remaining.slice(74)
  }
  return chunks.join('\r\n')
}

function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function formatDurationMinutes(dep: string, arr: string): string {
  const ms = Date.parse(arr) - Date.parse(dep)
  if (!Number.isFinite(ms) || ms < 0) return ''
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `${h}h ${m}m`
}

export function registerCalendarRoutes(app: FastifyInstance): void {
  const db = app.db

  app.post('/api/v1/calendar/feed', async (req, reply) => {
    const user = requireUser(req)
    // Revoke any existing active feeds so regeneration is clean.
    await db.update(calendarFeeds).set({ revokedAt: new Date() }).where(and(eq(calendarFeeds.userId, user.id), isNull(calendarFeeds.revokedAt)))
    const { token, tokenHash } = newSessionToken()
    await db.insert(calendarFeeds).values({ userId: user.id, tokenHash })
    return { token, url: `/api/v1/calendar/${token}.ics` }
  })

  app.delete('/api/v1/calendar/feed', async (req) => {
    const user = requireUser(req)
    await db.update(calendarFeeds).set({ revokedAt: new Date() }).where(and(eq(calendarFeeds.userId, user.id), isNull(calendarFeeds.revokedAt)))
    return { ok: true }
  })

  app.get('/api/v1/calendar/:token.ics', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = String((req.params as Record<string, string>).token)
    if (!token || token.length < 20) return reply.code(404).send('Not found')
    const tokenHash = hashToken(token)
    const rows = await db.select().from(calendarFeeds).where(and(eq(calendarFeeds.tokenHash, tokenHash), isNull(calendarFeeds.revokedAt))).limit(1)
    const feed = rows[0]
    if (!feed) return reply.code(404).send('Not found')

    const userId = feed.userId
    const relations = await db.select().from(userFlights).where(eq(userFlights.userId, userId))
    const tripIds = [...new Set(relations.map((r) => r.tripId).filter((x): x is string => !!x))]
    const tripRows = tripIds.length ? await db.select().from(trips).where(eq(trips.userId, userId)) : []
    const tripNameById = new Map(tripRows.map((t) => [t.id, t.name]))

    const canonicalIds = relations.map((r) => r.flightId).filter((x): x is string => !!x)
    const manualIds = relations.map((r) => r.manualFlightId).filter((x): x is string => !!x)
    const [canonical, manual] = await Promise.all([flightsById(db, canonicalIds), manualFlightsById(db, userId, manualIds)])

    const now = Date.now()
    const seen = new Set<string>()
    const events: string[] = []
    for (const rel of relations) {
      const key = rel.flightId ?? rel.manualFlightId ?? rel.id
      if (seen.has(key)) continue
      seen.add(key)
      const flight = (rel.flightId ? canonical.get(rel.flightId) : null) ?? (rel.manualFlightId ? manual.get(rel.manualFlightId) : null)
      if (!flight) continue
      // Skip completed flights; include upcoming and cancelled.
      if (flight.status === 'arrived') continue
      const depTime = Date.parse(flight.scheduledDeparture)
      if (Number.isFinite(depTime) && depTime < now - 24 * 60 * 60 * 1000) continue

      const planned = rel.loggedState === 'planned'
      const cancelled = flight.status === 'cancelled' || flight.cancelled
      const status = cancelled ? 'CANCELLED' : planned ? 'TENTATIVE' : 'CONFIRMED'
      const uid = `gfloge-flight-${rel.id}@gfloge`
      const depCode = flight.departure.iata ?? flight.departure.icao ?? ''
      const arrCode = flight.arrival.iata ?? flight.arrival.icao ?? ''
      const tripName = rel.tripId ? tripNameById.get(rel.tripId) : null
      const title = `${flight.flightCode ?? ''} ${depCode}→${arrCode}`.trim()
      const descriptionParts = [
        flight.airline?.name ? `Airline: ${flight.airline.name}` : null,
        flight.aircraft ? `Aircraft: ${flight.aircraft.registration ?? ''} ${flight.aircraft.icaoType ?? ''}`.trim() : null,
        `Status: ${flight.status}`,
        flight.depTerminal || flight.depGate ? `Departure gate: ${[flight.depTerminal, flight.depGate].filter(Boolean).join(' / ')}` : null,
        flight.arrTerminal || flight.arrGate ? `Arrival gate: ${[flight.arrTerminal, flight.arrGate].filter(Boolean).join(' / ')}` : null,
        tripName ? `Trip: ${tripName}` : null,
        flight.distanceKm !== null ? `Distance: ${flight.distanceKm} km` : null,
      ].filter(Boolean) as string[]
      const description = descriptionParts.join('\\n')

      const lines = [
        'BEGIN:VEVENT',
        `UID:${escapeIcs(uid)}`,
        `DTSTAMP:${utcStamp(new Date().toISOString())}`,
        `DTSTART:${utcStamp(flight.scheduledDeparture)}`,
        `DTEND:${utcStamp(flight.actualArrival ?? flight.scheduledArrival)}`,
        `SUMMARY:${escapeIcs(title)}`,
        `DESCRIPTION:${escapeIcs(description)}`,
        `STATUS:${status}`,
        `LOCATION:${escapeIcs(`${flight.departure.name} (${depCode})`)}`,
        'END:VEVENT',
      ]
      events.push(lines.map(foldLine).join('\r\n'))
    }

    const calendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Gfloge//Flight Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Gfloge flights',
      'X-WR-TIMEZONE:UTC',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'

    reply.header('Content-Type', 'text/calendar; charset=utf-8')
    reply.header('Cache-Control', 'private, max-age=300')
    return reply.send(calendar)
  })
}
