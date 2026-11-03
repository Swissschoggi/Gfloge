// Integration flow tests. Skipped unless DATABASE_URL points at a database
// with migrations + demo seed applied (see scripts in DEPLOYMENT.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'

const hasDb = !!process.env.DATABASE_URL

test('formats: /api/health responds even without a session', { skip: !hasDb }, async (t) => {
  const app = await buildServer()
  t.after(async () => app.close())
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  assert.equal(res.statusCode, 200)
  const body = res.json() as { ok: boolean; db: { ok: boolean } }
  assert.equal(body.ok, true)
})

test('regression: authed GET /me completes (no request-level preHandler hang)', { skip: !hasDb }, async (t) => {
  const app = await buildServer()
  t.after(async () => app.close())
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'marta@gfloge.demo', password: 'flighty-demo-1' },
  })
  assert.equal(login.statusCode, 200, 'demo login should work with seeded data')
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  const meStart = Date.now()
  const me = (await Promise.race([
    app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('/me hung')), 4000)),
  ])) as { statusCode: number; json(): { me: { email: string } } }
  assert.equal(me.statusCode, 200, `me must not hang, took ${Date.now() - meStart}ms`)
  assert.ok((me.json() as { me: { email: string } }).me.email.includes('marta@'))
})

test('regression: board lists own flights and hides other users', { skip: !hasDb }, async (t) => {
  const app = await buildServer()
  t.after(async () => app.close())
  const asMarta = await loginAs(app, 'marta@gfloge.demo', 'flighty-demo-1')
  const admin = await loginAs(app, 'admin@gfloge.demo', 'demo-admin-1')
  const board = await app.inject({ method: 'GET', url: '/api/v1/board', headers: { cookie: asMarta } })
  assert.equal(board.statusCode, 200)
  const payload = board.json() as { active: unknown[]; upcoming: unknown[]; landed: unknown[] }
  assert.ok(payload.active.length >= 1, 'demo data seeds active flights')
  const logbook = await app.inject({ method: 'GET', url: '/api/v1/logbook', headers: { cookie: asMarta } })
  assert.equal(logbook.statusCode, 200)
  const adminLog = await app.inject({ method: 'GET', url: '/api/v1/logbook', headers: { cookie: admin } })
  assert.equal((adminLog.json() as { flown: unknown[] }).flown.length, 0, 'admin must not see Marta rows via API')
})

test('regression: unauthenticated protected route answers 401, public answers 200', { skip: !hasDb }, async (t) => {
  const app = await buildServer()
  t.after(async () => app.close())
  const me = await app.inject({ method: 'GET', url: '/api/v1/me' })
  assert.equal(me.statusCode, 401)
  const health = await app.inject({ method: 'GET', url: '/api/health' })
  assert.equal(health.statusCode, 200)
})

test('setup endpoint is closed once an instance has users', { skip: !hasDb }, async (t) => {
  const app = await buildServer()
  t.after(async () => app.close())
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/setup',
    payload: { email: 'attacker@gfloge.demo', password: 'not-allowed-here', displayName: 'Nope' },
  })
  assert.equal(res.statusCode, 409)
})

test('manual flight creation is private to its owner', { skip: !hasDb }, async (t) => {
  const app = await buildServer()
  t.after(async () => app.close())
  const cookie = await loginAs(app, 'marta@gfloge.demo', 'flighty-demo-1')
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/manual-flights',
    headers: { cookie },
    payload: {
      flightNumber: 'AB 123',
      departureIata: 'MUC',
      arrivalIata: 'VIE',
      departureLocal: '2025-06-01T10:20',
      arrivalLocal: '2025-06-01T11:25',
      aircraftIcaoType: 'A320',
    },
  })
  assert.equal(created.statusCode, 200, created.body)
  const manual = created.json() as { manualFlightId: string }
  const detail = await app.inject({ method: 'GET', url: `/api/v1/flights/manual:${manual.manualFlightId}`, headers: { cookie } })
  assert.equal(detail.statusCode, 200)
  // A different account must get a 404 (owner-only read).
  const admin = await loginAs(app, 'admin@gfloge.demo', 'demo-admin-1')
  const otherDetail = await app.inject({ method: 'GET', url: `/api/v1/flights/manual:${manual.manualFlightId}`, headers: { cookie: admin } })
  assert.equal(otherDetail.statusCode, 404)
})

async function loginAs(app: Awaited<ReturnType<typeof buildServer>>, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  })
  assert.equal(res.statusCode, 200, `login ${email} must succeed`)
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}
