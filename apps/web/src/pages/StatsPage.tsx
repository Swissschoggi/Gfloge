import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import type { StatsPayload } from '@gfloge/shared'
import { api } from '../api/client'
import { formatDistance, formatDuration } from '../format'
import { RouteSchematic } from '../components/RouteSchematic'

export function StatsPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<StatsPayload>('/api/v1/stats') })

  if (stats.isPending) {
    return (
      <div className="page">
        <p className="form-note">Loading statistics…</p>
      </div>
    )
  }
  if (stats.isError) {
    return (
      <div className="page">
        <h1>Stats</h1>
        <div role="alert" className="form-error">
          {(stats.error as Error).message}
          <div className="actions-row" style={{ marginTop: 'var(--space-s)' }}>
            <button className="btn" type="button" onClick={() => void stats.refetch()}>Retry</button>
          </div>
        </div>
      </div>
    )
  }

  const s = stats.data
  const maxKm = Math.max(1, ...s.perYear.map((y) => y.distanceKm))

  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <h1 className="pagehead__title">Stats</h1>
          <p className="pagehead__sub">Counts completed (flown) entries only; planned trips are excluded.</p>
        </div>
      </header>
      {s.flights === 0 ? (
        <>
          <RouteSchematic variant="route" />
          <p className="page__meta">
            Statistics count completed flights. Log a flight or import history and this page fills in.
          </p>
          <div className="actions-row">
            <Link className="btn" to="/logbook">Log a flight</Link>
          </div>
        </>
      ) : (
        <>
          <div className="statstrip">
            <StatBlock value={String(s.flights)} label="Flights flown" />
            <StatBlock value={formatDistance(s.distanceKm)} label="Distance" />
            <StatBlock value={formatDuration(s.minutes)} label="Time in the air" />
            <StatBlock value={String(s.uniqueAirports)} label="Airports" />
            <StatBlock value={String(s.uniqueAirlines)} label="Airlines" />
            <StatBlock value={String(s.uniqueAircraftTypes)} label="Aircraft types" />
            <StatBlock value={String(s.countriesVisited)} label="Countries visited" />
          </div>
          <div className="data-panel">
            <h2 className="data-panel__title">Distance per year</h2>
            {s.perYear.map((y) => (
              <div className="barchart__row" key={y.year}>
                <span className="barchart__label">{y.year}</span>
                <span className="barchart__track">
                  <span className="barchart__bar" style={{ width: `${Math.round((y.distanceKm / maxKm) * 100)}%` }} />
                </span>
                <span className="barchart__value">{formatDistance(y.distanceKm)}</span>
              </div>
            ))}
          </div>
          <div className="data-panel">
            <h2 className="data-panel__title">Most flown routes</h2>
            {s.routesFlown.length ? <ol className="route-ranking">{s.routesFlown.slice(0, 8).map((route) => <li key={route.route}><span className="mono">{route.route}</span><span className="route-ranking__count">{route.flights} flights</span></li>)}</ol> : <p className="form-note">Route totals appear as flown entries are added.</p>}
          </div>
        </>
      )}
      <p className="attribution">A personal coverage map arrives with the Explore milestone (provider-independent: uses your own records).</p>
    </div>
  )
}

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="stattile">
      <span className="stattile__value">{value}</span>
      <span className="stattile__label">{label}</span>
    </div>
  )
}
