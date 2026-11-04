import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { api } from '../api/client'
import { formatLocal } from '../format'

type SharedTrip = {
  shared: boolean
  readOnly: boolean
  trip: {
    title: string
    startDate: string | null
    endDate: string | null
    flights: Array<{
      flightCode: string
      airline: { iata: string | null; name: string | null } | null
      departure: { iata: string | null; icao: string | null; city: string; name: string; tz: string | null }
      arrival: { iata: string | null; icao: string | null; city: string; name: string; tz: string | null }
      scheduledDeparture: string
      scheduledArrival: string
      actualArrival: string | null
      status: string
      planned: boolean
    }>
  }
}

export function ShareTripPage() {
  const { token = '' } = useParams()
  const q = useQuery<SharedTrip>({
    queryKey: ['share-trip', token],
    queryFn: () => api.get<SharedTrip>(`/api/v1/share/trips/${token}`),
    retry: false,
  })

  if (q.isPending) return <div className="page"><p role="status">Loading shared trip…</p></div>
  if (q.isError) return <div className="page"><h1>Shared trip unavailable</h1><p className="form-note">This link may have been revoked or expired.</p></div>

  const trip = q.data!.trip
  return (
    <div className="page share-page">
      <meta name="robots" content="noindex" />
      <header className="pagehead">
        <p className="eyebrow">Shared read-only itinerary</p>
        <h1 className="pagehead__title">{trip.title}</h1>
        <p className="pagehead__sub">{trip.flights.length} flights · {trip.startDate ? trip.startDate.slice(0, 10) : 'Dates flexible'}</p>
      </header>
      <ol className="trip-itinerary">
        {trip.flights.map((flight, index) => {
          const depCode = flight.departure.iata ?? flight.departure.icao
          const arrCode = flight.arrival.iata ?? flight.arrival.icao
          return (
            <li key={index}>
              <span className="trip-itinerary__number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{depCode} → {arrCode}</strong>
                <small>{flight.flightCode} · {flight.airline?.name ?? 'Unknown airline'} · {flight.planned ? 'Planned (unconfirmed)' : 'Confirmed'}</small>
                <div className="trip-itinerary__times">
                  <span>Departs {formatLocal(flight.scheduledDeparture, flight.departure.tz)} {depCode} local</span>
                  <span>Arrives {formatLocal(flight.actualArrival ?? flight.scheduledArrival, flight.arrival.tz)} {arrCode} local</span>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="form-note">This is a read-only shared view. Private notes, seats and booking references are not included.</p>
    </div>
  )
}
