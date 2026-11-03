import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AirportInfo, FlightRead } from '@gfloge/shared'
import { api } from '../api/client'
import { StatusBadge } from '../components/StatusPresentation'

type HistoricalCandidate = {
  datasetKey: string
  source: string
  callsign: string
  registration: string | null
  aircraftType: string | null
  departureAirport: string | null
  arrivalAirport: string | null
  departureIata: string | null
  arrivalIata: string | null
  departureAirportName: string | null
  arrivalAirportName: string | null
  departureTimeUtc: string | null
  arrivalTimeUtc: string | null
}

type Mode = 'track' | 'log'

export function AddFlightPage() {
  const [mode, setMode] = useState<Mode>('track')
  const [code, setCode] = useState('')
  const [date, setDate] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState<FlightRead | null>(null)
  const [selectedHistorical, setSelectedHistorical] = useState<HistoricalCandidate | null>(null)
  const [historicalCandidates, setHistoricalCandidates] = useState<HistoricalCandidate[]>([])
  const [manualId, setManualId] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)

  const queryClient = useQueryClient()

  const lookup = useMutation({
    mutationFn: async () => {
      setHistoricalCandidates([])
      setSelectedHistorical(null)
      const demo = await api.get<{ results: FlightRead[]; engine: { provider: string; isDemo: boolean } }>(`/api/v1/flights/lookup?code=${encodeURIComponent(code)}&date=${date}`)
      if (demo.results.length > 0) {
        return { results: demo.results, historical: [] as HistoricalCandidate[], engine: demo.engine }
      }
      let covered = false
      try {
        const datasets = await api.get<{ datasets: Array<{ status: string; dateStart: string; dateEnd: string }> }>('/api/v1/historical/datasets')
        covered = datasets.datasets.some((d) => d.status === 'installed' && d.dateStart <= date && d.dateEnd >= date)
      } catch {
        covered = false
      }
      if (covered) {
        try {
          const hist = await api.post<{ candidates: HistoricalCandidate[]; duckdbAvailable: boolean; note: string }>('/api/v1/historical/search', { flightNumber: code, date })
          setHistoricalCandidates(hist.candidates)
          return { results: [] as FlightRead[], historical: hist.candidates, engine: { provider: 'historical', isDemo: false } }
        } catch {
          // fall through to empty
        }
      }
      return { results: [] as FlightRead[], historical: [] as HistoricalCandidate[], engine: demo.engine }
    },
    onError: (e) => setError((e as Error).message),
  })

  const createManual = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<{ flight: FlightRead; manualFlightId: string }>('/api/v1/manual-flights', payload),
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

  async function lookupFlight(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      setSearched(true)
      setSelected(null)
      await lookup.mutateAsync()
      if ((lookup.data?.results.length ?? 0) === 0) setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed')
    }
  }

  const results = lookup.data?.results ?? []
  const historical = lookup.data?.historical ?? historicalCandidates
  const engine = lookup.data?.engine

  async function saveHistorical(candidate: HistoricalCandidate) {
    setError(null)
    try {
      await api.post('/api/v1/historical/save', { flightNumber: code || candidate.callsign, date, candidate })
      window.location.assign('/')
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the historical flight')
      return false
    }
  }

  async function saveRelation(backendFlightId?: string, backendManualId?: string, loggingState?: 'planned' | 'flown') {
    setError(null)
    try {
      await relate.mutateAsync({
        flightId: backendFlightId,
        manualFlightId: backendManualId,
        follow,
        logging: loggingState ? { state: loggingState, cabin: 'none' } : undefined,
      })
      setSelected(null)
      setManualId(null)
      window.location.assign('/')
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the relation')
      return false
    }
  }

  return (
    <div className="page">
      <h1 style={{ fontSize: 'var(--step-2)' }}>Track or log a flight</h1>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="attribution">What do you want to do?</legend>
        <div style={{ display: 'flex', gap: 'var(--space-s)', marginBlock: 'var(--space-s)' }}>
          <button type="button" className={mode === 'track' ? 'btn' : 'btn-outline'} aria-pressed={mode === 'track'} onClick={() => setMode('track')}>
            Track upcoming
          </button>
          <button type="button" className={mode === 'log' ? 'btn' : 'btn-outline'} aria-pressed={mode === 'log'} onClick={() => setMode('log')}>
            Log a past flight
          </button>
        </div>
      </fieldset>

      <div className="data-panel">
        <h2 className="data-panel__title">1 · Look up by flight number</h2>
        <form onSubmit={(e) => void lookupFlight(e)}>
          <div className="field">
            <label htmlFor="code">Flight number</label>
            <input id="code" className="input" style={{ maxWidth: 220, fontFamily: 'var(--font-mono)' }} required value={code} onChange={(e) => setCode(e.target.value)} placeholder="LH 371" />
          </div>
          <div className="field">
            <label htmlFor="date">Date</label>
            <input id="date" className="input" style={{ maxWidth: 220 }} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            <p className="hint">Schedule data comes from the configured provider. The built-in demo provider holds today's and tomorrow's demo flights.</p>
          </div>
          <button className="btn" type="submit" disabled={lookup.isPending}>
            {lookup.isPending ? 'Searching…' : 'Search'}
          </button>
        </form>

        {searched && !lookup.isPending && (
          <div style={{ marginTop: 'var(--space-s)' }}>
            {mode === 'log' && results.length > 0 && (
              <p className="form-note">Past date: results come from provider history if your provider supports it.</p>
            )}
            {results.length === 0 && historical.length === 0 ? (
              <div className="form-error" role="status">
                {mode === 'track' ? (
                  <>
                    <p>No flight found for {code || '…'} on {date}. The schedule provider has no data (or none is configured). Enter it manually below: your record is private and marked self-entered.</p>
                  </>
                ) : (
                  <p>No record found for that flight and date. Enter it manually below.</p>
                )}
              </div>
            ) : results.length > 0 ? (
              <div style={{ display: 'grid', gap: 'var(--space-2xs)' }}>
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="resultoption"
                    aria-pressed={selected?.id === r.id}
                    onClick={() => {
                      setSelected(r)
                      setSelectedHistorical(null)
                      setManualId(null)
                    }}
                  >
                    <StatusBadge status={r.status} />
                    <span>{r.flightCode}</span>
                    <span>
                      {r.departure.iata} → {r.arrival.iata}
                    </span>
                    <span style={{ marginInlineStart: 'auto', color: 'var(--ink-3)' }}>
                      {new Date(r.scheduledDeparture).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })} UTC
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 'var(--space-2xs)' }}>
                <p className="form-note">Historical archive results (archived flight data). Select one to save to your logbook.</p>
                {historical.map((c, idx) => (
                  <button
                    key={`${c.datasetKey}-${idx}`}
                    type="button"
                    className="resultoption"
                    aria-pressed={selectedHistorical?.callsign === c.callsign && selectedHistorical?.departureTimeUtc === c.departureTimeUtc}
                    onClick={() => {
                      setSelectedHistorical(c)
                      setSelected(null)
                      setManualId(null)
                    }}
                  >
                    <span className="airline-mark">{c.callsign}</span>
                    <span>
                      {(c.departureIata ?? c.departureAirport) ?? '?'} → {(c.arrivalIata ?? c.arrivalAirport) ?? 'unknown'}
                    </span>
                    <span style={{ marginInlineStart: 'auto', color: 'var(--ink-3)' }}>
                      {c.departureTimeUtc ?? ''} UTC
                    </span>
                  </button>
                ))}
              </div>
            )}
            {engine?.isDemo && results.length > 0 && (
              <p className="attribution">Results come from the Gfloge demo dataset (not real schedule data).</p>
            )}
          </div>
        )}

        {error && (
          <div className="form-error" role="alert" style={{ marginTop: 'var(--space-s)' }}>
            {error}
          </div>
        )}
      </div>

      {(selected || selectedHistorical || manualId) && (
        <div className="data-panel">
          <h2 className="data-panel__title">2 · Add it to your world</h2>
          <label style={{ display: 'flex', gap: 'var(--space-2xs)', alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            Follow live on the Board (position tracking when a provider reports it)
          </label>
          <label style={{ display: 'flex', gap: 'var(--space-2xs)', alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked onChange={() => undefined} disabled />
            Save to logbook (always for {mode === 'track' ? 'a planned upcoming trip' : 'a flown flight'})
          </label>
          <div className="actions-row">
            <button
              type="button"
              className="btn"
              disabled={relate.isPending}
              onClick={() => {
                if (selectedHistorical) {
                  void saveHistorical(selectedHistorical)
                  return
                }
                const flightId = selected?.id
                const mid = manualId
                void saveRelation(flightId, mid ?? undefined, mode === 'track' ? 'planned' : 'flown')
              }}
            >
              {relate.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="data-panel">
        <h2 className="data-panel__title">Manual entry</h2>
        <ManualFlightForm onCreated={async (manualId) => {
          setManualId(manualId)
          setSelected(null)
        }} creating={createManual.isPending} submit={(payload: Record<string, string | undefined>) => createManual.mutateAsync(payload)} />
      </div>
    </div>
  )
}

function ManualFlightForm({
  onCreated,
  creating,
  submit,
}: {
  onCreated: (manualId: string) => void
  creating: boolean
  submit: (payload: Record<string, string | undefined>) => Promise<unknown>
}) {
  const [flightNumber, setFlightNumber] = useState('')
  const [depAirport, setDepAirport] = useState<AirportInfo | null>(null)
  const [arrAirport, setArrAirport] = useState<AirportInfo | null>(null)
  const [depSearch, setDepSearch] = useState('')
  const [arrSearch, setArrSearch] = useState('')
  const [depLocal, setDepLocal] = useState('')
  const [arrLocal, setArrLocal] = useState('')
  const [aircraftType, setAircraftType] = useState('')
  const [error, setError] = useState<string | null>(null)

  const depAirports = useQuery({ queryKey: ['airports', depSearch], queryFn: () => api.get<{results:AirportInfo[]}>(`/api/v1/airports?q=${encodeURIComponent(depSearch)}`).then((r)=>r.results) })
  const arrAirports = useQuery({ queryKey: ['airports', arrSearch], queryFn: () => api.get<{results:AirportInfo[]}>(`/api/v1/airports?q=${encodeURIComponent(arrSearch)}`).then((r)=>r.results) })

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const dep = depAirport
    const arr = arrAirport
    if (!dep || !arr) {
      setError('Pick both airports from the search results first.')
      return
    }
    const res = (await submit({
      flightNumber: flightNumber || 'SELF 1',
      departureIata: dep.iata ?? '',
      arrivalIata: arr.iata ?? '',
      departureLocal: depLocal,
      arrivalLocal: arrLocal,
      aircraftIcaoType: aircraftType ? aircraftType : undefined,
    })) as { manualFlightId: string } | undefined
    if (res?.manualFlightId) onCreated(res.manualFlightId)
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)}>
      <p className="form-note" style={{ marginBottom: 'var(--space-s)' }}>
        For flights no provider knows (or old flights). Times are airport local wall-clock; the server converts them using each airport's timezone.
      </p>
      <div className="field">
        <label htmlFor="mf-code">Flight number (optional)</label>
        <input id="mf-code" className="input" style={{ maxWidth: 220, fontFamily: 'var(--font-mono)' }} value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} placeholder="LH 371" />
      </div>

      <AirportPicker
        id="dep"
        label="Departure airport"
        query={depSearch}
        setQuery={setDepSearch}
        selected={depAirport}
        setSelected={setDepAirport}
        options={depAirports.data ?? []}
      />
      <AirportPicker
        id="arr"
        label="Arrival airport"
        query={arrSearch}
        setQuery={setArrSearch}
        selected={arrAirport}
        setSelected={setArrAirport}
        options={arrAirports.data ?? []}
      />

      <div style={{ display: 'flex', gap: 'var(--space-s)', flexWrap: 'wrap' }}>
        <div className="field">
          <label htmlFor="dep-time">Departure (local at departure airport)</label>
          <input id="dep-time" className="input" style={{ maxWidth: 240 }} type="datetime-local" required value={depLocal} onChange={(e) => setDepLocal(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="arr-time">Arrival (local at arrival airport)</label>
          <input id="arr-time" className="input" style={{ maxWidth: 240 }} type="datetime-local" required value={arrLocal} onChange={(e) => setArrLocal(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mf-type">Aircraft type (optional)</label>
          <input id="mf-type" className="input" style={{ maxWidth: 140, fontFamily: 'var(--font-mono)' }} value={aircraftType} onChange={(e) => setAircraftType(e.target.value)} placeholder="A320" />
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
}: {
  id: string
  label: string
  query: string
  setQuery: (v: string) => void
  selected: AirportInfo | null
  setSelected: (v: AirportInfo | null) => void
  options: AirportInfo[]
}) {
  return (
    <fieldset style={{ border: 0, padding: 0, marginBottom: 'var(--space-s)' }}>
      <legend className="field" style={{ marginBottom: 0 }}>
        <label htmlFor={`${id}-search`} style={{ fontSize: 'var(--step--1)', fontWeight: 500 }}>
          {label}
        </label>
      </legend>
      <input id={`${id}-search`} className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="City, airport name or IATA code" />
      {options.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--space-2xs) 0 0', display: 'grid', gap: 'var(--space-2xs)' }}>
          {options.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="resultoption"
                aria-pressed={selected?.id === a.id}
                onClick={() => {
                  setSelected(a)
                  setQuery(`${a.iata ?? ''} · ${a.city}`)
                }}
              >
                <span className="airline-mark">{a.iata ?? a.icao}</span>
                <span>
                  {a.name} · {a.city} ({a.country}) · {a.tz}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && <p className="form-note">Selected {selected.iata ?? selected.icao}.</p>}
    </fieldset>
  )
}
