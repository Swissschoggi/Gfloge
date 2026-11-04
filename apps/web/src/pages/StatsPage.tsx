import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import type { StatsPayload, UserFlightItem } from '@gfloge/shared'
import { api } from '../api/client'
import { AtlasSurface, toAtlasAirport } from '../components/FlightAtlas'
import { formatDistance, formatDuration } from '../format'

export function StatsPage() {

  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<StatsPayload>('/api/v1/stats') })
  const logbook = useQuery({
    queryKey: ['logbook', '', ''],
    queryFn: () => api.get<{ flown: UserFlightItem[]; planned: UserFlightItem[]; manual: UserFlightItem[]; years: string[] }>('/api/v1/logbook'),
  })

  if (stats.isPending) {
    return <div className="page stats-page" aria-busy="true"><h1>Travel record</h1><p role="status">Loading completed-flight statistics…</p></div>
  }
  if (stats.isError) {
    return (
      <div className="page stats-page">
        <header className="pagehead"><p className="eyebrow">Statistics</p><h1>Travel record</h1></header>
        <div role="alert" className="form-error">Could not load your statistics. Check your connection and try again.</div>
        <button className="btn" type="button" onClick={() => void stats.refetch()}>Retry statistics</button>
      </div>
    )
  }

  const data = stats.data
  const maxKm = Math.max(1, ...data.perYear.map((year) => year.distanceKm))
  const routes = [
    ...(logbook.data?.flown ?? []),
    ...(logbook.data?.manual ?? []),
  ].map((item) => ({
    id: item.id,
    from: toAtlasAirport(item.flight.departure),
    to: toAtlasAirport(item.flight.arrival),
  }))
  const airports = [...new Map(routes.flatMap((route) => [[route.from.id, route.from], [route.to.id, route.to]])).values()]

  return (
    <div className="page stats-page">

      <header className="stats-heading">
        <div>
          <p className="eyebrow">Statistics</p>
          <h1>Travel record</h1>
          <p>Only flown logbook entries count here. Planned trips stay out of every total.</p>
        </div>
        <Link className="btn-outline" to="/logbook">Open logbook</Link>
      </header>

      <section className="stats-hero" aria-label="Travel totals">
        <Stat value={String(data.flights)} label="Flights flown" />
        <Stat value={formatDistance(data.distanceKm)} label="Distance travelled" />
        <Stat value={formatDuration(data.minutes)} label="Time in the air" />
      </section>

      <div className="stats-atlas-layout">
        <div className="stats-atlas-layout__map">
          <AtlasSurface
            routes={routes}
            airports={airports}
            heading="Routes flown"
            countLabel={`${routes.length} ${routes.length === 1 ? 'route' : 'routes'}`}
            footerLabel={logbook.isError ? 'Your route history could not be loaded.' : 'Each line connects airports in your flown logbook'}
            description="Geographic coverage of routes in your flown logbook, plotted from their recorded departure and arrival airport coordinates."
          />
          {logbook.isError && <button type="button" className="quietlink" onClick={() => void logbook.refetch()}>Retry route history</button>}
        </div>

        <aside className="stats-index" aria-label="Travel breakdown">
          <section className="stats-facts">
            <h2>Places & carriers</h2>
            <dl>
              <Fact label="Airports visited" value={data.uniqueAirports} />
              <Fact label="Airlines flown" value={data.uniqueAirlines} />
              <Fact label="Aircraft types" value={data.uniqueAircraftTypes} />
              <Fact label="Countries visited" value={data.countriesVisited} />
            </dl>
          </section>

          <section className="stats-years" aria-labelledby="distance-years-title">
            <div className="stats-section-heading">
              <h2 id="distance-years-title">Distance by year</h2>
              <span>km</span>
            </div>
            {data.perYear.length ? (
              <ol className="year-ledger">
                {data.perYear.map((year) => (
                  <li key={year.year} className="year-ledger__row">
                    <span className="year-ledger__year">{year.year}</span>
                    <span className="year-ledger__track" aria-hidden="true">
                      <span style={{ width: `${Math.max(2, Math.round((year.distanceKm / maxKm) * 100))}%` }} />
                    </span>
                    <span className="year-ledger__total">{formatDistance(year.distanceKm)}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="form-note">Year totals appear after you log a flown trip.</p>}
          </section>

          <section className="stats-routes" aria-labelledby="most-flown-title">
            <div className="stats-section-heading">
              <h2 id="most-flown-title">Most flown routes</h2>
              <Link to="/logbook">All flights</Link>
            </div>
            {data.routesFlown.length ? (
              <ol className="route-ranking">
                {data.routesFlown.slice(0, 8).map((route) => (
                  <li key={route.route}><span className="mono">{route.route}</span><span className="route-ranking__count">{route.flights} ×</span></li>
                ))}
              </ol>
            ) : <p className="form-note">Route rankings appear as flown entries are added.</p>}
          </section>
        </aside>
      </div>
      {data.flights === 0 && (
        <div className="stats-empty-note">
          <p>Your record begins with a completed flight. Add a past flight or import your travel history.</p>
          <Link className="btn" to="/add">Log a flight</Link>
        </div>
      )}
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="stats-hero__metric"><span className="stats-hero__value">{value}</span><span className="stats-hero__label">{label}</span></div>
}

function Fact({ label, value }: { label: string; value: number }) {
  return <div className="stats-fact"><dt>{label}</dt><dd>{value.toLocaleString()}</dd></div>
}
