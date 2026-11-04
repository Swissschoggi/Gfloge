/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../api/client'

export function ExplorePage() {
  const [dep, setDep] = useState('')
  const [arr, setArr] = useState('')
  const [outDate, setOutDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [discoverResults, setDiscoverResults] = useState<any>(null)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const discover = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams()
      params.set('departure', dep)
      params.set('arrival', arr)
      params.set('outboundDate', outDate)
      return api.get<any>(`/api/v1/flight-discovery?${params.toString()}`)
    },
    onSuccess: (data) => { setDiscoverResults(data); setDiscoverError(null) },
    onError: (cause) => setDiscoverError(cause instanceof Error ? cause.message : 'Discovery failed'),
  })

  return (
    <div className="page explore-page">
      <header className="pagehead explore-masthead">
        <div>
          <p className="eyebrow">Flight discovery</p>
          <h1 className="pagehead__title">Discover flights</h1>
          <p className="pagehead__sub">Search Google Flights offers via SerpApi. Results are flight offers, not verified operations, and never enter your logbook automatically.</p>
        </div>
      </header>

      <div className="flight-lookup-form" style={{ marginBottom: 'var(--space-m)' }}>
        <div className="field"><span>From (IATA)</span><input className="input" value={dep} onChange={(e) => setDep(e.target.value.toUpperCase())} maxLength={4} placeholder="ZRH" /></div>
        <div className="field"><span>To (IATA)</span><input className="input" value={arr} onChange={(e) => setArr(e.target.value.toUpperCase())} maxLength={4} placeholder="JFK" /></div>
        <div className="field"><span>Date</span><input className="input" type="date" value={outDate} onChange={(e) => setOutDate(e.target.value)} /></div>
        <button className="btn" type="button" disabled={discover.isPending || !dep || !arr} onClick={() => discover.mutate()}>
          {discover.isPending ? 'Searching…' : 'Search'}
        </button>
      </div>
      {discoverError && <p role="alert" className="form-error">{discoverError}</p>}
      {discoverResults && (
        <ul className="candidate-list">
          {(discoverResults.best_flights ?? discoverResults.other_flights ?? []).map((f: any, i: number) => (
            <li key={i}>
              <div className="candidate-card">
                <div className="candidate-card__top">
                  <span className="candidate-card__code">{(f.flights?.[0]?.airline ?? 'Flight')} {f.flights?.[0]?.flight_number ?? ''}</span>
                  <span className="candidate-card__badge">{f.price ? `${f.price}` : ''}</span>
                </div>
                <div className="candidate-card__route">
                  {f.flights?.[0]?.departure_airport?.id ?? dep} → {f.flights?.[f.flights.length - 1]?.arrival_airport?.id ?? arr}
                </div>
                <div className="candidate-card__times">
                  <span>{f.flights?.[0]?.departure_airport?.time ?? ''}</span>
                  {f.flights?.[f.flights.length - 1]?.arrival_airport?.time && <span>Arrival {f.flights[f.flights.length - 1].arrival_airport.time}</span>}
                </div>
                <div className="candidate-card__meta">
                  <span>{f.total_duration ? `${Math.round(f.total_duration / 60)}h ${f.total_duration % 60}m` : ''}</span>
                  {f.carbon_emissions?.this_flight && <span>{f.carbon_emissions.this_flight}g CO₂</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}