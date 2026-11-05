import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import type { FlightRead } from '@gfloge/shared'
import { api } from '../api/client'
import { AtlasSurface, toAtlasAirport } from '../components/FlightAtlas'
import { ConditionChip, StatusBadge } from '../components/StatusPresentation'
import { formatLocal } from '../format'

type AirportResponse = {
  airport: { id: string; iata: string | null; icao: string | null; name: string; city: string; country: string; tz: string; lat: number; lon: number }
  departures: Array<{ flight: FlightRead; followedOrLogged: boolean }>
  arrivals: Array<{ flight: FlightRead; followedOrLogged: boolean }>
  weather: { condition: 'unsupported' | 'unavailable'; message: string }
  dataSource: string
}

export function AirportDetailPage() {
  const { airportId = '' } = useParams()
  const query = useQuery({ queryKey: ['airport', airportId], queryFn: () => api.get<AirportResponse>(`/api/v1/airports/${airportId}`) })

  if (query.isPending) return <div className="page reference-detail-page" aria-busy="true"><p role="status">Loading airport record…</p></div>
  if (query.isError) {
    return (
      <div className="page reference-detail-page">
        <Link className="quietlink" to="/explore?tab=airports">← Airport index</Link>
        <h1>Airport unavailable</h1>
        <p className="form-note">The airport record could not be loaded. It may have been removed from reference data.</p>
        <button className="btn-outline" type="button" onClick={() => void query.refetch()}>Retry</button>
      </div>
    )
  }

  const { airport, departures, arrivals, weather, dataSource } = query.data
  const mapAirport = toAtlasAirport(airport)
  return (
    <div className="page reference-detail-page airport-detail-page">
      <Link className="back-link" to="/explore?tab=airports">← Airport index</Link>
      <header className="airport-masthead">
        <div className="airport-masthead__codes">
          <span>{airport.iata ?? '—'}</span>
          <span>{airport.icao ?? 'ICAO unavailable'}</span>
        </div>
        <div className="airport-masthead__identity">
          <p className="eyebrow">{airport.city}, {airport.country}</p>
          <h1>{airport.name}</h1>
          <p>{airport.tz} local time</p>
        </div>
        <dl className="airport-masthead__coordinates">
          <div><dt>Latitude</dt><dd>{airport.lat.toFixed(4)}°</dd></div>
          <div><dt>Longitude</dt><dd>{airport.lon.toFixed(4)}°</dd></div>
        </dl>
      </header>

      <div className="airport-detail-layout">
        <div className="airport-detail-layout__map">
          <AtlasSurface
            routes={[]}
            airports={[mapAirport]}
            featuredAirportId={mapAirport.id}
            initialCenter={[airport.lat, airport.lon]}
            initialZoom={7}
            heading="Airport location"
            countLabel={airport.iata ?? airport.icao ?? 'Airport'}
            footerLabel={dataSource}
            description={`Map framed on ${airport.name}.`}
          />
        </div>
        <aside className="airport-operations" aria-label="Airport activity and conditions">
          <section className="airport-board-section" aria-labelledby="departures-heading">
            <header><h2 id="departures-heading">Departures</h2><span>Next 24 hours · {departures.length}</span></header>
            <FlightList rows={departures.map((entry) => entry.flight)} empty={`No departure records for ${airport.iata ?? airport.name} in the next 24 hours.`} />
          </section>
          <section className="airport-board-section" aria-labelledby="arrivals-heading">
            <header><h2 id="arrivals-heading">Arrivals</h2><span>Next 24 hours · {arrivals.length}</span></header>
            <FlightList rows={arrivals.map((entry) => entry.flight)} empty={`No arrival records for ${airport.iata ?? airport.name} in the next 24 hours.`} />
          </section>
          {weather.condition !== 'unsupported' && (
          <section className="airport-weather" aria-labelledby="airport-weather-heading">
            <h2 id="airport-weather-heading">Weather</h2>
            <ConditionChip condition={weather.condition} />
            <p>{weather.message}</p>
          </section>
          )}
        </aside>
      </div>
    </div>
  )
}

function FlightList({ rows, empty }: { rows: FlightRead[]; empty: string }) {
  if (rows.length === 0) return <p className="airport-board-empty">{empty}</p>
  return (
    <ul className="airport-flight-list">
      {rows.map((flight) => (
        <li key={flight.id}>
          <Link to={`/flight/${flight.id}`}>
            <StatusBadge status={flight.status} />
            <strong>{flight.flightCode}</strong>
            <span>{flight.departure.iata} → {flight.arrival.iata}</span>
            <time>{formatLocal(flight.scheduledDeparture, flight.departure.tz)}</time>
          </Link>
        </li>
      ))}
    </ul>
  )
}
