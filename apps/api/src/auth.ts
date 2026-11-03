// Auth: setup, login, logout, session reading. Sessions are server-side
// rows keyed by token hash; the cookie never carries identifiers.
import {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify'
import { and, eq, gt, sql } from 'drizzle-orm'
import { auditLog, sessions, users } from '@gfloge/db'
import { loginSchema, setupSchema, type AuthedUser, type MePayload } from '@gfloge/shared'
import { hashPassword, verifyPassword, newSessionToken, hashToken } from './crypto.js'

export const SESSION_COOKIE = 'gf_session'

export type AuthState = { user: AuthedUser }

export async function readSession(request: FastifyRequest): Promise<AuthedUser | null> {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) return null
  const db = request.server.db
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      deactivatedAt: users.deactivatedAt,
      sessionId: sessions.id,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1)
  const row = rows[0]
  if (!row || row.deactivatedAt) return null
  request.sessionRowId = row.sessionId
  return { id: row.userId, email: row.email, displayName: row.displayName, role: row.role }}

// Auth is enforced inline in the app-wide onRequest hook (see app.ts):
// a route-level preHandler variant hangs requests in this fastify version,
// so every protected route relies on request.user having been resolved.
export function publicPath(url: string | undefined): boolean {
  if (!url) return true
  const path = url.split('?')[0] ?? ''
  return (
    path === '/' ||
    path === '/api/health' ||
    path === '/setup' ||
    path === '/signin' ||
    path.startsWith('/assets/') ||
    path.startsWith('/api/v1/setup') ||
    path.startsWith('/api/v1/auth/login') ||
    path.startsWith('/api/v1/setup')
  )
}

export const PUBLIC_PATHS = new Set<string>([
  '/api/health',
  '/api/v1/setup',
  '/api/v1/auth/login',
])

/** Routes that require a session enforce it in the app-level onRequest hook. */
export function isProtectedPath(path: string): boolean {
  if (path.startsWith('/api/v1/setup/')) return false
  return path.startsWith('/api/') && !PUBLIC_PATHS.has(path)
}

/** Returns true when the request carries a valid session. Otherwise it answers 401 itself. */
export function enforceAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user
  if (!user) {
    void reply.code(401).send({
      error: { code: 'unauthenticated', message: 'Sign in to continue. Session expired or missing.' },
    })
    return false
  }
  return true
}

export function enforceAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!enforceAuth(request, reply)) return false
  if (request.user?.role !== 'admin') {
    void reply.code(403).send({
      error: { code: 'forbidden', message: 'This action needs an instance administrator.' },
    })
    return false
  }
  return true
}

async function issueSession(
  db: import('@gfloge/db').Db,
  userId: string,
  userAgent: string | undefined,
  days: number
): Promise<{ token: string; expiresAt: Date }> {
  const { token, tokenHash } = newSessionToken()
  const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000)
  await db.insert(sessions).values({ tokenHash, userId, expiresAt, userAgent: userAgent ?? null })
  return { token, expiresAt }
}

export function registerAuthRoutes(app: FastifyInstance): void {
  // Instance setup: only allowed while no users exist.
  app.post('/api/v1/setup', { config: { rateLimit: { max: 5, timeWindow: 60_000 } } }, async (req, reply) => {
    const parsed = setupSchema.safeParse(req.body)
    if (!parsed.success) return invalid(reply, parsed.error.issues[0]?.message ?? 'Invalid input')
    const [{ count }] = await app.db.select({ count: sql<number>`count(*)::int` }).from(users)
    if (count > 0) {
      return reply
        .code(409)
        .send({ error: { code: 'initialized', message: 'This instance is already set up. Sign in instead.' } })
    }
    const hash = await hashPassword(parsed.data.password)
    const [user] = await app.db
      .insert(users)
      .values({ email: parsed.data.email, passwordHash: hash, displayName: parsed.data.displayName, role: 'admin' })
      .returning({ id: users.id, email: users.email, displayName: users.displayName, role: users.role })
    await app.db.insert(auditLog).values({ actorUserId: user.id, action: 'instance_setup', subject: user.email })
    const session = await issueSession(app.db, user.id, req.headers['user-agent'], app.config.sessionDays)
    setSessionCookie(reply, session.token, session.expiresAt, app.config.cookieSecure)
    const me: MePayload = { id: user.id, email: user.email, displayName: user.displayName, role: user.role as 'admin' }
    return { me }
  })

  app.get('/api/v1/setup/status', async () => {
    const [{ count }] = await app.db.select({ count: sql<number>`count(*)::int` }).from(users)
    return { initialized: count > 0, seededDemo: app.config.seedDemo }
  })

  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) return invalid(reply, 'Enter a valid email address and password.')
    const rows = await app.db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1)
    const user = rows[0]
    if (!user || user.deactivatedAt || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      await app.db.insert(auditLog).values({ action: 'login_failed', subject: parsed.data.email })
      return reply
        .code(401)
        .send({ error: { code: 'bad_credentials', message: "Email or password doesn't match an account." } })
    }
    const session = await issueSession(app.db, user.id, req.headers['user-agent'], app.config.sessionDays)
    await app.db.insert(auditLog).values({ actorUserId: user.id, action: 'login', subject: user.email })
    setSessionCookie(reply, session.token, session.expiresAt, app.config.cookieSecure)
    const me: MePayload = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role as 'admin' | 'user',
    }
    return { me }
  })

  app.post('/api/v1/auth/logout', async (req, reply) => {
    if (req.sessionRowId) {
      await app.db.delete(sessions).where(eq(sessions.id, req.sessionRowId))
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/v1/me', async (req) => {
    return { me: req.user }
  })
}

export type AuthedRequest = FastifyRequest & { user: AuthedUser }

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  secure: boolean
): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    expires: expiresAt,
  })
}

function invalid(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: { code: 'validation', message } })
}
