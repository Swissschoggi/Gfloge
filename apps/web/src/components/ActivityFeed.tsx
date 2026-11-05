import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { AlertsPayload } from '@gfloge/shared'
import { api } from '../api/client'

type Props = { flightId?: string; limit?: number }

export function ActivityFeed({ flightId, limit = 8 }: Props) {
  const url = flightId ? `/api/v1/flights/${encodeURIComponent(flightId)}/alerts` : `/api/v1/alerts?limit=${limit}`
  const q = useQuery<{ alerts: AlertsPayload[] }>({ queryKey: ['alerts', flightId ?? 'all', limit], queryFn: () => api.get<{ alerts: AlertsPayload[] }>(url) })
  const alerts = q.data?.alerts ?? []

  if (q.isPending) return <p className="form-note" role="status">Loading activity…</p>
  if (q.isError) return <p role="alert" className="form-error">Could not load activity.</p>
  if (alerts.length === 0) return <p className="form-note" role="status">No activity yet.</p>

  return (
    <ul className="activity-feed" aria-label="Activity feed">
      {alerts.map((a) => {
        const critical = a.type === 'cancel' || a.type === 'delay'
        return (
          <li key={a.id}>
            {a.flightId ? (
              <Link to={`/flight/${a.flightId}`} className={`activity-card${critical ? " activity-card--critical" : ""}`}>
                <span className="activity-card__body">
                  <span className="activity-card__headline">{a.headline}</span>
                  <span className="activity-card__meta">{a.flightCode ?? ''} · {relativeTime(a.createdAt)}</span>
                </span>
              </Link>
            ) : (
              <div className={`activity-card${critical ? " activity-card--critical" : ""}`}>
                <span className="activity-card__body">
                  <span className="activity-card__headline">{a.headline}</span>
                  <span className="activity-card__meta">{relativeTime(a.createdAt)}</span>
                </span>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  const min = Math.round(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}