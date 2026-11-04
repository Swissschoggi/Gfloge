import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import type { FlightRead } from '@gfloge/shared'
import { api } from '../api/client'
import { StatusBadge } from '../components/StatusPresentation'
import { IconChevron } from '../components/icons'
import { formatLocal } from '../format'

type AirlineResponse = {
  airline: { id: string; iata: string | null; icao: string | null; name: string; country: string | null; callsign: string | null }
  flights: FlightRead[]
}

export function AirlineDetailPage() {
  const { airlineId = '' } = useParams()
  const navigate = useNavigate()
  const query = useQuery({ queryKey: ['airline', airlineId], queryFn: () => api.get<AirlineResponse>(`/api/v1/airlines/${airlineId}`) })

  if (query.isPending) return <div className="page airline-detail-page" aria-busy="true"><p role="status">Loading airline record…</p></div>
  if (query.isError) {
    return (
      <div className="page airline-detail-page">
        <Link className="quietlink" to="/explore?tab=airlines">← Airline index</Link>
        <h1>Airline unavailable</h1>
        <p className="form-note">The airline record could not be loaded. It may have been removed from reference data.</p>
        <button className="btn-outline" type="button" onClick={() => void query.refetch()}>Retry</button>
      </div>
    )
  }

  const { airline, flights } = query.data
  const routes = [...flights.reduce((counts, flight) => {
    const route = `${flight.departure.iata} → ${flight.arrival.iata}`
    counts.set(route, (counts.get(route) ?? 0) + 1)
    return counts
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1])

  return (
    <div className="page airline-detail-page">
      <button type="button" className="back-link" onClick={() => navigate(-1)}>← Back</button>
      <Link className="quietlink" to="/explore?tab=airlines">Airline index</Link>
      <header className="airline-masthead">
        <div className="airline-masthead__mark">{airline.iata ?? airline.icao ?? '—'}</div>
        <div>
          <p className="eyebrow">{airline.country ?? 'Country not recorded'}</p>
          <h1>{airline.name}</h1>
          <p>{airline.icao ?? 'ICAO unavailable'}{airline.callsign ? ` · ${airline.callsign}` : ''}</p>
        </div>
        <div className="airline-masthead__total"><strong>{flights.length}</strong><span>flights in this instance</span></div>
      </header>

      <div className="airline-detail-layout">
        <section className="airline-flight-register" aria-labelledby="airline-flight-heading">
          <header className="airline-section-heading"><h2 id="airline-flight-heading">Flights in this instance</h2><span>{flights.length}</span></header>
          {flights.length ? (
            <ul className="airline-flight-list">
              {flights.map((flight) => (
                <li key={flight.id}>
                  <Link to={`/flight/${flight.id}`}>
                    <StatusBadge status={flight.status} />
                    <strong className="airline-flight-list__code">{flight.flightCode}</strong>
                    <span className="airline-flight-list__route">{flight.departure.iata} → {flight.arrival.iata}</span>
                    <time>{formatLocal(flight.scheduledDeparture, flight.departure.tz)} · {flight.departure.iata} local</time>
                    <IconChevron className="airline-flight-list__chevron" size={18} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="airline-empty">
              <p>No flights for this airline are stored in this instance yet.</p>
              <Link to="/add" className="btn-outline">Look up a flight</Link>
            </div>
          )}
        </section>

        <aside className="airline-route-index" aria-labelledby="airline-routes-heading">
          <header className="airline-section-heading"><h2 id="airline-routes-heading">Routes recorded</h2><span>{routes.length}</span></header>
          {routes.length ? <ol>{routes.map(([route, count]) => <li key={route}><span>{route}</span><strong>{count} ×</strong></li>)}</ol> : <p className="form-note">Route rankings appear as flights are added.</p>}
        </aside>
      </div>
    </div>
  )
}
