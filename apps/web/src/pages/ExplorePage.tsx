import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AirportSearchResult, FlightDiscoveryOffer, FlightDiscoveryResult } from '@gfloge/shared'
import { api } from '../api/client'

type SortKey = 'price' | 'duration' | 'departure'

function parseTimeToHHMM(text?: string): string | null {
  if (!text) return null
  const match = text.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!match) return null
  let hours = Number(match[1])
  const minutes = match[2]
  const meridiem = match[3]?.toUpperCase()
  if (meridiem === 'AM' && hours === 12) hours = 0
  if (meridiem === 'PM' && hours !== 12) hours += 12
  return `${String(hours).padStart(2, '0')}:${minutes}`
}

function formatDurationMinutes(minutes: number | undefined): string {
  if (minutes === undefined || minutes === null) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function stopsLabel(offer: FlightDiscoveryOffer): string {
  const legs = offer.flights?.length ?? 0
  const layovers = offer.layovers?.length ?? Math.max(legs - 1, 0)
  if (layovers === 0) return 'Nonstop'
  return `${layovers} stop${layovers === 1 ? '' : 's'}`
}

function sortOffers(list: FlightDiscoveryOffer[], sortKey: SortKey): FlightDiscoveryOffer[] {
  const copy = [...list]
  copy.sort((a, b) => {
    if (sortKey === 'price') return (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY)
    if (sortKey === 'duration') return (a.total_duration ?? Number.POSITIVE_INFINITY) - (b.total_duration ?? Number.POSITIVE_INFINITY)
    const ta = a.flights?.[0]?.departure_airport?.time ?? ''
    const tb = b.flights?.[0]?.departure_airport?.time ?? ''
    return ta.localeCompare(tb)
  })
  return copy
}

function AirportAutocomplete({
  label,
  selected,
  onSelect,
}: {
  label: string
  selected: AirportSearchResult | null
  onSelect: (value: AirportSearchResult | null) => void
}) {
  const [query, setQuery] = useState('')
  const results = useQuery({
    queryKey: ['airports', query],
    queryFn: () => api.get<{ results: AirportSearchResult[] }>(`/api/v1/airports?q=${encodeURIComponent(query)}`).then((r) => r.results),
    enabled: query.trim().length > 0 && !selected,
  })

  return (
    <fieldset className="airport-picker">
      <legend>{label}</legend>
      <input
        className="input"
        value={selected ? `${selected.iata ?? selected.icao ?? ''} · ${selected.name}` : query}
        onChange={(event) => {
          setQuery(event.target.value)
          onSelect(null)
        }}
        placeholder="City, airport name or IATA/ICAO code"
      />
      {!selected && (results.data?.length ?? 0) > 0 && (
        <ul className="combobox-list" role="listbox" aria-label={`${label} options`}>
          {(results.data ?? []).slice(0, 12).map((airport) => (
            <li key={airport.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => { onSelect(airport); setQuery('') }}>
                <span>{airport.iata ?? airport.icao ?? '—'}</span>
                <span>{airport.name}</span>
                <small>{[airport.city, airport.country].filter(Boolean).join(' · ')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <button type="button" className="quietlink" onClick={() => { onSelect(null); setQuery('') }}>
          Clear
        </button>
      )}
    </fieldset>
  )
}

function OfferCard({
  offer,
  origin,
  destination,
  outboundDate,
}: {
  offer: FlightDiscoveryOffer
  origin: AirportSearchResult | null
  destination: AirportSearchResult | null
  outboundDate: string
}) {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [selectedTripId, setSelectedTripId] = useState('')
  const [newTripName, setNewTripName] = useState('')
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tripsQuery = useQuery({
    queryKey: ['trips'],
    queryFn: () => api.get<{ trips: Array<{ id: string; name: string }> }>('/api/v1/trips'),
    enabled: showAdd,
  })

  async function handleAdd() {
    setError(null)
    if (!origin || !destination) {
      setError('Choose origin and destination airports first.')
      return
    }
    const depCode = origin.iata ?? origin.icao
    const arrCode = destination.iata ?? destination.icao
    if (!depCode || !arrCode) {
      setError('Selected airports need an IATA or ICAO code.')
      return
    }
    const firstLeg = offer.flights?.[0]
    const lastLeg = offer.flights?.[offer.flights.length - 1]
    const depTime = parseTimeToHHMM(firstLeg?.departure_airport?.time)
    const arrTime = parseTimeToHHMM(lastLeg?.arrival_airport?.time)
    if (!depTime || !arrTime) {
      setError('This offer is missing departure or arrival times, so it cannot be added as a planned trip.')
      return
    }
    let arrivalDate = outboundDate
    if (arrTime <= depTime) {
      const next = new Date(outboundDate)
      next.setDate(next.getDate() + 1)
      arrivalDate = next.toISOString().slice(0, 10)
    }
    setAdding(true)
    try {
      const createdFlight = await api.post<{ manualFlightId: string }>('/api/v1/manual-flights', {
        departureIata: origin.iata ?? undefined,
        departureIcao: origin.icao ?? undefined,
        arrivalIata: destination.iata ?? undefined,
        arrivalIcao: destination.icao ?? undefined,
        departureLocal: `${outboundDate}T${depTime}`,
        arrivalLocal: `${arrivalDate}T${arrTime}`,
        flightNumber: firstLeg?.flight_number ?? undefined,
      })
      const relation = await api.post<{ id?: string }>('/api/v1/user-flights', {
        manualFlightId: createdFlight.manualFlightId,
        follow: false,
        logging: { state: 'planned', cabin: 'none' },
      })
      const userFlightId = (relation as { id?: string }).id
      let tripId = selectedTripId
      if (!tripId && newTripName.trim()) {
        const trip = await api.post<{ trip: { id: string } }>('/api/v1/trips', { name: newTripName.trim() })
        tripId = trip.trip.id
      }
      if (tripId && userFlightId) {
        await api.put(`/api/v1/trips/${tripId}/flights/${userFlightId}`)
      }
      setAdded(true)
      setShowAdd(false)
      void queryClient.invalidateQueries({ queryKey: ['trips'] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add this offer.')
    } finally {
      setAdding(false)
    }
  }

  const firstLeg = offer.flights?.[0]
  const lastLeg = offer.flights?.[offer.flights.length - 1]
  const operatingAirline = firstLeg?.airline ?? 'Unknown airline'

  return (
    <li>
      <article className="candidate-card">
        <div className="candidate-card__top">
          <span className="candidate-card__code">{operatingAirline} {firstLeg?.flight_number ?? ''}</span>
          <span className="candidate-card__badge">{offer.price !== undefined ? offer.price : ''}</span>
        </div>
        <div className="candidate-card__route">
          {firstLeg?.departure_airport?.id ?? origin?.iata ?? origin?.icao ?? '?'} → {lastLeg?.arrival_airport?.id ?? destination?.iata ?? destination?.icao ?? '?'}
        </div>
        <div className="candidate-card__times">
          {firstLeg?.departure_airport?.time && <span>Departs {firstLeg.departure_airport.time}</span>}
          {lastLeg?.arrival_airport?.time && <span>Arrives {lastLeg.arrival_airport.time}</span>}
        </div>
        <div className="candidate-card__meta">
          <span>{formatDurationMinutes(offer.total_duration)}</span>
          <span>{stopsLabel(offer)}</span>
          {offer.layovers?.map((layover, index) => (
            <span key={index}>{layover.duration ? `${Math.round(layover.duration / 60)}h ${layover.duration % 60}m in ${layover.name ?? layover.id ?? 'connection'}` : (layover.name ?? '')}</span>
          ))}
          {offer.carbon_emissions?.this_flight && <span>{offer.carbon_emissions.this_flight}g CO₂</span>}
        </div>
        {!added ? (
          <div className="candidate-card__actions">
            {!showAdd ? (
              <button type="button" className="btn-outline" onClick={() => setShowAdd(true)}>
                Add as planned trip
              </button>
            ) : (
              <div className="field" style={{ gap: 'var(--space-2xs)' }}>
                <select className="select" value={selectedTripId} onChange={(event) => setSelectedTripId(event.target.value)}>
                  <option value="">Choose existing trip</option>
                  {(tripsQuery.data?.trips ?? []).map((trip) => (
                    <option key={trip.id} value={trip.id}>{trip.name}</option>
                  ))}
                </select>
                <input className="input" placeholder="Or new trip name" value={newTripName} onChange={(event) => setNewTripName(event.target.value)} />
                <div className="actions-row">
                  <button type="button" className="btn" disabled={adding || (!selectedTripId && !newTripName.trim())} onClick={() => void handleAdd()}>
                    {adding ? 'Adding…' : 'Add planned'}
                  </button>
                  <button type="button" className="btn-outline" onClick={() => setShowAdd(false)}>Cancel</button>
                </div>
                {error && <p className="form-error" role="alert">{error}</p>}
              </div>
            )}
          </div>
        ) : (
          <p className="form-note" role="status">Added as a planned, unconfirmed itinerary item.</p>
        )}
      </article>
    </li>
  )
}

export function ExplorePage() {
  const [origin, setOrigin] = useState<AirportSearchResult | null>(null)
  const [destination, setDestination] = useState<AirportSearchResult | null>(null)
  const [outDate, setOutDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [sortKey, setSortKey] = useState<SortKey>('price')
  const [results, setResults] = useState<FlightDiscoveryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const discover = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams()
      if (origin?.iata ?? origin?.icao) params.set('departure', (origin.iata ?? origin.icao) as string)
      if (destination?.iata ?? destination?.icao) params.set('arrival', (destination.iata ?? destination.icao) as string)
      params.set('outboundDate', outDate)
      return api.get<FlightDiscoveryResult>(`/api/v1/flight-discovery?${params.toString()}`)
    },
    onSuccess: (data) => { setResults(data); setError(null) },
    onError: (cause) => { setError(cause instanceof Error ? cause.message : 'Discovery failed'); setResults(null) },
  })

  const best = sortOffers(results?.best_flights ?? [], sortKey)
  const other = sortOffers(results?.other_flights ?? [], sortKey)
  const hasResults = best.length > 0 || other.length > 0

  return (
    <div className="page explore-page">
      <header className="pagehead explore-masthead">
        <div>
          <p className="eyebrow">Flight discovery</p>
          <h1 className="pagehead__title">Discover flights</h1>
          <p className="pagehead__sub">Search flight offers via SerpApi. Results are flight offers, not verified operations, and never enter your logbook automatically.</p>
        </div>
      </header>

      <div className="flight-lookup-form" style={{ marginBottom: 'var(--space-m)' }}>
        <AirportAutocomplete label="From" selected={origin} onSelect={setOrigin} />
        <AirportAutocomplete label="To" selected={destination} onSelect={setDestination} />
        <div className="field">
          <label htmlFor="explore-date">Date</label>
          <input id="explore-date" className="input" type="date" value={outDate} onChange={(event) => setOutDate(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="explore-sort">Sort by</label>
          <select id="explore-sort" className="select" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            <option value="price">Price</option>
            <option value="duration">Duration</option>
            <option value="departure">Departure time</option>
          </select>
        </div>
        <button className="btn" type="button" disabled={discover.isPending || !origin || !destination} onClick={() => discover.mutate()}>
          {discover.isPending ? 'Searching…' : 'Search'}
        </button>
      </div>

      {discover.isPending && (
        <div className="manifest-state" role="status" aria-busy="true">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      )}

      {error && (
        <div className="manifest-state" role="alert">
          <p>{error}</p>
          {error.toLowerCase().includes('not configured') && <p className="form-note">Configure a SerpApi key in Settings to enable discovery.</p>}
        </div>
      )}

      {results && !discover.isPending && !hasResults && (
        <div className="manifest-state manifest-state--empty">
          <h3>No offers found</h3>
          <p>Try different airports or dates.</p>
        </div>
      )}

      {results && !discover.isPending && hasResults && (
        <div className="explore-results">
          {best.length > 0 && (
            <section className="manifest-group" aria-label="Recommended flights">
              <h2 className="manifest-group__heading"><span>Recommended</span><span>{best.length}</span></h2>
              <ul className="candidate-list">
                {best.map((offer, index) => (
                  <OfferCard key={`best-${index}`} offer={offer} origin={origin} destination={destination} outboundDate={outDate} />
                ))}
              </ul>
            </section>
          )}
          {other.length > 0 && (
            <section className="manifest-group" aria-label="Other flight options">
              <h2 className="manifest-group__heading"><span>Other options</span><span>{other.length}</span></h2>
              <ul className="candidate-list">
                {other.map((offer, index) => (
                  <OfferCard key={`other-${index}`} offer={offer} origin={origin} destination={destination} outboundDate={outDate} />
                ))}
              </ul>
            </section>
          )}
          {results.price_insights && (
            <p className="form-note">
              Price insights: {results.price_insights.price_level ?? 'unknown'} · typical range {results.price_insights.typical_price_range?.join(' – ') ?? 'n/a'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
