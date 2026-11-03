import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import type { FlightRead } from '@gfloge/shared'
import { api } from '../api/client'
import { StatusBadge, ConditionChip } from '../components/StatusPresentation'
import { formatLocal } from '../format'

export function AirportDetailPage() {
  const { airportId = '' } = useParams()
  const query = useQuery({ queryKey: ['airport', airportId], queryFn: () => api.get<{
    airport: {id:string;iata:string|null;icao:string|null;name:string;city:string;country:string;tz:string;lat:number;lon:number}
    departures: Array<{flight:FlightRead;followedOrLogged:boolean}>
    arrivals: Array<{flight:FlightRead;followedOrLogged:boolean}>
    weather: {condition:'unsupported'|'unavailable';message:string}
    dataSource:string
  }>(`/api/v1/airports/${airportId}`) })
  if(query.isPending) return <div className="data-panel"><p>Loading airport…</p></div>
  if(query.isError) return <div role="alert" className="form-error">Airport unavailable. {(query.error as Error).message} <Link to="/explore">Back to Explore</Link></div>
  const {airport,departures,arrivals,weather,dataSource}=query.data
  return <div className="page">
    <Link className="quietlink" to="/explore">Explore airports</Link>
    <header className="data-panel airport-heading"><span className="airport-codes">{airport.iata??'---'} <span>{airport.icao}</span></span><h1 style={{fontSize:'var(--step-2)'}}>{airport.name}</h1><p>{airport.city}, {airport.country} · {airport.tz}</p><p className="mono">{airport.lat.toFixed(4)}°, {airport.lon.toFixed(4)}°</p></header>
    <div className="airport-map" role="img" aria-label={`Schematic airport location for ${airport.name}`}><span className="airport-map__cross">+</span><span className="airport-map__label">{airport.iata??airport.icao}</span><p>Map tiles are not connected. Airport coordinates shown.</p></div>
    <div className="airport-board-grid"><FlightList title="Departures · next 24 hours" rows={departures.map(x=>x.flight)} empty="No departure records for this airport in the next 24 hours."/><FlightList title="Arrivals · next 24 hours" rows={arrivals.map(x=>x.flight)} empty="No arrival records for this airport in the next 24 hours."/></div>
    <div className="data-panel"><h2 className="data-panel__title">Weather</h2><ConditionChip condition="unavailable"/><p className="form-note">{weather.message}</p></div>
    <p className="attribution">{dataSource}. Departure and arrival boards contain only records stored in this Gfloge instance.</p>
  </div>
}
function FlightList({title,rows,empty}:{title:string;rows:FlightRead[];empty:string}) { return <section className="data-panel"><h2 className="data-panel__title">{title}</h2>{rows.length?rows.map(f=><Link className="airport-flight" key={f.id} to={`/flight/${f.id}`}><StatusBadge status={f.status}/><span className="board-flightcode">{f.flightCode}</span><span className="board-route">{f.departure.iata} → {f.arrival.iata}</span><span className="mono">{formatLocal(f.scheduledDeparture,f.departure.tz)}</span></Link>):<p className="form-note">{empty}</p>}</section>}
