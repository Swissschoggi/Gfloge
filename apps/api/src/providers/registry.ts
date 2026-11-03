// Provider registry: resolves configured providers per capability from env
// fallback plus instance credentials, exposes admin-visible status without
// secrets. The demo provider is always available; real adapters activate as
// they are implemented (see API_RESEARCH.md and the milestone notes).
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { providerCredentials, providerState } from '@gfloge/db'
import type { Db } from '@gfloge/db'
import type { AppConfig } from '../config.js'

export const KNOWN_PROVIDERS = [
  { id: 'demo', displayName: 'Gfloge Demo Data', capabilities: ['schedule', 'livePositions', 'airframeInfo'], attribution: 'Demo data bundled with Gfloge', implemented: true },
  { id: 'adsb.lol', displayName: 'adsb.lol', capabilities: ['livePositions'], attribution: 'ODbL data via adsb.lol', implemented: false },
  { id: 'opensky', displayName: 'OpenSky Network', capabilities: ['livePositions', 'historical'], attribution: 'OpenSky Network data', implemented: false },
  { id: 'adsbdb', displayName: 'adsbdb', capabilities: ['airframeInfo'], attribution: 'adsbdb aircraft data (PlaneBase)', implemented: false },
  { id: 'airlabs', displayName: 'AirLabs', capabilities: ['schedule', 'livePositions'], attribution: 'AirLabs data', implemented: false },
  { id: 'aerodatabox', displayName: 'AeroDataBox', capabilities: ['schedule', 'livePositions', 'historical'], attribution: 'AeroDataBox data', implemented: false },
] as const

export type ResolvedProviderStatus = {
  id: string
  displayName: string
  configured: boolean
  capabilities: readonly string[]
  status: string
  enabled: boolean
  attribution: string
  usedFor: string[]
  credentialHint: string | null
}

export class ProviderRegistry {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Db
  ) {}

  /** env fallback + configured adapter ids; never secret values. */
  adaptersInUse(): string[] {    const ids = new Set<string>(['demo'])
    for (const list of Object.values(this.config.providers)) {
      for (const id of list) ids.add(id)
    }
    return [...ids]
  }

  /** Admin card data: env credentials carried a never-serialized fingerprint. */
  private credentialFingerprint(val: string): string {
    return createHash('sha256').update(val).digest('base64url').slice(0, 12)
  }

  /** InstanceCredential masked hint lookup used by admin UI; never secrets. */
  async loadInstanceCredentialMasked(providerId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.providerId, providerId))
      .limit(1)
    return rows[0]?.maskedHint ?? null
  }

  /** Checks whether a provider has any credential source; no secret returns. */
  credentialReport(providerId: string): { configured: boolean; hint: string | null; source: 'instance' | 'env' | 'none' } {
    const env = this.config.envCredentials[providerId]
    if (env && Object.keys(env).length > 0) {
      const first = Object.keys(env)[0]!
      return { configured: true, hint: `env key (${env[first].slice(-4)}...)`, source: 'env' }
    }
    return { configured: false, hint: null, source: 'none' }
  }

  async instanceCredentialMasked(id: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.providerId, id))
      .limit(1)
    return rows[0]?.maskedHint ?? null
  }

  /** Status snapshot for /api/health and admin routes; no secrets. */
  async statusSnapshot(): Promise<ResolvedProviderStatus[]> {
    const usedFor = new Map<string, string[]>()
    for (const [role, ids] of Object.entries(this.config.providers)) {
      for (const id of ids) {
        const list = usedFor.get(id) ?? []
        list.push(role)
        usedFor.set(id, list)
      }
    }
    return Promise.all(
      KNOWN_PROVIDERS.map(async (p) => {
        const env = this.credentialReport(p.id)
        const instance = await this.instanceCredentialMasked(p.id)
        const [state] = await this.db.select({ enabled: providerState.enabled }).from(providerState).where(eq(providerState.providerId, p.id)).limit(1)
        return {
          id: p.id,
          displayName: p.displayName,
          configured: p.id === 'demo' || !!instance || env.configured,
          capabilities: [...p.capabilities],
          enabled: state?.enabled ?? true,
          status: p.implemented ? 'ready' : 'adapter not implemented yet',
          attribution: p.attribution,
          usedFor: usedFor.get(p.id) ?? [],
          credentialHint: instance ?? env.hint,
        }
      })
    )
  }
}
