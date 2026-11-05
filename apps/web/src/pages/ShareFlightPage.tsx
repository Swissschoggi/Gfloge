import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import type { FlightRead } from '@gfloge/shared'
import { api } from '../api/client'
import { formatDuration, formatLocal } from '../format'

export function ShareFlightPage() {
  const { token = '' } = useParams()
  const q = useQuery({
    queryKey: ['share-flight', token],
    queryFn: () => api.get<{ shared: boolean; readOnly: boolean; flight: FlightRead & { airline: FlightRead['airline'] } }>(`/api/v1/share/flights/${token}`),
    retry: false,
  })

  if (q.isPending) return <div className="page"><p role="status">Loading shared flight…</p></div>
  if (q.isError) return <div className="page"><h1>Shared flight unavailable</h1><p className="form-note">This link may have been revoked or expired.</p></div>

  const flight = q.data!.flight as unknown as FlightRead
  const depCode = flight.departure.iata ?? flight.departure.icao
  const arrCode = flight.arrival.iata ?? flight.arrival.icao

  return (
    <div className="page share-page">
      <meta name="robots" content="noindex" />
      <header className="pagehead">
        <p className="eyebrow">Shared read-only view</p>
        <h1 className="pagehead__title">{flight.flightCode}</h1>
        <p className="pagehead__sub">{flight.airline?.name ?? 'Flight'} · {depCode} → {arrCode}</p>
      </header>
      <div className="data-panel">
        <div className="readout-row"><span className="readout-row__label">Route</span><span className="readout-row__value">{depCode} → {arrCode}</span></div>
        <div className="readout-row"><span className="readout-row__label">Status</span><span className="readout-row__value">{flight.status}</span></div>
        <div className="readout-row"><span className="readout-row__label">Departure</span><span className="readout-row__value">{formatLocal(flight.scheduledDeparture, flight.departure.tz)} {depCode} local</span></div>
        <div className="readout-row"><span className="readout-row__label">Arrival</span><span className="readout-row__value">{formatLocal(flight.actualArrival ?? flight.scheduledArrival, flight.arrival.tz)} {arrCode} local</span></div>
        <div className="readout-row"><span className="readout-row__label">Duration</span><span className="readout-row__value">{formatDuration(Math.round((new Date(flight.actualArrival ?? flight.scheduledArrival).getTime() - new Date(flight.actualDeparture ?? flight.scheduledDeparture).getTime()) / 60000))}</span></div>
        {flight.aircraft && <div className="readout-row"><span className="readout-row__label">Aircraft</span><span className="readout-row__value">{flight.aircraft.registration ?? ''} {flight.aircraft.icaoType ?? ''}</span></div>}
        {flight.distanceKm !== null && <div className="readout-row"><span className="readout-row__label">Distance</span><span className="readout-row__value">{flight.distanceKm} km</span></div>}
      </div>
      <p className="form-note">This is a read-only shared view. Booking references, seats and private notes are not included.</p>
    </div>
  )
}
