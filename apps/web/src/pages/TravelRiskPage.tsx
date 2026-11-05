import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { BoardPayload } from '@gfloge/shared'

type Country = { alpha2: string; alpha3: string | null; name: string }
type RiskData = { iso_code?: string; name?: string; risk_score?: number; advisory_level?: number; active_alerts?: number; calculation?: { method?: string } }
type Advisory = { iso_code?: string; name?: string; max_level?: number; summary_label?: string; sources?: Array<{ agency?: string; level?: number; summary_label?: string; url?: string; updated_at?: string }>; reasons?: string[] }
type Alert = { id?: number; alert_type?: string; severity?: string; location?: string; description?: string; event_date?: string; source?: string }
type Conflict = { id?: number; location?: string; severity?: string; description?: string; event_date?: string; source_url?: string }

function flagEmoji(alpha2: string): string {
  const base = 127397
  return alpha2.toUpperCase().split('').map((c) => String.fromCodePoint(base + c.charCodeAt(0))).join('')
}

export function TravelRiskPage() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Country | null>(null)
  const [submitted, setSubmitted] = useState<string>(() => localStorage.getItem('gfloge-last-country') ?? 'USA')
  const [showResults, setShowResults] = useState(false)

  const countries = useQuery({
    queryKey: ['countries', query],
    queryFn: () => api.get<{ results: Country[] }>(`/api/v1/reference/countries?q=${encodeURIComponent(query)}`).then((r) => r.results),
    enabled: query.trim().length > 0,
  })

  const board = useQuery<BoardPayload>({ queryKey: ['board'], queryFn: () => api.get<BoardPayload>('/api/v1/board') })
  const upcomingDests = Array.from(new Set(
    [...(board.data?.active ?? []), ...(board.data?.upcoming ?? [])]
      .map((b) => b.flight.arrival.country)
      .filter(Boolean)
  ))

  const risk = useQuery<RiskData>({
    queryKey: ['travel-risk', 'risk', submitted],
    queryFn: () => api.get<RiskData>(`/api/v1/travel-risk/risk-score/${encodeURIComponent(submitted)}`),
    enabled: submitted.length === 2 || submitted.length === 3,
  })
  const advisories = useQuery<{ data?: Advisory[]; total?: number; fetched_at?: string }>({
    queryKey: ['travel-risk', 'advisories', submitted],
    queryFn: () => api.get(`/api/v1/travel-risk/advisories?iso=${encodeURIComponent(submitted)}`),
    enabled: submitted.length === 2 || submitted.length === 3,
  })
  const alerts = useQuery<{ data?: Alert[]; total?: number }>({
    queryKey: ['travel-risk', 'alerts', submitted],
    queryFn: () => api.get(`/api/v1/travel-risk/alerts?iso=${encodeURIComponent(submitted)}&limit=20`),
    enabled: submitted.length === 2 || submitted.length === 3,
  })
  const conflicts = useQuery<{ data?: Conflict[]; total?: number }>({
    queryKey: ['travel-risk', 'conflicts', submitted],
    queryFn: () => api.get(`/api/v1/travel-risk/conflicts?iso=${encodeURIComponent(submitted)}&limit=20`),
    enabled: submitted.length === 2 || submitted.length === 3,
  })

  function submit(code: string) {
    setSubmitted(code)
    localStorage.setItem('gfloge-last-country', code)
  }

  const score = risk.data?.risk_score ?? 0
  const level = Math.min(5, Math.max(0, Math.round(score)))

  return (
    <div className="page travel-risk-page">
      <header className="pagehead">
        <div>
          <p className="eyebrow">Travel intelligence</p>
          <h1 className="pagehead__title">Travel risk</h1>
          <p className="pagehead__lede">Country risk scores, government advisories, active alerts and conflicts.</p>
        </div>
      </header>

      {upcomingDests.length > 0 && (
        <div style={{ marginBottom: 'var(--space-m)' }}>
          <p className="form-note" style={{ marginBottom: 'var(--space-2xs)' }}>Your upcoming destinations</p>
          <div className="actions-row">
            {upcomingDests.map((c) => (
              <button key={c} className="btn-outline" type="button" onClick={() => submit(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field" style={{ marginBottom: 'var(--space-m)', position: 'relative' }}>
        <label htmlFor="tr-country">Country</label>
        <input
          id="tr-country"
          className="input"
          value={selected ? `${flagEmoji(selected.alpha2)} ${selected.name}` : query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); setShowResults(true) }}
          onFocus={() => setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 150)}
          placeholder="Search country…"
        />
        {showResults && query.trim().length > 0 && (countries.data?.length ?? 0) > 0 && (
          <ul className="combobox-list" role="listbox" style={{ position: 'absolute', zIndex: 5, width: '100%' }}>
            {(countries.data ?? []).map((c) => (
              <li key={c.alpha2}>
                <button type="button" role="option" aria-selected={false} onClick={() => { setSelected(c); setQuery(''); setShowResults(false); submit(c.alpha2) }}>
                  <span>{flagEmoji(c.alpha2)}</span>
                  <span>{c.name}</span>
                  <small>{c.alpha2} {c.alpha3 ?? ''}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {risk.isPending && <div className="skeleton skeleton-card" aria-busy="true" />}
      {risk.isError && <p role="alert" className="form-error">{risk.error.message}</p>}

      {risk.data && (
        <section className="data-panel">
          <h2 className="data-panel__title">Risk — {risk.data.name ?? submitted}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-m)', marginBottom: 'var(--space-s)' }}>
            <span style={{ fontSize: 'var(--step-4)', fontWeight: 700 }}>{score}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1,2,3,4,5].map((i) => (
                <span key={i} style={{ width: 12, height: 24, borderRadius: 4, background: i <= level ? 'var(--st-board, #f97316)' : 'var(--line)' }} />
              ))}
            </div>
          </div>
          <div className="readout-row"><span className="readout-row__label">Advisory level</span><span className="readout-row__value">{risk.data.advisory_level ?? '—'} / 4</span></div>
          <div className="readout-row"><span className="readout-row__label">Active alerts</span><span className="readout-row__value">{risk.data.active_alerts ?? 0}</span></div>
          {risk.data.calculation?.method && <p className="form-note">{risk.data.calculation.method}</p>}
        </section>
      )}

      {advisories.data?.data && advisories.data.data.length > 0 && (
        <details className="data-panel">
          <summary><h2 className="data-panel__title" style={{ display: 'inline' }}>Government advisories</h2></summary>
          {advisories.data.data.map((a, i) => (
            <div key={i} style={{ marginBottom: 'var(--space-s)' }}>
              <p><strong>{a.summary_label ?? 'Advisory'}</strong> (max level {a.max_level ?? '—'})</p>
              {a.sources?.map((s, j) => (
                <p key={j} className="form-note">
                  {s.agency ?? 'Agency'} — level {s.level ?? '—'} · {s.summary_label ?? ''}
                  {s.url && <> · <a href={s.url} target="_blank" rel="noreferrer">source</a></>}
                </p>
              ))}
              {a.reasons && a.reasons.length > 0 && <p className="form-note">Reasons: {a.reasons.join('; ')}</p>}
            </div>
          ))}
        </details>
      )}

      {alerts.data?.data && alerts.data.data.length > 0 && (
        <details className="data-panel">
          <summary><h2 className="data-panel__title" style={{ display: 'inline' }}>Active alerts ({alerts.data.total ?? alerts.data.data.length})</h2></summary>
          <ul className="candidate-list">
            {alerts.data.data.map((a) => (
              <li key={a.id}>
                <div className="candidate-card">
                  <div className="candidate-card__top">
                    <span className="candidate-card__code">{a.alert_type ?? 'Alert'}</span>
                    <span className="candidate-card__badge">{a.severity ?? ''}</span>
                  </div>
                  <div className="candidate-card__route">{a.location ?? ''}</div>
                  <div className="candidate-card__times"><span>{a.event_date ?? ''}</span></div>
                  <p className="form-note" style={{ whiteSpace: 'pre-wrap' }}>{a.description?.slice(0, 280)}</p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {conflicts.data?.data && conflicts.data.data.length > 0 && (
        <details className="data-panel">
          <summary><h2 className="data-panel__title" style={{ display: 'inline' }}>Conflicts ({conflicts.data.total ?? conflicts.data.data.length})</h2></summary>
          <ul className="candidate-list">
            {conflicts.data.data.map((c) => (
              <li key={c.id}>
                <div className="candidate-card">
                  <div className="candidate-card__top">
                    <span className="candidate-card__code">{c.severity ?? 'Conflict'}</span>
                  </div>
                  <div className="candidate-card__route">{c.location ?? ''}</div>
                  <div className="candidate-card__times"><span>{c.event_date ?? ''}</span></div>
                  <p className="form-note">{c.description}</p>
                  {c.source_url && <p className="form-note"><a href={c.source_url} target="_blank" rel="noreferrer">source</a></p>}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
