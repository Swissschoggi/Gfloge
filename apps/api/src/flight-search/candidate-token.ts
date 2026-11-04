import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FlightSearchCandidate } from '@gfloge/shared'

type CandidatePayload = {
  version: 1
  userId: string
  expiresAt: number
  candidate: Omit<FlightSearchCandidate, 'token'>
}

function signature(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest()
}

export function signFlightCandidate(
  secret: string,
  userId: string,
  candidate: Omit<FlightSearchCandidate, 'token'>,
  now = Date.now(),
  ttlMs = 10 * 60_000
): string {
  const payload: CandidatePayload = { version: 1, userId, expiresAt: now + ttlMs, candidate }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signature(secret, encoded).toString('base64url')}`
}

export function verifyFlightCandidate(
  secret: string,
  userId: string,
  token: string,
  now = Date.now()
): Omit<FlightSearchCandidate, 'token'> | null {
  const [encoded, digest, extra] = token.split('.')
  if (!encoded || !digest || extra) return null
  const actual = Buffer.from(digest, 'base64url')
  const expected = signature(secret, encoded)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as CandidatePayload
    if (payload.version !== 1 || payload.userId !== userId || payload.expiresAt < now) return null
    return payload.candidate
  } catch {
    return null
  }
}
