import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import type { FlightRead } from '@gfloge/shared'
import { api } from '../api/client'
import { StatusBadge } from '../components/StatusPresentation'

export function AirlineDetailPage() {
  const { airlineId = '' } = useParams()
  const q = useQuery({queryKey:['airline',airlineId],queryFn:()=>api.get<{airline:{id:string;iata:string|null;icao:string|null;name:string;country:string|null;callsign:string|null};flights:FlightRead[]}>(`/api/v1/airlines/${airlineId}`)})
  if(q.isPending) return <div className="data-panel"><p>Loading airline…</p></div>
  if(q.isError) return <div role="alert" className="form-error">Airline not found. <Link to="/explore">Back to Explore</Link></div>
  return <div className="page"><Link to="/explore" className="quietlink">Explore airlines</Link><header className="data-panel"><span className="airline-mark">{q.data.airline.iata??q.data.airline.icao}</span><h1 style={{fontSize:'var(--step-2)'}}>{q.data.airline.name}</h1><p>{q.data.airline.icao} · {q.data.airline.country??'Country unknown'}</p></header><section className="data-panel"><h2 className="data-panel__title">Flights in this instance</h2>{q.data.flights.length?q.data.flights.map(f=><Link className="airport-flight" to={`/flight/${f.id}`} key={f.id}><StatusBadge status={f.status}/><span className="board-flightcode">{f.flightCode}</span><span className="board-route">{f.departure.iata} → {f.arrival.iata}</span></Link>):<p className="form-note">No flights for this airline are stored yet.</p>}</section></div>
}
