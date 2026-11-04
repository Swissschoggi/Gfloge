import type { FastifyInstance, FastifyRequest } from 'fastify'

function requireUser(req: FastifyRequest): { id: string } {
  return req.user as { id: string }
}

export function registerFlightDiscoveryRoutes(app: FastifyInstance): void {
  app.get('/api/v1/flight-discovery', async (req, reply) => {
    requireUser(req)
    const q = req.query as Record<string, string>
    if (!q.departure || !q.arrival || !q.outboundDate) {
      return reply.code(400).send({ error: { code: 'validation', message: 'departure, arrival and outboundDate are required.' } })
    }
    const creds = await app.providers.credentials('serpapi')
    const apiKey = creds?.apiKey ?? creds?.secret ?? null
    const { searchSerpApi } = await import('../providers/serpapi.js')
    const result = await searchSerpApi({
      departureId: q.departure,
      arrivalId: q.arrival,
      outboundDate: q.outboundDate,
      returnDate: q.returnDate,
      type: (q.type as '1' | '2' | '3') ?? '2',
      adults: q.adults ? Number(q.adults) : 1,
      currency: q.currency,
      hl: q.hl,
      gl: q.gl,
      travelClass: q.travelClass as '1' | '2' | '3' | '4' | undefined,
      stops: q.stops as '0' | '1' | '2' | undefined,
      maxPrice: q.maxPrice ? Number(q.maxPrice) : undefined,
    }, apiKey)
    if (result.state !== 'searched') {
      return reply.code(502).send({ error: { code: result.state, message: result.message } })
    }
    return { retrievedAt: new Date().toISOString(), ...result.result }
  })
}