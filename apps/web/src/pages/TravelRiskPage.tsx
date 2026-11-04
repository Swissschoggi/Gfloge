import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

type RiskData = { iso_code?: string; name?: string; risk_score?: number; advisory_level?: number; active_alerts?: number; calculation?: { method?: string; base_score?: number; alert_impact?: number } }
type Advisory = { iso_code?: string; name?: string; max_level?: number; summary_label?: string; sources?: Array<{ agency?: string; level?: number; summary_label?: string; url?: string; updated_at?: string }>; reasons?: string[] }
type Alert = { id?: number; alert_type?: string; severity?: string; location?: string; description?: string; event_date?: string; source?: string }
type Conflict = { id?: number; location?: string; severity?: string; description?: string; event_date?: string; source_url?: string }

export function TravelRiskPage() {
  const [iso, setIso] = useState('USA')
  const [submitted, setSubmitted] = useState('USA')

  const risk = useQuery({
    queryKey: ['travel-risk', 'risk', submitted],
    queryFn: () => api.get<RiskData>(`/api/v1/travel-risk/risk-score/${encodeURIComponent(submitted)}`),
    enabled: submitted.length === 2 || submitted.length === 3,
  })
  const advisories = useQuery({
    queryKey: ['travel-risk', 'advisories', submitted],
    queryFn: () => api.get<{ data?: Advisory[]; total?: number; fetched_at?: string; attribution?: { service?: string } }>(`/api/v1/travel-risk/advisories?iso=${encodeURIComponent(submitted)}`),
    enabled: submitted.length === 2 || submitted.length === 3,
  })
  const alerts = useQuery({
    queryKey: ['travel-risk', 'alerts', submitted],
    queryFn: () => api.get<{ data?: Alert[]; total?: number; generated_at?: string }>(`/api/v1/travel-risk/alerts?iso=${encodeURIComponent(submitted)}&limit=20`),
    enabled: submitted.length === 2 || submitted.length === 3,
  })
  const conflicts = useQuery({
    queryKey: ['travel-risk', 'conflicts', submitted],
    queryFn: () => api.get<{ data?: Conflict[]; total?: number }>(`/api/v1/travel-risk/conflicts?iso=${encodeURIComponent(submitted)}&limit=20`),
    enabled: submitted.length === 2 || submitted.length === 3,
  })

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(iso.trim().toUpperCase())
  }

  return (
    <div className="page travel-risk-page">
      <header className="pagehead">
        <div>
          <p className="eyebrow">Travel intelligence</p>
          <h1 className="pagehead__title">Travel risk</h1>
          <p className="pagehead__lede">Country risk scores, government advisories, active alerts and conflicts from Travel Risk API. Official government advisories are shown separately from the aggregated risk score.</p>
        </div>
      </header>

      <form className="flight-lookup-form" onSubmit={onSubmit} style={{ marginBottom: 'var(--space-m)' }}>
        <div className="field">
          <label htmlFor="tr-iso">Country code (ISO alpha-2 or alpha-3)</label>
          <input id="tr-iso" className="input" value={iso} onChange={(e) => setIso(e.target.value)} placeholder="USA" />
        </div>
        <button className="btn" type="submit">Look up</button>
      </form>

      {risk.isPending && <div className="skeleton skeleton-card" aria-busy="true" />}
      {risk.isError && <p role="alert" className="form-error">{risk.error.message}</p>}

      {risk.data && (
        <section className="data-panel">
          <h2 className="data-panel__title">Risk score — {risk.data.name ?? submitted}</h2>
          <div className="readout-row"><span className="readout-row__label">Risk score</span><span className="readout-row__value">{risk.data.risk_score ?? '—'} / 5</span></div>
          <div className="readout-row"><span className="readout-row__label">Advisory level</span><span className="readout-row__value">{risk.data.advisory_level ?? '—'} / 4</span></div>
          <div className="readout-row"><span className="readout-row__label">Active alerts</span><span className="readout-row__value">{risk.data.active_alerts ?? 0}</span></div>
          {risk.data.calculation?.method && <p className="form-note">{risk.data.calculation.method}</p>}
        </section>
      )}

      {advisories.data?.data && advisories.data.data.length > 0 && (
        <section className="data-panel">
          <h2 className="data-panel__title">Government advisories</h2>
          {advisories.data.data.map((a, i) => (
            <div key={i} style={{ marginBottom: 'var(--space-s)' }}>
              <p><strong>{a.summary_label ?? 'Advisory'}</strong> (max level {a.max_level ?? '—'})</p>
              {a.sources?.map((s, j) => (
                <p key={j} className="form-note">
                  {s.agency ?? 'Agency'} — level {s.level ?? '—'} · {s.summary_label ?? ''}
                  {s.url && <> · <a href={s.url} target="_blank" rel="noreferrer">source</a></>}
                  {s.updated_at && <> · updated {s.updated_at}</>}
                </p>
              ))}
              {a.reasons && a.reasons.length > 0 && <p className="form-note">Reasons: {a.reasons.join('; ')}</p>}
            </div>
          ))}
        </section>
      )}

      {alerts.data?.data && alerts.data.data.length > 0 && (
        <section className="data-panel">
          <h2 className="data-panel__title">Active alerts ({alerts.data.total ?? alerts.data.data.length})</h2>
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
        </section>
      )}

      {conflicts.data?.data && conflicts.data.data.length > 0 && (
        <section className="data-panel">
          <h2 className="data-panel__title">Conflicts ({conflicts.data.total ?? conflicts.data.data.length})</h2>
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
        </section>
      )}
    </div>
  )
}