import { z } from 'zod'

// Environment configuration. All GF_* variables are mapped explicitly into
// schema keys (a bare passthrough would read the wrong names); structured
// extra values (providers, env credentials) are attached afterwards. Health
// endpoint reports configured-ness, never values.

const configSchema = z.object({
  databaseUrl: z.string(),
  secret: z.string().min(32),
  httpPort: z.coerce.number().default(8080),
  host: z.string().default('0.0.0.0'),
  trustProxy: z.string().optional().transform((value) => value === '1' || value === 'true'),
  webDist: z.string().optional(), // serve built SPA when present
  seedDemo: z.coerce.boolean().default(false),
  logLevel: z.string().default('info'),
  cookieSecure: z.string().optional().transform((value) => value === '1' || value === 'true'), // GF_COOKIE_SECURE=false for plain http deploys
  sessionDays: z.coerce.number().default(7),
})

export type AppConfig = z.infer<typeof configSchema> & {
  providers: {
    airframe: string[]
    route: string[]
    live: string[]
    weather: string[]
    schedule: string[]
    status: string[]
  }
  /** Raw credential values from env (bootstrap source; never logged). */
  envCredentials: Record<string, Record<string, string>>
}

function parseList(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function loadConfig(env = process.env): AppConfig {
  const databaseUrl =
    env.DATABASE_URL ??
    (env.GF_DB_HOST
      ? `postgres://${env.GF_DB_USER ?? 'gfloge'}:${encodeURIComponent(env.GF_DB_PASSWORD ?? '')}@${env.GF_DB_HOST}:${env.GF_DB_PORT ?? '5432'}/${env.GF_DB_NAME ?? 'gfloge'}`
      : 'postgres://localhost:5432/gfloge')

  // GF_* names are mapped to config keys explicitly; boolean strings for
  // GF_VERBOSE-ish flags go through coerce so '0'/'1'/'true'/'false' work.
  const input = {
    databaseUrl,
    secret: env.GF_SECRET ?? '',
    httpPort: env.GF_HTTP_PORT,
    host: env.GF_HTTP_HOST,
    trustProxy: env.GF_TRUST_PROXY,
    seedDemo: env.GF_SEED_DEMO,
    logLevel: env.GF_LOG_LEVEL,
    cookieSecure: env.GF_COOKIE_SECURE,
    sessionDays: env.GF_SESSION_DAYS,
    webDist: env.GF_WEB_DIST,
  }
  const schema = configSchema.safeParse(input)
  if (!schema.success) {
    const missing = schema.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Configuration problem: ${missing}. Set GF_SECRET (32+ random chars) and the GF_DB_* database coordinates.`)
  }
  const envCredentials: Record<string, Record<string, string>> = {}
  const put = (id: string, key: string, val: string | undefined): void => {
    if (val) envCredentials[id] = { ...(envCredentials[id] ?? {}), [key]: val }
  }
  put('opensky', 'clientId', env.GF_OPENSKY_CLIENT_ID)
  put('opensky', 'clientSecret', env.GF_OPENSKY_CLIENT_SECRET)
  put('airlabs', 'apiKey', env.GF_AIRLABS_API_KEY)
  put('aerodatabox', 'rapidApiKey', env.GF_AERODATABOX_RAPIDAPI_KEY)
  const trustProxy = schema.data.trustProxy
  const cookieSecure = env.GF_COOKIE_SECURE === undefined ? trustProxy : schema.data.cookieSecure
  return {
    ...schema.data,
    trustProxy,
    cookieSecure,
    providers: {
      airframe: parseList(env.GF_PROVIDERS_AIRFRAME),
      route: parseList(env.GF_PROVIDERS_ROUTE),
      live: parseList(env.GF_PROVIDERS_LIVE),
      weather: parseList(env.GF_PROVIDERS_WEATHER),
      schedule: parseList(env.GF_PROVIDERS_SCHEDULE),
      status: parseList(env.GF_PROVIDERS_STATUS),
    },
    envCredentials,
  }
}

export const healthConfigSource = 'schema-mapped-env'
export const databaseUrlFromEnv = (env = process.env): string =>
  env.DATABASE_URL ??
  (env.GF_DB_HOST
    ? `postgres://${env.GF_DB_USER ?? 'gfloge'}:${encodeURIComponent(env.GF_DB_PASSWORD ?? '')}@${env.GF_DB_HOST}:${env.GF_DB_PORT ?? '5432'}/${env.GF_DB_NAME ?? 'gfloge'}`
    : 'postgres://localhost:5432/gfloge')
