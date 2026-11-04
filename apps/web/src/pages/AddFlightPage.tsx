import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AirlineSearchResult, AirportSearchResult, FlightRead, FlightSearchCandidate, FlightSearchResponse } from '@gfloge/shared'
import { api } from '../api/client'
// StatusBadge intentionally omitted; candidate evidence labels carry source confidence.

type Mode = 'track' | 'log'

export function AddFlightPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('track')
  const [code, setCode] = useState('')
  const [departure, setDeparture] = useState<AirportSearchResult | null>(null)
  const [arrival, setArrival] = useState<AirportSearchResult | null>(null)
  const [airline, setAirline] = useState<AirlineSearchResult | null>(null)
  const [date, setDate] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  const [departureTime, setDepartureTime] = useState('')
  const [registration, setRegistration] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [result, setResult] = useState<FlightSearchResponse | null>(null)
  const [selected, setSelected] = useState<FlightSearchCandidate | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [follow, setFollow] = useState(true)
  const [manualId, setManualId] = useState<string | null>(null)

  const airports = useQuery({
    queryKey: ['airports', ''],
    queryFn: () => api.get<{ results: AirportSearchResult[] }>('/api/v1/airports'),
  })

  const airlines = useQuery({
    queryKey: ['airlines', ''],
    queryFn: () => api.get<{ results: AirlineSearchResult[] }>('/api/v1/airlines'),
  })

  const lookup = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams()
      params.set('date', date)
      if (code) params.set('code', code)
      if (departure) params.set('departure', departure.iata ?? departure.icao ?? '')
      if (arrival) params.set('arrival', arrival.iata ?? arrival.icao ?? '')
      if (airline) params.set('airline', airline.iata ?? airline.icao ?? airline.name)
      if (departureTime) params.set('departureTime', departureTime)
      if (registration) params.set('registration', registration)
      return api.get<FlightSearchResponse & { results: FlightRead[] }>(`/api/v1/flights/lookup?${params.toString()}`)
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Lookup failed'),
  })

  const createManual = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<{ flight: FlightRead; manualFlightId: string }>('/api/v1/manual-flights', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['logbook'] })
      void queryClient.invalidateQueries({ queryKey: ['board'] })
    },
  })

  const relate = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<{ userFlightId: string }>('/api/v1/user-flights', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board'] })
      void queryClient.invalidateQueries({ queryKey: ['logbook'] })
      void queryClient.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  const resolve = useMutation({
    mutationFn: (token: string) => api.post<{ flightId: string; manualFlightId?: string; userFlightId?: string; kind: string }>('/api/v1/flights/resolve', { token }),
  })

  async function lookupFlight(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSearched(true)
    setSelected(null)
    try {
      const response = await lookup.mutateAsync()
      setResult(response)
      if (response.outcome === 'no_sources' || response.outcome === 'sources_unavailable') {
        setManualOpen(true)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Lookup failed')
    }
  }

  async function saveCandidate(candidate: FlightSearchCandidate) {
    setError(null)
    try {
      if (candidate.kind === 'historical') {
        const resolved = await resolve.mutateAsync(candidate.token ?? '')
        await saveRelation(resolved.flightId, resolved.manualFlightId, mode === 'track' ? 'planned' : 'flown')
        return
      }
      if (candidate.kind === 'demo') {
        await saveRelation(candidate.flightId ?? undefined, undefined, mode === 'track' ? 'planned' : 'flown')
        return
      }
      const resolved = await resolve.mutateAsync(candidate.token ?? '')
      await saveRelation(resolved.flightId, undefined, mode === 'track' ? 'planned' : 'flown')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the flight')
    }
  }

  async function saveRelation(backendFlightId?: string, backendManualId?: string, loggingState?: 'planned' | 'flown') {
    await relate.mutateAsync({
      flightId: backendFlightId,
      manualFlightId: backendManualId,
      follow,
      logging: loggingState ? { state: loggingState, cabin: 'none' } : undefined,
    })
    setSelected(null)
    setManualId(null)
    navigate('/')
  }

  const candidates = result?.candidates ?? []
  const sources = result?.sources ?? []

  return (
    <div className="page add-flight-page">

      <header className="add-flight-heading">
        <div>
          <p className="eyebrow">Add to your flight record</p>
          <h1>Track or log a flight</h1>
          <p>Look up a schedule when a provider is available, or enter a flight yourself.</p>
        </div>
      </header>

      <fieldset className="add-flight-mode">
        <legend>Choose a record</legend>
        <div className="add-flight-mode__options">
          <button type="button" className={mode === 'track' ? 'btn' : 'btn-outline'} aria-pressed={mode === 'track'} onClick={() => setMode('track')}>
            Track upcoming
          </button>
          <button type="button" className={mode === 'log' ? 'btn' : 'btn-outline'} aria-pressed={mode === 'log'} onClick={() => setMode('log')}>
            Log a past flight
          </button>
        </div>
      </fieldset>

      <div className="add-flight-workspace">
        <section className="data-panel add-flight-lookup">
          <h2 className="data-panel__title">Search flights</h2>
          <form className="flight-lookup-form" onSubmit={(event) => void lookupFlight(event)}>
            <div className="field">
              <label htmlFor="code">Flight number</label>
              <input id="code" className="input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="LH 371" />
            </div>
            <div className="field">
              <label htmlFor="departure">Departure airport</label>
              <AirportCombobox
                id="departure"
                value={departure}
                onChange={setDeparture}
                options={airports.data?.results ?? []}
                query={departure ? `${departure.iata ?? departure.icao ?? ''} · ${departure.name}` : ''}
              />
            </div>
            <div className="field">
              <label htmlFor="arrival">Arrival airport</label>
              <AirportCombobox
                id="arrival"
                value={arrival}
                onChange={setArrival}
                options={airports.data?.results ?? []}
                query={arrival ? `${arrival.iata ?? arrival.icao ?? ''} · ${arrival.name}` : ''}
              />
            </div>
            <div className="field">
              <label htmlFor="airline">Airline</label>
              <AirlineCombobox
                id="airline"
                value={airline}
                onChange={setAirline}
                options={airlines.data?.results ?? []}
                query={airline ? `${airline.iata ?? airline.icao ?? ''} · ${airline.name}` : ''}
              />
            </div>
            <div className="field">
              <label htmlFor="date">Travel date</label>
              <input id="date" className="input" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="departureTime">Approx. departure time</label>
              <input id="departureTime" className="input" type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="registration">Aircraft registration</label>
              <input id="registration" className="input" value={registration} onChange={(event) => setRegistration(event.target.value)} placeholder="D-ABCD" />
            </div>
            <button className="btn" type="submit" disabled={lookup.isPending}>
              {lookup.isPending ? 'Searching…' : 'Search flights'}
            </button>
          </form>

          {searched && !lookup.isPending && result && (
            <div className="flight-search-results">
              <p className="flight-search-summary" role="status">
                {result.outcome === 'matches' && `${candidates.length} possible flight${candidates.length === 1 ? '' : 's'} found. Choose the correct one before saving.`}
                {result.outcome === 'partial' && `${candidates.length} possible flight${candidates.length === 1 ? '' : 's'} found. Some sources were unavailable, so verify the details before saving.`}
                {result.outcome === 'no_matches' && 'No matching flights were found in the searched sources.'}
                {result.outcome === 'no_sources' && 'No schedule or historical source is available. You can still enter the flight manually.'}
                {result.outcome === 'sources_unavailable' && 'All configured sources failed or were unavailable. You can still enter the flight manually.'}
              </p>
              {sources.length > 0 && (
                <details className="source-transparency">
                  <summary>Search sources and what happened</summary>
                  <ul>
                    {sources.map((source) => (
                      <li key={source.id}>
                        <strong>{source.name}</strong> · {source.status.replace('_', ' ')}
                        <span>{source.message}</span>
                        <small>{source.attribution}</small>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {candidates.length > 0 ? (
                <ul className="candidate-list">
                  {candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <button type="button" className="candidate-card" aria-pressed={selected?.id === candidate.id} onClick={() => setSelected(candidate)}>
                        <div className="candidate-card__top">
                          <span className="candidate-card__code">{candidate.flightCode ?? 'Flight number unavailable'}</span>
                          <span className={`candidate-card__badge candidate-card__badge--${candidate.evidence}`}>{candidate.evidence.replace('_', ' ')}</span>
                        </div>
                        <div className="candidate-card__route">
                          {candidate.departure?.iata ?? candidate.departure?.icao ?? 'Unknown'} → {candidate.arrival?.iata ?? candidate.arrival?.icao ?? 'Unknown'}
                        </div>
                        <div className="candidate-card__times">
                          <span>{candidate.departureTimeUtc ? new Date(candidate.departureTimeUtc).toLocaleString() : 'Departure time unavailable'}</span>
                          {candidate.arrivalTimeUtc && <span>Arrival {new Date(candidate.arrivalTimeUtc).toLocaleString()}</span>}
                        </div>
                        <div className="candidate-card__meta">
                          <span>{candidate.airline?.name ?? 'Airline unavailable'}</span>
                          {candidate.aircraftType && <span>{candidate.aircraftType}</span>}
                          {candidate.aircraftRegistration && <span>{candidate.aircraftRegistration}</span>}
                          <span>{candidate.source.name}</span>
                        </div>
                        {candidate.missingFields.length > 0 && (
                          <p className="candidate-card__missing">Missing: {candidate.missingFields.join(', ')}</p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="form-note">No verified or observed flight matched these criteria. You can still enter the journey manually.</p>
              )}
            </div>
          )}

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </section>

        <aside className="add-flight-aside">
          {(selected || manualId) && (
            <section className="data-panel add-flight-selection">
              <h2 className="data-panel__title">Save flight</h2>
              <p className="form-note">
                {selected?.kind === 'historical' ? 'Historical observation selected. Saving creates a self-entered flown record with its source noted.' : 'Selected schedule result.'}
              </p>
              <label style={{ display: 'flex', gap: 'var(--space-2xs)', alignItems: 'center', minHeight: 44 }}>
                <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
                Follow live on the Board (position tracking when a provider reports it)
              </label>
              <div className="actions-row">
                <button className="btn" type="button" disabled={relate.isPending || resolve.isPending} onClick={() => selected && void saveCandidate(selected)}>
                  {relate.isPending || resolve.isPending ? 'Saving…' : 'Save flight'}
                </button>
              </div>
            </section>
          )}

          <details className="data-panel add-flight-manual" open={manualOpen} onToggle={(event) => setManualOpen(event.currentTarget.open)}>
            <summary>Enter flight details manually</summary>
            <p className="form-note">Use this when there is no schedule provider or you are adding older travel.</p>
            <ManualFlightForm
              initialCode={code}
              initialDeparture={departure}
              initialArrival={arrival}
              onCreated={async (createdManualId) => {
                setManualId(createdManualId)
                setSelected(null)
              }}
              creating={createManual.isPending}
              submit={(payload) => createManual.mutateAsync(payload)}
            />
          </details>
          {createManual.isError && <p className="form-error" role="alert">Could not create the flight record. Check the entered airport and times, then retry.</p>}
        </aside>
      </div>
    </div>
  )
}

function AirportCombobox({
  id,
  value,
  onChange,
  options,
  query,
}: {
  id: string
  value: AirportSearchResult | null
  onChange: (value: AirportSearchResult | null) => void
  options: AirportSearchResult[]
  query: string
}) {
  const [search, setSearch] = useState(query)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const filtered = options.filter((option) => {
    const haystack = `${option.iata ?? ''} ${option.icao ?? ''} ${option.name} ${option.city ?? ''} ${option.country ?? ''}`.toLowerCase()
    return haystack.includes(search.toLowerCase())
  }).slice(0, 20)

  useEffect(() => {
    setHighlightedIndex(0)
  }, [search])

  function selectOption(option: AirportSearchResult) {
    onChange(option)
    setSearch('')
    setHighlightedIndex(0)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setHighlightedIndex((current) => Math.min(current + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setHighlightedIndex((current) => Math.max(current - 1, 0))
        break
      case 'Enter':
        if (filtered[highlightedIndex]) {
          event.preventDefault()
          selectOption(filtered[highlightedIndex])
        }
        break
      case 'Escape':
        event.preventDefault()
        setSearch('')
        onChange(null)
        break
    }
  }

  useEffect(() => {
    if (listRef.current && highlightedIndex >= 0) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  const showList = !value && search.length > 0 && filtered.length > 0

  return (
    <div className="airport-combobox">
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={showList ? `${id}-option-${highlightedIndex}` : undefined}
        aria-autocomplete="list"
        value={value ? `${value.iata ?? value.icao ?? ''} · ${value.name}` : search}
        onChange={(event) => {
          setSearch(event.target.value)
          onChange(null)
        }}
        onKeyDown={handleKeyDown}
        placeholder="IATA, ICAO, city or airport name"
      />
      {showList && (
        <ul ref={listRef} id={`${id}-listbox`} className="combobox-list" role="listbox" aria-label={`${id} airport options`}>
          {filtered.map((option, index) => (
            <li key={option.id} id={`${id}-option-${index}`} role="option" aria-selected={index === highlightedIndex}>
              <button
                type="button"
                className={index === highlightedIndex ? 'combobox-option--highlighted' : undefined}
                onClick={() => selectOption(option)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span>{option.iata ?? option.icao ?? '—'}</span>
                <span>{option.name}</span>
                <small>{[option.city, option.country].filter(Boolean).join(' · ')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {value && (
        <button type="button" className="quietlink" onClick={() => { onChange(null); setSearch('') }}>
          Clear airport
        </button>
      )}
    </div>
  )
}

function AirlineCombobox({
  id,
  value,
  onChange,
  options,
  query,
}: {
  id: string
  value: AirlineSearchResult | null
  onChange: (value: AirlineSearchResult | null) => void
  options: AirlineSearchResult[]
  query: string
}) {
  const [search, setSearch] = useState(query)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const filtered = options.filter((option) => {
    const haystack = `${option.iata ?? ''} ${option.icao ?? ''} ${option.name} ${option.callsign ?? ''} ${option.country ?? ''}`.toLowerCase()
    return haystack.includes(search.toLowerCase())
  }).slice(0, 20)

  useEffect(() => {
    setHighlightedIndex(0)
  }, [search])

  function selectOption(option: AirlineSearchResult) {
    onChange(option)
    setSearch('')
    setHighlightedIndex(0)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setHighlightedIndex((current) => Math.min(current + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setHighlightedIndex((current) => Math.max(current - 1, 0))
        break
      case 'Enter':
        if (filtered[highlightedIndex]) {
          event.preventDefault()
          selectOption(filtered[highlightedIndex])
        }
        break
      case 'Escape':
        event.preventDefault()
        setSearch('')
        onChange(null)
        break
    }
  }

  useEffect(() => {
    if (listRef.current && highlightedIndex >= 0) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  const showList = !value && search.length > 0 && filtered.length > 0

  return (
    <div className="airline-combobox">
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={showList ? `${id}-option-${highlightedIndex}` : undefined}
        aria-autocomplete="list"
        value={value ? `${value.iata ?? value.icao ?? ''} · ${value.name}` : search}
        onChange={(event) => {
          setSearch(event.target.value)
          onChange(null)
        }}
        onKeyDown={handleKeyDown}
        placeholder="IATA, ICAO or airline name"
      />
      {showList && (
        <ul ref={listRef} id={`${id}-listbox`} className="combobox-list" role="listbox" aria-label={`${id} airline options`}>
          {filtered.map((option, index) => (
            <li key={option.id} id={`${id}-option-${index}`} role="option" aria-selected={index === highlightedIndex}>
              <button
                type="button"
                className={index === highlightedIndex ? 'combobox-option--highlighted' : undefined}
                onClick={() => selectOption(option)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span>{option.iata ?? option.icao ?? '—'}</span>
                <span>{option.name}</span>
                <small>{[option.callsign, option.country].filter(Boolean).join(' · ')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {value && (
        <button type="button" className="quietlink" onClick={() => { onChange(null); setSearch('') }}>
          Clear airline
        </button>
      )}
    </div>
  )
}

function ManualFlightForm({
  initialCode,
  initialDeparture,
  initialArrival,
  onCreated,
  creating,
  submit,
}: {
  initialCode: string
  initialDeparture: AirportSearchResult | null
  initialArrival: AirportSearchResult | null
  onCreated: (manualId: string) => void
  creating: boolean
  submit: (payload: Record<string, string | undefined>) => Promise<unknown>
}) {
  const [flightNumber, setFlightNumber] = useState(initialCode)
  const [depAirport, setDepAirport] = useState<AirportSearchResult | null>(initialDeparture)
  const [arrAirport, setArrAirport] = useState<AirportSearchResult | null>(initialArrival)
  const [depSearch, setDepSearch] = useState('')
  const [arrSearch, setArrSearch] = useState('')
  const [depLocal, setDepLocal] = useState('')
  const [arrLocal, setArrLocal] = useState('')
  const [aircraftType, setAircraftType] = useState('')
  const [error, setError] = useState<string | null>(null)

  const depAirports = useQuery({
    queryKey: ['airports', depSearch],
    queryFn: () => api.get<{ results: AirportSearchResult[] }>(`/api/v1/airports?q=${encodeURIComponent(depSearch)}`).then((response) => response.results),
    enabled: depSearch.length > 0,
  })
  const arrAirports = useQuery({
    queryKey: ['airports', arrSearch],
    queryFn: () => api.get<{ results: AirportSearchResult[] }>(`/api/v1/airports?q=${encodeURIComponent(arrSearch)}`).then((response) => response.results),
    enabled: arrSearch.length > 0,
  })

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const dep = depAirport
    const arr = arrAirport
    if (!dep?.iata && !dep?.icao) {
      setError('Choose a departure airport from the search results first.')
      return
    }
    if (!arr?.iata && !arr?.icao) {
      setError('Choose an arrival airport from the search results first.')
      return
    }
    try {
      const res = (await submit({
        flightNumber: flightNumber || undefined,
        departureIata: dep.iata ?? undefined,
        departureIcao: dep.icao ?? undefined,
        arrivalIata: arr.iata ?? undefined,
        arrivalIcao: arr.icao ?? undefined,
        departureLocal: depLocal,
        arrivalLocal: arrLocal,
        aircraftIcaoType: aircraftType ? aircraftType : undefined,
      })) as { manualFlightId: string } | undefined
      if (res?.manualFlightId) onCreated(res.manualFlightId)
    } catch {
      setError('Could not create the flight. Check the airport selections and times, then try again.')
    }
  }

  return (
    <form className="manual-flight-form" onSubmit={(event) => void onSubmit(event)}>
      <p className="form-note" style={{ marginBottom: 'var(--space-s)' }}>
        For flights no provider knows (or old flights). Times are airport local wall-clock; the server converts them using each airport's timezone.
      </p>
      <div className="field">
        <label htmlFor="mf-code">Flight number (optional)</label>
        <input id="mf-code" className="input" style={{ maxWidth: 220, fontFamily: 'var(--font-mono)' }} value={flightNumber} onChange={(event) => setFlightNumber(event.target.value)} placeholder="LH 371" />
      </div>

      <AirportPicker
        id="dep"
        label="Departure airport"
        query={depSearch}
        setQuery={setDepSearch}
        selected={depAirport}
        setSelected={setDepAirport}
        options={depAirports.data ?? []}
        valueLabel={depAirport ? `${depAirport.iata ?? depAirport.icao ?? ''} · ${depAirport.name}` : ''}
      />
      <AirportPicker
        id="arr"
        label="Arrival airport"
        query={arrSearch}
        setQuery={setArrSearch}
        selected={arrAirport}
        setSelected={setArrAirport}
        options={arrAirports.data ?? []}
        valueLabel={arrAirport ? `${arrAirport.iata ?? arrAirport.icao ?? ''} · ${arrAirport.name}` : ''}
      />

      <div className="manual-flight-fields">
        <div className="field">
          <label htmlFor="dep-time">Departure (local at departure airport)</label>
          <input id="dep-time" className="input" type="datetime-local" required value={depLocal} onChange={(event) => setDepLocal(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="arr-time">Arrival (local at arrival airport)</label>
          <input id="arr-time" className="input" type="datetime-local" required value={arrLocal} onChange={(event) => setArrLocal(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mf-type">Aircraft type (optional)</label>
          <input id="mf-type" className="input" style={{ maxWidth: 140, fontFamily: 'var(--font-mono)' }} value={aircraftType} onChange={(event) => setAircraftType(event.target.value)} placeholder="A320" />
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn" type="submit" disabled={creating}>
        {creating ? 'Creating…' : 'Create flight record'}
      </button>
    </form>
  )
}

function AirportPicker({
  id,
  label,
  query,
  setQuery,
  selected,
  setSelected,
  options,
  valueLabel,
}: {
  id: string
  label: string
  query: string
  setQuery: (value: string) => void
  selected: AirportSearchResult | null
  setSelected: (value: AirportSearchResult | null) => void
  options: AirportSearchResult[]
  valueLabel: string
}) {
  return (
    <fieldset className="airport-picker">
      <legend>{label}</legend>
      <input id={`${id}-search`} className="input" value={selected ? valueLabel : query} onChange={(event) => { setQuery(event.target.value); setSelected(null) }} placeholder="City, airport name or IATA/ICAO code" />
      {options.length > 0 && !selected && (
        <ul className="combobox-list" role="listbox" aria-label={`${label} options`}>
          {options.map((airport) => (
            <li key={airport.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => { setSelected(airport); setQuery('') }}>
                <span>{airport.iata ?? airport.icao ?? '—'}</span>
                <span>{airport.name}</span>
                <small>{[airport.city, airport.country].filter(Boolean).join(' · ')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && <p className="form-note">Selected {selected.iata ?? selected.icao}.</p>}
    </fieldset>
  )
}
