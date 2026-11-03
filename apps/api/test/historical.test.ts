import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'

const hasDb = !!process.env.DATABASE_URL

async function loginAs(app: Awaited<ReturnType<typeof buildServer>>, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } })
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

test('historical: CX382 resolves to CPA382 candidates on 2026-08-09', { skip: !hasDb }, async (t) => {
  const app = await buildServer()
  t.after(async () => app.close())
  const cookie = await loginAs(app, 'admin@gfloge.demo', 'demo-admin-1')
  const datasets = await app.inject({ method: 'GET', url: '/api/v1/historical/datasets', headers: { cookie } })
  const installed = (datasets.json() as { datasets: Array<{ status: string; dateStart: string; dateEnd: string }> }).datasets.some(
    (d) => d.status === 'installed' && d.dateStart <= '2026-08-09' && d.dateEnd >= '2026-08-09'
  )
  if (!installed) return t.skip('no installed historical dataset covers 2026-08-09')
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/historical/search',
    headers: { cookie },
    payload: { flightNumber: 'CX382', date: '2026-08-09' },
  })
  assert.equal(res.statusCode, 200)
  const body = res.json() as { duckdbAvailable: boolean; candidates: Array<{ callsign: string; departureTimeUtc: string | null }> }
  assert.equal(body.duckdbAvailable, true)
  assert.ok(body.candidates.length >= 1, 'expected at least one candidate')
  assert.ok(body.candidates.some((c) => c.callsign === 'CPA382'), 'expected CPA382 callsign')
  assert.ok(body.candidates.some((c) => c.departureTimeUtc?.startsWith('2026-08-09')), 'expected an Aug 9 UTC departure')
})

test('historical: search preserves multiple candidates across UTC window', { skip: !hasDb }, async (t) => {
  const app = await buildServer()
  t.after(async () => app.close())
  const cookie = await loginAs(app, 'admin@gfloge.demo', 'demo-admin-1')
  const datasets = await app.inject({ method: 'GET', url: '/api/v1/historical/datasets', headers: { cookie } })
  const installed = (datasets.json() as { datasets: Array<{ status: string; dateStart: string; dateEnd: string }> }).datasets.some(
    (d) => d.status === 'installed' && d.dateStart <= '2026-08-09' && d.dateEnd >= '2026-08-09'
  )
  if (!installed) return t.skip('no installed historical dataset covers 2026-08-09')
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/historical/search',
    headers: { cookie },
    payload: { flightNumber: 'CX 382', date: '2026-08-09' },
  })
  assert.equal(res.statusCode, 200)
  const body = res.json() as { candidates: unknown[] }
  assert.ok(body.candidates.length >= 2, 'timezone window should yield multiple candidates')
})

test('historical: leading-zero flight numbers do not crash', { skip: !hasDb }, async (t) => {
  const app = await buildServer()
  t.after(async () => app.close())
  const cookie = await loginAs(app, 'admin@gfloge.demo', 'demo-admin-1')
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/historical/search',
    headers: { cookie },
    payload: { flightNumber: 'CX0382', date: '2026-08-09' },
  })
  assert.equal(res.statusCode, 200)
})