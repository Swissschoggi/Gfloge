import type { FastifyInstance, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { auditLog, instanceSettings, providerState, sessions, users } from '@gfloge/db'
import { changePasswordSchema, preferencesSchema } from '@gfloge/shared'
import { hashPassword, verifyPassword } from '../crypto.js'
import { SESSION_COOKIE } from '../auth.js'

const userId = (req: FastifyRequest): string => req.user!.id

export function registerAccountRoutes(app: FastifyInstance): void {
  app.get('/api/v1/instance', async () => {
    const rows = await app.db.select().from(instanceSettings).where(eq(instanceSettings.key, 'instance_name')).limit(1)
    const value = rows[0]?.value as { name?: string } | undefined
    return { name: value?.name ?? process.env.GF_INSTANCE_NAME ?? 'Gfloge' }
  })

  app.patch('/api/v1/admin/instance', async (req, reply) => {
    const body = req.body as { name?: unknown }
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 80) return reply.code(400).send({ error: { code: 'validation', message: 'Instance name must be 1 to 80 characters.' } })
    await app.db.insert(instanceSettings).values({ key: 'instance_name', value: { name }, updatedBy: userId(req) }).onConflictDoUpdate({ target: instanceSettings.key, set: { value: { name }, updatedBy: userId(req), updatedAt: new Date() } })
    await app.db.insert(auditLog).values({ actorUserId: userId(req), action: 'instance_name_changed', subject: name })
    return { name }
  })

  app.get('/api/v1/me/preferences', async (req) => {
    const row = (await app.db.select().from(users).where(eq(users.id, userId(req))).limit(1))[0]!
    return {
      preferences: {
        displayName: row.displayName,
        email: row.email,
        units: row.units,
        timezoneDisplay: row.timezoneDisplay,
        themeOverride: row.themeOverride ?? 'system',
        notificationPrefs: row.notificationPrefs,
      },
    }
  })

  app.patch('/api/v1/me/preferences', async (req, reply) => {
    const parsed = preferencesSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'Check your preferences.' } })
    const v = parsed.data
    await app.db.update(users).set({
      ...(v.displayName !== undefined ? { displayName: v.displayName } : {}),
      ...(v.units !== undefined ? { units: v.units } : {}),
      ...(v.timezoneDisplay !== undefined ? { timezoneDisplay: v.timezoneDisplay } : {}),
      ...(v.themeOverride !== undefined ? { themeOverride: v.themeOverride } : {}),
      ...(v.notificationPrefs !== undefined ? { notificationPrefs: v.notificationPrefs } : {}),
      updatedAt: new Date(),
    }).where(eq(users.id, userId(req)))
    return { ok: true }
  })

  app.post('/api/v1/me/password', async (req, reply) => {
    const parsed = changePasswordSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'Check the password fields.' } })
    const row = (await app.db.select().from(users).where(eq(users.id, userId(req))).limit(1))[0]!
    if (!(await verifyPassword(parsed.data.currentPassword, row.passwordHash))) {
      return reply.code(400).send({ error: { code: 'current_password', message: 'The current password does not match this account.' } })
    }
    const passwordHash = await hashPassword(parsed.data.newPassword)
    await app.db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.id))
    // Revoke every session, including current, then clear its cookie.
    await app.db.delete(sessions).where(eq(sessions.userId, row.id))
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    await app.db.insert(auditLog).values({ actorUserId: row.id, action: 'password_changed', subject: row.email })
    return { ok: true, signedOut: true }
  })

  app.delete('/api/v1/me', async (req, reply) => {
    const body = req.body as { password?: unknown } | undefined
    const password = typeof body?.password === 'string' ? body.password : ''
    const row = (await app.db.select().from(users).where(eq(users.id, userId(req))).limit(1))[0]!
    if (!(await verifyPassword(password, row.passwordHash))) {
      return reply.code(400).send({ error: { code: 'current_password', message: 'Enter your current password to delete your account.' } })
    }
    await app.db.delete(users).where(eq(users.id, row.id))
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  // Admin user management. Admin cannot access logbook content, only account metadata.
  app.get('/api/v1/admin/users', async () => {
    const rows = await app.db.select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role, deactivatedAt: users.deactivatedAt, createdAt: users.createdAt }).from(users).orderBy(users.createdAt)
    return { users: rows }
  })

  app.post('/api/v1/admin/users', async (req, reply) => {
    const body = req.body as { email?: unknown; displayName?: unknown; password?: unknown; role?: unknown }
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const role = body?.role === 'admin' ? 'admin' : 'user'
    if (!email.includes('@') || !displayName || password.length < 10) {
      return reply.code(400).send({ error: { code: 'validation', message: 'Enter a valid email, name, and password of at least 10 characters.' } })
    }
    const passwordHash = await hashPassword(password)
    try {
      const [created] = await app.db.insert(users).values({ email, displayName, passwordHash, role }).returning({ id: users.id, email: users.email, displayName: users.displayName, role: users.role, createdAt: users.createdAt })
      await app.db.insert(auditLog).values({ actorUserId: userId(req), action: 'user_created', subject: email })
      return { user: created }
    } catch {
      return reply.code(409).send({ error: { code: 'duplicate_email', message: 'That email already belongs to an account.' } })
    }
  })

  app.patch('/api/v1/admin/users/:id', async (req, reply) => {
    const id = String((req.params as Record<string, string>).id)
    if (id === userId(req)) return reply.code(400).send({ error: { code: 'self_change', message: 'Use profile settings to change your own account.' } })
    const body = req.body as { deactivated?: unknown; role?: unknown }
    const row = (await app.db.select().from(users).where(eq(users.id, id)).limit(1))[0]
    if (!row) return reply.code(404).send({ error: { code: 'not_found', message: 'No user with that id.' } })
    const deactivated = typeof body?.deactivated === 'boolean' ? body.deactivated : row.deactivatedAt !== null
    const role = body?.role === 'admin' || body?.role === 'user' ? body.role : row.role
    await app.db.update(users).set({ deactivatedAt: deactivated ? (row.deactivatedAt ?? new Date()) : null, role, updatedAt: new Date() }).where(eq(users.id, id))
    if (deactivated) await app.db.delete(sessions).where(eq(sessions.userId, id))
    await app.db.insert(auditLog).values({ actorUserId: userId(req), action: deactivated ? 'user_deactivated' : 'user_updated', subject: row.email })
    return { ok: true }
  })

  app.patch('/api/v1/admin/providers/:id', async (req, reply) => {
    const providerId = String((req.params as Record<string, string>).id)
    const body = req.body as { enabled?: unknown }
    if (typeof body?.enabled !== 'boolean') return reply.code(400).send({ error: { code: 'validation', message: 'Choose whether this provider is enabled.' } })
    await app.db.insert(providerState).values({ providerId, enabled: body.enabled }).onConflictDoUpdate({ target: providerState.providerId, set: { enabled: body.enabled } })
    await app.db.insert(auditLog).values({ actorUserId: userId(req), action: 'provider_enabled_changed', subject: `${providerId}:${body.enabled}` })
    return { ok: true }
  })

  app.post('/api/v1/admin/providers/:id/test', async (req) => {
    const providerId = String((req.params as Record<string, string>).id)
    const status = (await app.providers.statusSnapshot()).find((provider) => provider.id === providerId)
    if (!status) return { ok: false, status: 'unknown_provider', message: 'No provider adapter exists for this identifier.' }
    if (providerId === 'demo') return { ok: true, status: 'ready', message: 'Demo dataset is bundled and ready.' }
    return { ok: false, status: 'adapter_unavailable', message: 'Provider adapter is not implemented. Credentials are stored but no connection was attempted.' }
  })
}
