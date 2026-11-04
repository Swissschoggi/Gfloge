import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FlightRead, StatsPayload, UserFlightItem } from '@gfloge/shared'
import { api } from '../api/client'
import { formatDistance, formatDuration, formatLocal } from '../format'
import { RouteSchematic } from '../components/RouteSchematic'

export function LogbookPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const year = params.get('year') ?? ''
  const [search, setSearch] = useState(q)
  const [view, setView] = useState<'cards' | 'table'>(() => (localStorage.getItem('gfloge-logbook-view') as 'cards' | 'table') ?? 'cards')
  const [showMoreStats, setShowMoreStats] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<UserFlightItem | null>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { localStorage.setItem('gfloge-logbook-view', view) }, [view])
  const queryClient = useQueryClient()
  // Keep the search input controlled by local state; syncing from the URL on
  // every keystroke resets the cursor and limits typing to one character.
  const logbook = useQuery({
    queryKey: ['logbook', q, year],
    queryFn: () => api.get<{ flown: UserFlightItem[]; planned: UserFlightItem[]; manual: UserFlightItem[]; years: string[] }>(
      `/api/v1/logbook?q=${encodeURIComponent(q)}&year=${encodeURIComponent(year)}`
    ),
  })
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<StatsPayload>('/api/v1/stats') })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/user-flights/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['logbook'] })
      void queryClient.invalidateQueries({ queryKey: ['stats'] })
      void queryClient.invalidateQueries({ queryKey: ['board'] })
    },
  })

  function requestDelete(item: UserFlightItem) {
    remove.reset()
    setPendingDelete(item)
    deleteDialog.current?.showModal()
  }

  if (logbook.isPending) {
    return (
      <div className="page">
        <div className="data-panel">
          <p className="form-note">Loading logbook…</p>
        </div>
      </div>
    )
  }

  if (logbook.isError) {
    return (
      <div className="page">
        <h1>Logbook</h1>
        <div role="alert" className="form-error">
          Could not load the logbook. Check your connection and try again.
        </div>
        <button className="btn" type="button" style={{ marginTop: 'var(--space-s)' }} onClick={() => void logbook.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  const data = logbook.data
  const empty = data.flown.length === 0 && data.planned.length === 0 && data.manual.length === 0

  return (
    <div className="page logbook-page">
      <header className="pagehead logbook-masthead">
        <div>
          <p className="eyebrow">Logbook</p>
          <h1 className="pagehead__title">Flight log</h1>
          <p className="pagehead__sub">A permanent record of the journeys you have taken and the ones ahead.</p>
        </div>
        <div className="pagehead__actions">
          <Link to="/import" className="btn-outline">Import CSV</Link>
          <a className="btn-outline" href="/api/v1/export/logbook.csv" download>
            Export CSV
          </a>
          <Link to="/trips" className="btn-outline">Trips</Link>
          <Link to="/add" className="btn">
            Log or track a flight
          </Link>
        </div>
      </header>

      {stats.data && <StatRow stats={stats.data} expanded={showMoreStats} onToggle={() => setShowMoreStats((v) => !v)} />}
      {data && data.flown.length > 0 && <YearInReview items={data.flown} />}

      <div className="toolbar logbook-toolbar">
        <div className="view-toggle" role="group" aria-label="View">
          <button type="button" className={view === 'cards' ? 'btn' : 'btn-ghost'} onClick={() => setView('cards')}>Cards</button>
          <button type="button" className={view === 'table' ? 'btn' : 'btn-ghost'} onClick={() => setView('table')}>Table</button>
        </div>
        <div className="searchfield">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
          <label htmlFor="lb-q" className="sr-only">Search</label>
          <input id="lb-q" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setParams((current) => { if (e.target.value) current.set('q', e.target.value); else current.delete('q'); return current }, { replace: true }) }} placeholder="Search flight, airline, city or seat" />
        </div>
        <label htmlFor="lb-year" className="sr-only">Year</label>
        <select id="lb-year" className="select select--compact" value={year} onChange={(e) => setParams((current) => { if (e.target.value) current.set('year', e.target.value); else current.delete('year'); return current }, { replace: true })}>
          <option value="">All years</option>
          {data.years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        {(q !== '' || year !== '') && (
          <button type="button" className="btn-ghost" onClick={() => { setSearch(''); setParams({}, { replace: true }) }}>
            Clear filters
          </button>
        )}
      </div>

      {empty ? (
        <>
          <RouteSchematic variant="route" />
          <p className="page__meta logbook-empty">
            {q || year ? 'No flights match the filters.' : 'Your logbook is empty. Log a flight, or follow one and let it flow in automatically after landing.'}
          </p>
          {!(q || year) && (
            <div className="actions-row">
              <Link className="btn" to="/add">Log or track a flight</Link>
            </div>
          )}
        </>
      ) : view === 'table' ? (
        <>
          {data.planned.length > 0 && <Group title="Planned" count={data.planned.length} items={data.planned} onDelete={requestDelete} deleting={remove.isPending} planned />}
          {data.flown.length > 0 && <Group title="Flown" count={data.flown.length} items={data.flown} onDelete={requestDelete} deleting={remove.isPending} />}
          {data.manual.length > 0 && <Group title="Self-entered" count={data.manual.length} items={data.manual} onDelete={requestDelete} deleting={remove.isPending} />}
        </>
      ) : (
        <div className="logbook-cards">
          {[...data.planned, ...data.flown, ...data.manual]
            .sort((a, b) => b.flight.scheduledDeparture.localeCompare(a.flight.scheduledDeparture))
            .map((it) => (
              <Link key={it.id} to={`/flight/${it.flight.id}`} className="logbook-card">
                <span className="logbook-card__date">{flightDate(it.flight)}</span>
                <span className="logbook-card__code">{it.flight.flightCode}</span>
                <span className="logbook-card__route">{it.flight.departure.iata ?? it.flight.departure.icao} → {it.flight.arrival.iata ?? it.flight.arrival.icao}</span>
                <span className="logbook-card__meta">{it.flight.airline?.name ?? ''} · {it.flight.aircraft?.icaoType ?? ''}</span>
              </Link>
            ))}
        </div>
      )}

      {remove.isError && <p className="form-error" role="alert">Could not remove the flight. It is still in your logbook; select Remove again to retry.</p>}
      <dialog ref={deleteDialog} className="confirm-dialog" aria-labelledby="delete-flight-title" onClose={() => setPendingDelete(null)}>
        <h2 id="delete-flight-title">Remove {pendingDelete?.flight.flightCode ?? 'this flight'} from your logbook?</h2>
        <p>This removes your personal seat, cabin, rating and note. The shared flight record remains available.</p>
        <div className="actions-row">
          <button type="button" className="btn-outline" onClick={() => deleteDialog.current?.close()}>Keep record</button>
          <button type="button" className="btn-danger" disabled={remove.isPending || !pendingDelete} onClick={() => {
            if (!pendingDelete) return
            remove.mutate(pendingDelete.id)
            deleteDialog.current?.close()
          }}>{remove.isPending ? 'Removing…' : 'Remove from logbook'}</button>
        </div>
      </dialog>
    </div>
  )
}

function StatRow({ stats, expanded, onToggle }: { stats: StatsPayload; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="statstrip">
      <StatBlock value={String(stats.flights)} label="Flights flown" />
      <StatBlock value={formatDistance(stats.distanceKm)} label="Distance" />
      <StatBlock value={formatDuration(stats.minutes)} label="Time in the air" />
      <StatBlock value={String(stats.uniqueAirports)} label="Airports" />
      {expanded && (
        <>
          <StatBlock value={String(stats.uniqueAirlines)} label="Airlines" />
          <StatBlock value={String(stats.uniqueAircraftTypes)} label="Aircraft types" />
          <StatBlock value={String(stats.countriesVisited)} label="Countries" />
        </>
      )}
      <button type="button" className="btn-ghost" onClick={onToggle}>{expanded ? 'Less' : 'More'}</button>
    </div>
  )
}

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="stattile">
      <span className="stattile__value">{value}</span>
      <span className="stattile__label">{label}</span>
    </div>
  )
}

function Group({
  title,
  count,
  items,
  planned,
  onDelete,
  deleting,
}: {
  title: string
  count: number
  items: UserFlightItem[]
  planned?: boolean
  onDelete: (item: UserFlightItem) => void
  deleting: boolean
}) {
  return (
    <section className="board-group" aria-label={title}>
      <h2 className="board-group__title">{title} <span className="board-group__count">{count}</span></h2>
      <div className="logtable-wrap">
        <table className="logtable">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Flight</th>
              <th scope="col">Route</th>
              <th scope="col">Dep – Arr</th>
              <th scope="col">Aircraft</th>
              <th scope="col">Cabin</th>
              <th scope="col">Seat</th>
              <th scope="col">Rating</th>
              <th scope="col">Note</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td className="mono" data-label="Date">{flightDate(it.flight)}</td>
                <td data-label="Flight" className="logtable__flight">
                  <Link to={`/flight/${it.flight.id}`} className="logtable__code">
                    {it.flight.flightCode}
                  </Link>
                  {planned && <span className="relation-chip">planned</span>}
                </td>
                <td className="mono" data-label="Route">
                  {it.flight.departure.iata} <span className="logtable__arrow">→</span> {it.flight.arrival.iata}
                </td>
                <td className="mono logtable__times" data-label="Dep · Arr">
                  {formatLocal(it.flight.scheduledDeparture, it.flight.departure.tz)} – {formatLocal(it.flight.scheduledArrival, it.flight.arrival.tz)}
                </td>
                <td data-label="Aircraft">
                  <span className="logtable__aircraft">{it.flight.aircraft?.registration ?? '—'}</span>
                  {it.flight.aircraft?.icaoType ? <span className="logtable__type">{it.flight.aircraft.icaoType}</span> : null}
                </td>
                <td data-label="Cabin">{it.cabin === 'none' ? <span className="muted">—</span> : <span className="tag">{it.cabin}</span>}</td>
                <td className="mono" data-label="Seat">{it.seat ?? <span className="muted">—</span>}</td>
                <td data-label="Rating">
                  {it.rating ? (
                    <span className="stars" role="img" aria-label={`${it.rating} out of 5`}>
                      {'★'.repeat(it.rating)}
                      <span className="stars__off">{'★'.repeat(5 - it.rating)}</span>
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="logtable__note" data-label="Note">{it.note ?? ''}</td>
                <td className="logtable__actions">
                  <button type="button" className="btn-quiet-danger" disabled={deleting} onClick={() => onDelete(it)} aria-label={`Remove ${it.flight.flightCode} from your logbook`}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function flightDate(f: FlightRead): string {
  const iso = f.actualDeparture ?? f.scheduledDeparture
  return new Date(iso).toISOString().slice(0, 10)
}

function YearInReview({ items }: { items: UserFlightItem[] }) {
  const total = items.length
  const distance = items.reduce((s, it) => s + (it.flight.distanceKm ?? 0), 0)
  const earthCircumference = 40075
  const timesAround = (distance / earthCircumference).toFixed(1)
  const durations = items.map((it) => {
    const d = (new Date(it.flight.actualArrival ?? it.flight.scheduledArrival).getTime() - new Date(it.flight.actualDeparture ?? it.flight.scheduledDeparture).getTime()) / 60000
    return { item: it, minutes: d }
  }).filter((x) => x.minutes > 0)
  const longest = durations.length ? durations.reduce((a, b) => (b.minutes > a.minutes ? b : a)) : null
  const shortest = durations.length ? durations.reduce((a, b) => (b.minutes < a.minutes ? b : a)) : null
  const routeCounts = new Map<string, number>()
  items.forEach((it) => {
    const r = `${it.flight.departure.iata ?? it.flight.departure.icao}→${it.flight.arrival.iata ?? it.flight.arrival.icao}`
    routeCounts.set(r, (routeCounts.get(r) ?? 0) + 1)
  })
  const topRoute = [...routeCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const typeCounts = new Map<string, number>()
  items.forEach((it) => {
    const t = it.flight.aircraft?.icaoType ?? 'unknown'
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
  })
  const topType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  return (
    <section className="data-panel" aria-label="Year in review">
      <h2 className="data-panel__title">Year in review</h2>
      <p className="form-note">{total} flights · {formatDistance(distance)} · {timesAround}× around the Earth</p>
      {longest && <p className="form-note">Longest: {longest.item.flight.flightCode} {longest.item.flight.departure.iata}→{longest.item.flight.arrival.iata} ({formatDuration(longest.minutes)})</p>}
      {shortest && <p className="form-note">Shortest: {shortest.item.flight.flightCode} {shortest.item.flight.departure.iata}→{shortest.item.flight.arrival.iata} ({formatDuration(shortest.minutes)})</p>}
      {topRoute && <p className="form-note">Top route: {topRoute[0]} ({topRoute[1]}×)</p>}
      {topType && <p className="form-note">Top aircraft: {topType[0]} ({topType[1]}×)</p>}
    </section>
  )
}
