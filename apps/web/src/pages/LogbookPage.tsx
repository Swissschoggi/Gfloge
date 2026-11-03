import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FlightRead, StatsPayload, UserFlightItem } from '@gfloge/shared'
import { api } from '../api/client'
import { formatDistance, formatDuration, formatLocal } from '../format'
import { RouteSchematic } from '../components/RouteSchematic'

export function LogbookPage() {
  const [q, setQ] = useState('')
  const [year, setYear] = useState('')
  const queryClient = useQueryClient()
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
          Could not load the logbook. {(logbook.error as Error).message}
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
    <div className="page">
      <header className="pagehead">
        <div>
          <h1 className="pagehead__title">Logbook</h1>
          <p className="pagehead__sub">Every flight you have flown, planned or noted down.</p>
        </div>
        <div className="pagehead__actions">
          <a className="btn-outline" href="/api/v1/export/logbook.csv" download>
            Export CSV
          </a>
          <Link to="/trips" className="btn-outline">Trips</Link>
          <Link to="/add" className="btn">
            Log or track a flight
          </Link>
        </div>
      </header>

      {stats.data && <StatRow stats={stats.data} />}

      <div className="toolbar">
        <div className="searchfield">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
          <label htmlFor="lb-q" className="sr-only">Search</label>
          <input id="lb-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search flight, airline, city or seat" />
        </div>
        <label htmlFor="lb-year" className="sr-only">Year</label>
        <select id="lb-year" className="select select--compact" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">All years</option>
          {data.years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        {(q !== '' || year !== '') && (
          <button type="button" className="btn-ghost" onClick={() => { setQ(''); setYear('') }}>
            Clear
          </button>
        )}
      </div>

      {empty ? (
        <>
          <RouteSchematic variant="route" />
          <p className="page__meta">
            {q || year ? 'No flights match the filters.' : 'Your logbook is empty. Log a flight, or follow one and let it flow in automatically after landing.'}
          </p>
          {!(q || year) && (
            <div className="actions-row">
              <Link className="btn" to="/add">Log or track a flight</Link>
            </div>
          )}
        </>
      ) : (
        <>
          <Group title="Flown" count={data.flown.length} items={data.flown} onDelete={(id) => remove.mutate(id)} deleting={remove.isPending} />
          {data.planned.length > 0 && <Group title="Planned trips" count={data.planned.length} items={data.planned} onDelete={(id) => remove.mutate(id)} deleting={remove.isPending} planned />}
          {data.manual.length > 0 && <Group title="Self-entered" count={data.manual.length} items={data.manual} onDelete={(id) => remove.mutate(id)} deleting={remove.isPending} />}
        </>
      )}
    </div>
  )
}

function StatRow({ stats }: { stats: StatsPayload }) {
  return (
    <div className="statstrip">
      <StatBlock value={String(stats.flights)} label="Flights flown" />
      <StatBlock value={formatDistance(stats.distanceKm)} label="Distance" />
      <StatBlock value={formatDuration(stats.minutes)} label="Time in the air" />
      <StatBlock value={String(stats.uniqueAirports)} label="Airports" />
      <StatBlock value={String(stats.uniqueAirlines)} label="Airlines" />
      <StatBlock value={String(stats.uniqueAircraftTypes)} label="Aircraft types" />
      <StatBlock value={String(stats.countriesVisited)} label="Countries" />
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
  onDelete: (id: string) => void
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
                  <button type="button" className="btn-quiet-danger" disabled={deleting} onClick={() => onDelete(it.id)} aria-label={`Delete ${it.flight.flightCode}`}>
                    Delete
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
