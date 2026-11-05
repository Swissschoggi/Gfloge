import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { FlightRead } from '@gfloge/shared'
import { api } from '../api/client'
import { formatDate, formatDuration, formatLocal } from '../format'
import { StatusBadge } from '../components/StatusPresentation'
import { AtlasSurface, toAtlasAirport } from '../components/FlightAtlas'

type AircraftProfile = {
  registration: string
  aircraft: { source: string; fetchedAt: string } | null
  type: { icaoType: string | null; iataType: string | null; manufacturer: string | null; name: string; family: string | null } | null
  firstSeen: string | null
  lastSeen: string | null
  stats: { flights: number; distanceKm: number; airports: string[]; airlines: string[] }
  flights: FlightRead[]
}

export function AircraftProfilePage() {
  const { registration = '' } = useParams()
  const reg = decodeURIComponent(registration)
  const q = useQuery<AircraftProfile>({
    queryKey: ['aircraft', reg],
    queryFn: () => api.get<AircraftProfile>(`/api/v1/aircraft/${encodeURIComponent(reg)}`),
  })

  if (q.isPending) return <div className="page"><p role="status">Loading aircraft…</p></div>
  if (q.isError) return <div className="page"><h1>Aircraft not found</h1><p className="form-note">No profile for this registration.</p><Link to="/logbook" className="btn-outline">Back</Link></div>

  const data = q.data!
  return (
    <div className="page aircraft-page">
      <header className="pagehead">
        <p className="eyebrow">Aircraft profile</p>
        <h1 className="pagehead__title" style={{ fontFamily: 'var(--font-mono)' }}>{data.registration}</h1>
        <p className="pagehead__sub">{data.type ? `${data.type.manufacturer ?? ''} ${data.type.name}`.trim() : 'Unknown type'}{data.type?.icaoType ? ` · ${data.type.icaoType}` : ''}</p>
      </header>

      <div className="data-panel">
        <h2 className="data-panel__title">Identity</h2>
        <div className="readout-row"><span className="readout-row__label">Registration</span><span className="readout-row__value">{data.registration}</span></div>
        {data.type && <>
          <div className="readout-row"><span className="readout-row__label">Manufacturer</span><span className="readout-row__value">{data.type.manufacturer ?? 'not recorded'}</span></div>
          <div className="readout-row"><span className="readout-row__label">Type</span><span className="readout-row__value">{data.type.name}</span></div>
          <div className="readout-row"><span className="readout-row__label">Family</span><span className="readout-row__value">{data.type.family ?? 'not recorded'}</span></div>
          <div className="readout-row"><span className="readout-row__label">ICAO type</span><span className="readout-row__value">{data.type.icaoType ?? 'not recorded'}</span></div>
          <div className="readout-row"><span className="readout-row__label">IATA type</span><span className="readout-row__value">{data.type.iataType ?? 'not recorded'}</span></div>
        </>}
        {data.firstSeen && <div className="readout-row"><span className="readout-row__label">First seen</span><span className="readout-row__value">{formatDate(data.firstSeen, null)}</span></div>}
        {data.lastSeen && <div className="readout-row"><span className="readout-row__label">Last seen</span><span className="readout-row__value">{formatDate(data.lastSeen, null)}</span></div>}
        {data.aircraft && <div className="readout-row"><span className="readout-row__label">Source</span><span className="readout-row__value">{data.aircraft.source}</span></div>}
        {data.type && <Link to={`/aircraft-type/${data.type.icaoType}`} className="quietlink">View aircraft type</Link>}
      </div>

      <div className="data-panel">
        <h2 className="data-panel__title">Your statistics</h2>
        <div className="readout-row"><span className="readout-row__label">Flights logged</span><span className="readout-row__value">{data.stats.flights}</span></div>
        <div className="readout-row"><span className="readout-row__label">Distance logged</span><span className="readout-row__value">{data.stats.distanceKm} km</span></div>
        <div className="readout-row"><span className="readout-row__label">Airports visited</span><span className="readout-row__value">{data.stats.airports.join(', ') || 'none'}</span></div>
        <div className="readout-row"><span className="readout-row__label">Airlines</span><span className="readout-row__value">{data.stats.airlines.join(', ') || 'none'}</span></div>
        <p className="form-note">Statistics reflect only your own Gfloge records.</p>
      </div>

      {data.flights.length > 0 && (
        <section className="trip-itinerary-section">
          <header className="trip-form-heading"><h2>Flight history</h2><span>{data.flights.length} flights</span></header>
          <ol className="trip-itinerary">
            {data.flights.map((flight) => (
              <li key={flight.id}>
                <div>
                  <Link to={`/flight/${flight.id}`}><strong>{flight.departure.iata ?? flight.departure.icao} → {flight.arrival.iata ?? flight.arrival.icao}</strong></Link>
                  <small>{flight.flightCode} · {formatDate(flight.scheduledDeparture, flight.departure.tz)} · {flight.airline?.name ?? ''}</small>
                  <div className="trip-itinerary__times">
                    <span>{formatLocal(flight.scheduledDeparture, flight.departure.tz)} → {formatLocal(flight.actualArrival ?? flight.scheduledArrival, flight.arrival.tz)}</span>
                    <span>{formatDuration(Math.round((new Date(flight.actualArrival ?? flight.scheduledArrival).getTime() - new Date(flight.actualDeparture ?? flight.scheduledDeparture).getTime()) / 60000))}</span>
                  </div>
                  <StatusBadge status={flight.status} />
                </div>
              </li>
            ))}
          </ol>
          <AtlasSurface
            routes={data.flights.map((f) => ({ id: f.id, code: f.flightCode, from: toAtlasAirport(f.departure), to: toAtlasAirport(f.arrival) }))}
            airports={[]}
            heading="Aircraft routes"
            countLabel={`${data.flights.length} flights`}
          />
        </section>
      )}
    </div>
  )
}
