import type { FastifyInstance, FastifyRequest } from 'fastify'

function requireUser(req: FastifyRequest): { id: string } {
  return req.user as { id: string }
}

export function registerTravelRiskRoutes(app: FastifyInstance): void {
  app.get('/api/v1/travel-risk/risk-score/:iso', async (req, reply) => {
    requireUser(req)
    const iso = String((req.params as Record<string, string>).iso)
    const creds = await app.providers.credentials('travelrisk')
    const apiKey = creds?.apiKey ?? creds?.secret ?? null
    const { getTravelRiskCountryRisk } = await import('../providers/travelrisk.js')
    const result = await getTravelRiskCountryRisk(iso, apiKey)
    if (!result.ok) return reply.code(502).send({ error: { code: 'provider_error', message: result.message } })
    return result.data
  })

  app.get('/api/v1/travel-risk/advisories', async (req, reply) => {
    requireUser(req)
    const iso = (req.query as Record<string, string>).iso ?? null
    const creds = await app.providers.credentials('travelrisk')
    const apiKey = creds?.apiKey ?? creds?.secret ?? null
    const { getTravelRiskAdvisories } = await import('../providers/travelrisk.js')
    const result = await getTravelRiskAdvisories(iso, apiKey)
    if (!result.ok) return reply.code(502).send({ error: { code: 'provider_error', message: result.message } })
    return result.data
  })

  app.get('/api/v1/travel-risk/alerts', async (req, reply) => {
    requireUser(req)
    const q = req.query as Record<string, string>
    const creds = await app.providers.credentials('travelrisk')
    const apiKey = creds?.apiKey ?? creds?.secret ?? null
    const { getTravelRiskAlerts } = await import('../providers/travelrisk.js')
    const result = await getTravelRiskAlerts({ iso: q.iso, severity: q.severity, alertType: q.alertType, days: q.days ? Number(q.days) : undefined }, apiKey)
    if (!result.ok) return reply.code(502).send({ error: { code: 'provider_error', message: result.message } })
    return result.data
  })

  app.get('/api/v1/travel-risk/conflicts', async (req, reply) => {
    requireUser(req)
    const q = req.query as Record<string, string>
    const creds = await app.providers.credentials('travelrisk')
    const apiKey = creds?.apiKey ?? creds?.secret ?? null
    const { getTravelRiskConflicts } = await import('../providers/travelrisk.js')
    const result = await getTravelRiskConflicts({ iso: q.iso, days: q.days ? Number(q.days) : undefined, minSeverity: q.minSeverity }, apiKey)
    if (!result.ok) return reply.code(502).send({ error: { code: 'provider_error', message: result.message } })
    return result.data
  })
}