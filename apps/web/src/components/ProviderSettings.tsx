import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { ProviderStatus } from '@gfloge/shared'

const PROVIDER_DESCRIPTIONS: Record<string, { description: string; signupUrl: string; terms: string }> = {
  demo: { description: 'Bundled sample flights and positions for demos and testing.', signupUrl: '', terms: 'Bundled with Gfloge' },
  travelrisk: { description: 'Flight schedules, airport/airline/aircraft data, and travel risk intelligence. Single API key for all capabilities.', signupUrl: 'https://travelriskapi.com', terms: 'Free tier available; paid plans for higher limits' },
  airlabs: { description: 'Near-term schedules, realtime flights, flight info and delays. Only covers ~10 hours ahead on the free plan.', signupUrl: 'https://airlabs.co/signup', terms: 'Free plan available; paid plans for higher limits' },
  'adsb.lol': { description: 'Live ADS-B positions via community aggregator.', signupUrl: 'https://adsb.lol', terms: 'Free, ODbL license' },
  opensky: { description: 'ADS-B state vectors and historical flight batches.', signupUrl: 'https://opensky-network.org', terms: 'Free account with OAuth2 credentials' },
  adsbdb: { description: 'Aircraft enrichment by registration or Mode-S hex.', signupUrl: 'https://www.adsbdb.com', terms: 'Free, no key required' },
  aerodatabox: { description: 'Future schedules up to 365 days, historical data, flight status.', signupUrl: 'https://aerodatabox.com', terms: 'Free tier non-commercial, 7-day cache limit' },
  serpapi: { description: 'Google Flights search and fare comparison. Results are flight offers, not verified operations.', signupUrl: 'https://serpapi.com', terms: 'Free tier available; paid plans for higher limits' },
}

interface TestResult {
  ok: boolean
  status: string
  message: string
  testedAt: string
}

export function ProviderSettings() {
  const queryClient = useQueryClient()
  const providers = useQuery({
    queryKey: ['admin-providers'],
    queryFn: () => api.get<{ providers: Array<ProviderStatus & { enabled: boolean; usedFor: string[] }> }>('/api/v1/admin/providers'),
  })
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})

  const saveMutation = useMutation({
    mutationFn: ({ id, secret }: { id: string; secret: string }) =>
      api.post(`/api/v1/admin/providers/${id}/credentials`, { secret }),
    onSuccess: (_, { id }) => {
      setSecrets((current) => ({ ...current, [id]: '' }))
      setMessages((current) => ({ ...current, [id]: 'Credential saved. The full value will not be shown again.' }))
      void queryClient.invalidateQueries({ queryKey: ['admin-providers'] })
    },
    onError: (error, { id }) => {
      setMessages((current) => ({ ...current, [id]: error instanceof Error ? error.message : 'Could not save credential.' }))
    },
  })

  const enableMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/v1/admin/providers/${id}`, { enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-providers'] }),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/admin/providers/${id}/credentials`),
    onSuccess: (_, id) => {
      setMessages((current) => ({ ...current, [id]: 'Credential removed.' }))
      setTestResults((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      void queryClient.invalidateQueries({ queryKey: ['admin-providers'] })
    },
  })

  async function testConnection(id: string) {
    setTesting((current) => ({ ...current, [id]: true }))
    try {
      const result = await api.post<{ ok: boolean; status: string; message: string }>(`/api/v1/admin/providers/${id}/test`)
      setTestResults((current) => ({
        ...current,
        [id]: { ok: result.ok, status: result.status, message: result.message, testedAt: new Date().toISOString() },
      }))
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [id]: {
          ok: false,
          status: 'error',
          message: error instanceof Error ? error.message : 'Connection test failed.',
          testedAt: new Date().toISOString(),
        },
      }))
    } finally {
      setTesting((current) => ({ ...current, [id]: false }))
    }
  }

  if (providers.isPending) return <p>Loading provider status…</p>
  if (providers.isError) return <div role="alert" className="form-error">{providers.error.message}</div>

  return (
    <div className="settings-stack">
      <p className="form-note">
        Configure external data providers. Credentials are stored encrypted on the server and never returned to the browser. Only administrators can manage providers.
      </p>
      {providers.data?.providers.map((provider) => {
        const info = PROVIDER_DESCRIPTIONS[provider.id] ?? { description: '', signupUrl: '', terms: '' }
        const implemented = provider.implemented ?? false
        const result = testResults[provider.id]
        return (
          <div className="data-panel provider-card" key={provider.id}>
            <div className="provider-heading">
              <div>
                <h2>{provider.displayName}</h2>
                <p className="form-note">{info.description}</p>
                <p className="form-note">{provider.capabilities.join(' · ')} · {provider.status}</p>
                <p className="attribution">{info.terms}{info.signupUrl && <> · <a href={info.signupUrl} target="_blank" rel="noreferrer">Get API key</a></>}</p>
              </div>
              <label className="check-row">
                <input type="checkbox" checked={provider.enabled} onChange={(event) => enableMutation.mutate({ id: provider.id, enabled: event.target.checked })} disabled={!implemented} />
                Enabled
              </label>
            </div>

            <div className="provider-status-line">
              <span className={provider.configured ? 'provider-status--configured' : 'provider-status--missing'}>
                {provider.configured ? `Configured (${provider.credentialHint})` : 'No credentials'}
              </span>
              {provider.usedFor.length > 0 && <span className="form-note">Used for: {provider.usedFor.join(', ')}</span>}
            </div>

            {implemented && (
              <div className="provider-credential">
                <div className="field">
                  <label htmlFor={`secret-${provider.id}`}>API key</label>
                  <input
                    id={`secret-${provider.id}`}
                    className="input"
                    type="password"
                    value={secrets[provider.id] ?? ''}
                    onChange={(event) => setSecrets((current) => ({ ...current, [provider.id]: event.target.value }))}
                    placeholder={provider.configured ? 'Replace existing key' : 'Enter API key'}
                    autoComplete="off"
                  />
                </div>
                <div className="provider-credential__actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={!secrets[provider.id] || (secrets[provider.id]?.length ?? 0) < 8 || saveMutation.isPending}
                    onClick={() => { const secret = secrets[provider.id]; if (secret) saveMutation.mutate({ id: provider.id, secret }) }}
                  >
                    {saveMutation.isPending ? 'Saving…' : 'Save key'}
                  </button>
                  {provider.configured && (
                    <button type="button" className="btn-outline" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate(provider.id)}>
                      {removeMutation.isPending ? 'Removing…' : 'Remove key'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-outline"
                    disabled={testing[provider.id]}
                    onClick={() => void testConnection(provider.id)}
                    aria-busy={testing[provider.id]}
                  >
                    {testing[provider.id] ? 'Testing…' : 'Test connection'}
                  </button>
                </div>
              </div>
            )}

            {!implemented && (
              <p className="form-note provider-unavailable">
                This provider adapter is not implemented in this version. Credentials can be stored but no connection will be attempted.
              </p>
            )}

            {messages[provider.id] && <p role="status" className="form-note">{messages[provider.id]}</p>}

            {result && (
              <div className={`provider-test-result ${result.ok ? 'provider-test-result--ok' : 'provider-test-result--error'}`} role={result.ok ? 'status' : 'alert'}>
                <strong>{result.ok ? 'Connected' : 'Failed'}</strong>
                <span>{result.message}</span>
                <small>Tested {new Date(result.testedAt).toLocaleTimeString()}</small>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}