import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { instanceSettings, pushSubscriptions, users, userFlights, flights, manualFlights, notificationDeliveries, flightNotificationState } from '@gfloge/db'
import type { Db } from '@gfloge/db'
import webpush from 'web-push'
import { flightsById, manualFlightsById } from '../flights-read.js'

function requireUser(req: FastifyRequest): { id: string } {
  return req.user as { id: string }
}

async function getVapidKeys(db: Db): Promise<{ publicKey: string; privateKey: string }> {
  const rows = await db.select().from(instanceSettings).where(eq(instanceSettings.key, 'vapid')).limit(1)
  const existing = rows[0]?.value as { publicKey?: string; privateKey?: string } | undefined
  if (existing?.publicKey && existing?.privateKey) return { publicKey: existing.publicKey, privateKey: existing.privateKey }
  const keys = webpush.generateVAPIDKeys()
  await db.insert(instanceSettings).values({ key: 'vapid', value: { publicKey: keys.publicKey, privateKey: keys.privateKey } }).onConflictDoUpdate({ target: instanceSettings.key, set: { value: { publicKey: keys.publicKey, privateKey: keys.privateKey }, updatedAt: new Date() } })
  return keys
}

export function registerPushRoutes(app: FastifyInstance): void {
  const db = app.db

  app.get('/api/v1/push/vapid-public-key', async () => {
    const keys = await getVapidKeys(db)
    return { publicKey: keys.publicKey }
  })

  app.post('/api/v1/push/subscriptions', async (req, reply) => {
    const user = requireUser(req)
    const parsed = z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      userAgent: z.string().max(300).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: { code: 'validation', message: 'Invalid subscription.' } })
    await db.insert(pushSubscriptions).values({
      userId: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: parsed.data.userAgent ?? null,
    }).onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, lastUsedAt: new Date(), failureCount: 0 },
    })
    return { ok: true }
  })

  app.delete('/api/v1/push/subscriptions', async (req, reply) => {
    const user = requireUser(req)
    const parsed = z.object({ endpoint: z.string().url() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: { code: 'validation', message: 'endpoint is required.' } })
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, parsed.data.endpoint), eq(pushSubscriptions.userId, user.id)))
    return { ok: true }
  })

  app.post('/api/v1/push/test', async (req, reply) => {
    const user = requireUser(req)
    const keys = await getVapidKeys(db)
    webpush.setVapidDetails('mailto:admin@gfloge.local', keys.publicKey, keys.privateKey)
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id))
    let sent = 0
    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: 'Gfloge test', body: 'Notifications are working.' }))
        sent++
      } catch (err) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
      }
    }
    return { sent }
  })

  // Background notifier: simple periodic scan.
  const interval = setInterval(() => {
    void runNotificationCycle(db).catch(() => {})
  }, 5 * 60 * 1000)
  app.addHook('onClose', async () => clearInterval(interval))
}

async function runNotificationCycle(db: Db) {
  const lockRes = await db.execute(sql`SELECT pg_try_advisory_lock(987654321) AS locked`)
  const locked = (lockRes.rows[0] as { locked?: boolean } | undefined)?.locked
  if (!locked) return
  try {
    const rows = await db.select().from(instanceSettings).where(eq(instanceSettings.key, 'vapid')).limit(1)
    const v = rows[0]?.value as { publicKey?: string; privateKey?: string } | undefined
    if (!v?.publicKey || !v?.privateKey) return
    webpush.setVapidDetails('mailto:admin@gfloge.local', v.publicKey, v.privateKey)

    const subs = await db.select().from(pushSubscriptions)
    const userIds = [...new Set(subs.map((s) => s.userId))]
    for (const userId of userIds) {
      const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
      const prefs = (userRows[0]?.notificationPrefs as Record<string, boolean> | null) ?? {}
      const pref = (key: string) => (prefs[key] === undefined ? true : prefs[key] === true)

      const relations = await db.select().from(userFlights).where(eq(userFlights.userId, userId))
      const canonicalIds = relations.map((r) => r.flightId).filter((x): x is string => !!x)
      const manualIds = relations.map((r) => r.manualFlightId).filter((x): x is string => !!x)
      const [canonical, manual] = await Promise.all([flightsById(db, canonicalIds), manualFlightsById(db, userId, manualIds)])

      for (const rel of relations) {
        const flight = (rel.flightId ? canonical.get(rel.flightId) : null) ?? (rel.manualFlightId ? manual.get(rel.manualFlightId) : null)
        if (!flight) continue
        if (flight.status === 'arrived') continue

        // previous state
        const stateRows = await db.select().from(flightNotificationState).where(and(eq(flightNotificationState.userId, userId), eq(flightNotificationState.userFlightId, rel.id))).limit(1)
        const prev = stateRows[0]
        const changes: Array<{ kind: string; title: string; body: string; prefKey: string }> = []
        if (prev) {
          if (prev.status !== flight.status) {
            if (flight.status === 'cancelled') changes.push({ kind: 'cancellation', title: `Flight cancelled: ${flight.flightCode}`, body: `${flight.departure.iata ?? ''} → ${flight.arrival.iata ?? ''}`, prefKey: 'cancellations' })
            if (flight.status === 'diverted') changes.push({ kind: 'diversion', title: `Flight diverted: ${flight.flightCode}`, body: flight.divertedTo ?? '', prefKey: 'diversion' })
          }
          if (prev.scheduledDeparture?.toISOString() !== flight.scheduledDeparture) changes.push({ kind: 'departure_change', title: `Departure changed: ${flight.flightCode}`, body: `New departure ${flight.scheduledDeparture}`, prefKey: 'delays' })
          if (prev.scheduledArrival?.toISOString() !== flight.scheduledArrival) changes.push({ kind: 'arrival_change', title: `Arrival changed: ${flight.flightCode}`, body: `New arrival ${flight.scheduledArrival}`, prefKey: 'arrival' })
          if (prev.depGate !== flight.depGate) changes.push({ kind: 'gate_change', title: `Gate changed: ${flight.flightCode}`, body: `Departure gate ${flight.depGate ?? 'updated'}`, prefKey: 'gates' })
          if (prev.depTerminal !== flight.depTerminal || prev.arrTerminal !== flight.arrTerminal) changes.push({ kind: 'terminal_change', title: `Terminal changed: ${flight.flightCode}`, body: `Terminals updated`, prefKey: 'terminal' })
          if (prev.arrGate !== flight.arrGate) changes.push({ kind: 'gate_change', title: `Arrival gate changed: ${flight.flightCode}`, body: `Arrival gate ${flight.arrGate ?? 'updated'}`, prefKey: 'gates' })
        }

        for (const c of changes) {
          if (!pref(c.prefKey === 'delays' ? 'delays' : c.prefKey === 'gates' ? 'gates' : c.prefKey === 'cancellations' ? 'cancellations' : c.prefKey === 'arrival' ? 'arrival' : c.prefKey === 'terminal' ? 'terminal' : c.prefKey === 'diversion' ? 'diversion' : 'delays')) continue
          const dedupKey = `${c.kind}_${rel.id}_${flight.scheduledDeparture}_${flight.scheduledArrival}_${flight.depGate ?? ''}_${flight.depTerminal ?? ''}_${flight.arrGate ?? ''}_${flight.arrTerminal ?? ''}_${flight.status}`
          await sendIfNew(db, userId, rel.id, c.kind, dedupKey, c.title, c.body)
        }

        // update state
        if (prev) {
          await db.update(flightNotificationState).set({
            status: flight.status,
            scheduledDeparture: new Date(flight.scheduledDeparture),
            scheduledArrival: new Date(flight.scheduledArrival),
            depGate: flight.depGate,
            depTerminal: flight.depTerminal,
            arrGate: flight.arrGate,
            arrTerminal: flight.arrTerminal,
            updatedAt: new Date(),
          }).where(eq(flightNotificationState.id, prev.id))
        } else {
          await db.insert(flightNotificationState).values({
            userId,
            userFlightId: rel.id,
            status: flight.status,
            scheduledDeparture: new Date(flight.scheduledDeparture),
            scheduledArrival: new Date(flight.scheduledArrival),
            depGate: flight.depGate,
            depTerminal: flight.depTerminal,
            arrGate: flight.arrGate,
            arrTerminal: flight.arrTerminal,
          })
        }

        // reminders
        const dep = Date.parse(flight.scheduledDeparture)
        const now = Date.now()
        if (Number.isFinite(dep)) {
          for (const hours of [24, 3]) {
            const keyName = hours === 24 ? 'reminder24h' : 'reminder3h'
            if (!pref(keyName)) continue
            const target = hours * 3600000
            // send if within window or up to 60 min overdue (downtime policy)
            if (dep - now <= target && dep - now >= -60 * 60000) {
              const dedupKey = `reminder_${hours}h_${rel.id}_${flight.scheduledDeparture}`
              await sendIfNew(db, userId, rel.id, `reminder_${hours}h`, dedupKey, `Upcoming flight ${flight.flightCode}`, `Departs in about ${hours} hours.`)
            }
          }
        }
      }
    }
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(987654321)`)
  }
}

async function sendIfNew(db: Db, userId: string, userFlightId: string, kind: string, dedupKey: string, title: string, body: string) {
  try {
    await db.insert(notificationDeliveries).values({ userId, dedupKey, kind })
  } catch {
    return // already sent
  }
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  let anySuccess = false
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title, body }))
      await db.update(pushSubscriptions).set({ lastUsedAt: new Date(), failureCount: 0 }).where(eq(pushSubscriptions.id, sub.id))
      anySuccess = true
    } catch {
      await db.update(pushSubscriptions).set({ failureCount: sub.failureCount + 1 }).where(eq(pushSubscriptions.id, sub.id))
      if (sub.failureCount + 1 >= 5) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
    }
  }
  if (!anySuccess && subs.length > 0) {
    // allow retry next cycle
    await db.delete(notificationDeliveries).where(and(eq(notificationDeliveries.userId, userId), eq(notificationDeliveries.dedupKey, dedupKey)))
  }
}
