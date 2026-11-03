import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import type { AirportInfo } from '@gfloge/shared'
import { api } from '../api/client'

export function ExplorePage() {
  const [tab, setTab] = useState<'airports' | 'airlines' | 'aircraft'>('airports')
  const [query, setQuery] = useState('')
  const airports = useQuery({ queryKey: ['airports', query], queryFn: () => api.get<{ results: AirportInfo[] }>(`/api/v1/airports?q=${encodeURIComponent(query)}`), enabled: tab === 'airports' })
  const airlines = useQuery({ queryKey: ['airlines'], queryFn: () => api.get<{ results: Array<{id:string;iata:string|null;icao:string|null;name:string;country:string|null}> }>('/api/v1/airlines'), enabled: tab === 'airlines' })
  const aircraft = useQuery({ queryKey: ['aircraft-types'], queryFn: () => api.get<{ aircraftTypes: Array<{id:string;iataType:string|null;icaoType:string|null;manufacturer:string;name:string;family:string|null}> }>('/api/v1/aircraft-types'), enabled: tab === 'aircraft' })
  const activeQuery = tab === 'airports' ? airports : tab === 'airlines' ? airlines : aircraft

  return (
    <div className="page">
      <h1 style={{fontSize:'var(--step-2)'}}>Explore</h1>
      <div className="explore-tabs" role="tablist" aria-label="Reference data">
        {(['airports','airlines','aircraft'] as const).map((item) => <button type="button" role="tab" aria-selected={tab===item} aria-controls={`explore-panel-${item}`} id={`explore-tab-${item}`} className={tab===item?'explore-tab explore-tab--active':'explore-tab'} key={item} onClick={()=>{setTab(item);setQuery('')}}>{item === 'aircraft' ? 'Aircraft types' : item[0]!.toUpperCase()+item.slice(1)}</button>)}
      </div>
      {(tab !== 'aircraft') && <div className="field"><label htmlFor="explore-search">Search {tab}</label><input id="explore-search" className="input" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder={tab === 'airports' ? 'IATA, city, or airport name' : 'Airline name or code'} /></div>}
      {activeQuery.isPending ? <p className="form-note">Loading reference data…</p> : activeQuery.isError ? <div role="alert" className="form-error">Could not load reference data. <button className="quietlink" onClick={()=>void activeQuery.refetch()}>Retry</button></div> : null}
      {tab === 'airports' && airports.data && <div className="data-panel"><h2 className="data-panel__title">Airports · {airports.data.results.length}</h2>{airports.data.results.length ? <ul className="explore-list">{airports.data.results.map(a=><li key={a.id}><Link className="explore-row" to={`/explore/airports/${a.id}`}><span className="airline-mark">{a.iata ?? a.icao}</span><span><strong>{a.name}</strong><small>{a.city}, {a.country} · {a.tz}</small></span><span className="menuitem__chevron">›</span></Link></li>)}</ul> : <p className="form-note">No airports match “{query}”. Clear or change your search.</p>}</div>}
      {tab === 'airlines' && airlines.data && <div className="data-panel"><h2 className="data-panel__title">Airlines · {airlines.data.results.length}</h2><ul className="explore-list">{airlines.data.results.filter(a=>`${a.name} ${a.iata??''} ${a.icao??''}`.toLowerCase().includes(query.toLowerCase())).map(a=><li key={a.id}><Link className="explore-row" to={`/explore/airlines/${a.id}`}><span className="airline-mark">{a.iata??a.icao}</span><span><strong>{a.name}</strong><small>{a.icao} · {a.country??'Country unknown'}</small></span><span className="menuitem__chevron">›</span></Link></li>)}</ul></div>}
      {tab === 'aircraft' && aircraft.data && <div className="data-panel"><h2 className="data-panel__title">Aircraft types · {aircraft.data.aircraftTypes.length}</h2><ul className="explore-list">{aircraft.data.aircraftTypes.map(a=><li key={a.id} className="explore-row"><span className="airline-mark">{a.icaoType??a.iataType??'?'}</span><span><strong>{a.name}</strong><small>{a.manufacturer} · IATA {a.iataType??'n/a'}</small></span></li>)}</ul></div>}
      <p className="attribution">Reference information is bundled with Gfloge. Flight schedules and operational data require a configured provider.</p>
    </div>
  )
}
