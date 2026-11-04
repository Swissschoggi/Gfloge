// Provider registry: resolves configured providers per capability from env
// fallback plus instance credentials, exposes admin-visible status without
// secrets. The demo provider is always available; real adapters activate as
// they are implemented (see API_RESEARCH.md and the milestone notes).
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { providerCredentials, providerState } from '@gfloge/db'
import type { Db } from '@gfloge/db'
import type { AppConfig } from '../config.js'
import { decryptConfigJson } from '../crypto.js'

export const KNOWN_PROVIDERS = [
  { id: 'demo', displayName: 'Gfloge Demo Data', capabilities: ['schedule', 'livePositions', 'airframeInfo'], attribution: 'Demo data bundled with Gfloge', implemented: true },
  { id: 'travelrisk', displayName: 'Travel Risk API', capabilities: ['schedule', 'flight_lookup', 'flight_status', 'airport_data', 'airline_data', 'aircraft_data', 'airline_safety', 'travel_risk', 'travel_advisories', 'travel_alerts'], attribution: 'Travel Risk API aviation and risk data', implemented: true },
  { id: 'airlabs', displayName: 'AirLabs', capabilities: ['schedule'], attribution: 'AirLabs schedule data', implemented: true },
  { id: 'adsb.lol', displayName: 'adsb.lol', capabilities: ['livePositions'], attribution: 'ODbL data via adsb.lol', implemented: true },
  { id: 'opensky', displayName: 'OpenSky Network', capabilities: ['livePositions', 'historical'], attribution: 'OpenSky Network data', implemented: false },
  { id: 'adsbdb', displayName: 'adsbdb', capabilities: ['airframeInfo'], attribution: 'adsbdb aircraft data (PlaneBase)', implemented: false },
  { id: 'aerodatabox', displayName: 'AeroDataBox', capabilities: ['schedule', 'livePositions', 'historical'], attribution: 'AeroDataBox data', implemented: false },
  { id: 'serpapi', displayName: 'SerpApi (Google Flights)', capabilities: ['flight_discovery', 'flight_prices'], attribution: 'Google Flights data via SerpApi', implemented: true },
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

  isDemoEnabled(): boolean {
    return this.config.seedDemo
  }

  /** Return provider credentials to backend adapters only; never serialize or log this value. */
  async credentials(providerId: string): Promise<Record<string, string> | null> {
    const instance = await this.db
      .select({ configEncrypted: providerCredentials.configEncrypted })
      .from(providerCredentials)
      .where(eq(providerCredentials.providerId, providerId))
      .limit(1)
    if (instance[0]) return decryptConfigJson(this.config.secret, instance[0].configEncrypted)
    return this.config.envCredentials[providerId] ?? null
  }

  /** Provider ids are opt-in through GF_PROVIDERS_SCHEDULE; credentials are never returned here. */
  async configuredScheduleProviders(): Promise<Array<{
    id: string
    name: string
    attribution: string
    state: 'ready' | 'unconfigured' | 'disabled' | 'adapter_unavailable'
    message: string
  }>> {
    const ids = new Set(this.config.providers.schedule)
    // Instance-managed keys are the primary settings path; selecting a BYO-key
    // adapter in Settings must not also require an env-only provider slot.
    for (const provider of KNOWN_PROVIDERS) {
      if (!(provider.capabilities as readonly string[]).includes('schedule') || provider.id === 'demo') continue
      if (await this.instanceCredentialMasked(provider.id) || this.config.envCredentials[provider.id]) ids.add(provider.id)
    }
    return Promise.all([...ids].map(async (id) => {
      const provider = KNOWN_PROVIDERS.find((item) => item.id === id)
      if (!provider) return { id, name: id, attribution: id, state: 'adapter_unavailable', message: 'This provider is not registered in Gfloge.' }
      const state = (await this.db.select({ enabled: providerState.enabled }).from(providerState).where(eq(providerState.providerId, id)).limit(1))[0]
      if (state?.enabled === false) return { id, name: provider.displayName, attribution: provider.attribution, state: 'disabled', message: `${provider.displayName} is disabled in provider settings.` }
      if (!provider.implemented) return { id, name: provider.displayName, attribution: provider.attribution, state: 'adapter_unavailable', message: `${provider.displayName} is configured, but its schedule adapter is not implemented in this version.` }
      if (id !== 'demo') {
        const instance = await this.instanceCredentialMasked(id)
        const env = this.credentialReport(id)
        if (!instance && !env.configured) return { id, name: provider.displayName, attribution: provider.attribution, state: 'unconfigured', message: `${provider.displayName} is selected for schedules, but its API key is not configured.` }
      }
      return { id, name: provider.displayName, attribution: provider.attribution, state: 'ready', message: `${provider.displayName} is available for schedule searches.` }
    }))
  }

  /** Capability-selected schedule sources, with honest adapter/key readiness. */
  async scheduleSources(): Promise<Array<{
    id: string
    name: string
    attribution: string
    state: 'ready' | 'unconfigured' | 'disabled' | 'adapter_unavailable'
    message: string
  }>> {
    const ids = [...new Set(this.config.providers.schedule)]
    return Promise.all(ids.map(async (id) => {
      const provider = KNOWN_PROVIDERS.find((item) => item.id === id)
      const state = (await this.db.select({ enabled: providerState.enabled }).from(providerState).where(eq(providerState.providerId, id)).limit(1))[0]
      if (!provider) return { id, name: id, attribution: id, state: 'adapter_unavailable', message: 'This provider is not registered in Gfloge.' }
      if (state?.enabled === false) return { id, name: provider.displayName, attribution: provider.attribution, state: 'disabled', message: `${provider.displayName} is disabled in provider settings.` }
      if (!provider.implemented) return { id, name: provider.displayName, attribution: provider.attribution, state: 'adapter_unavailable', message: `${provider.displayName} is configured, but its schedule adapter is not implemented in this version.` }
      if (id !== 'demo' && !(await this.credentials(id))) {
        return { id, name: provider.displayName, attribution: provider.attribution, state: 'unconfigured', message: `${provider.displayName} needs credentials before it can be queried.` }
      }
      return { id, name: provider.displayName, attribution: provider.attribution, state: 'ready', message: `${provider.displayName} is ready for schedule searches.` }
    }))
  }

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
          status: !p.implemented ? 'adapter not implemented yet' : p.id !== 'demo' && !instance && !env.configured ? 'credentials not configured' : 'ready',
          attribution: p.attribution,
          usedFor: usedFor.get(p.id) ?? [],
          credentialHint: instance ?? env.hint,
          implemented: p.implemented,
        }
      })
    )
  }
}
