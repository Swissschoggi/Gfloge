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
      <div style={{ display: 'flex', gap: 'var(--space-s)', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 'var(--step-2)', margin: 0 }}>Logbook</h1>
        <a className="btn-outline" href="/api/v1/export/logbook.csv" download>
          Export CSV
        </a>
        <Link to="/add" className="btn" style={{ marginInlineStart: 'auto' }}>
          Log or track a flight
        </Link>
        <Link to="/trips" className="btn-outline">Trips</Link>
      </div>

      {stats.data && <StatRow stats={stats.data} />}

      <div className="data-panel" style={{ rowGap: 'var(--space-2xs)', display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="lb-q">Search</label>
          <input id="lb-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Flight, airline, city, seat..." />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="lb-year">Year</label>
          <select id="lb-year" className="select" style={{ width: 140 }} value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All years</option>
            {data.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        {(q !== '' || year !== '') && (
          <button
            type="button"
            className="btn-outline"
            onClick={() => {
              setQ('')
              setYear('')
            }}
          >
            Clear filters
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
          <Group title={`Flown · ${data.flown.length}`} items={data.flown} onDelete={(id) => remove.mutate(id)} deleting={remove.isPending} />
          {data.planned.length > 0 && <Group title={`Planned trips · ${data.planned.length}`} items={data.planned} onDelete={(id) => remove.mutate(id)} deleting={remove.isPending} planned />}
          {data.manual.length > 0 && <Group title={`Self-entered · ${data.manual.length}`} items={data.manual} onDelete={(id) => remove.mutate(id)} deleting={remove.isPending} />}
        </>
      )}
    </div>
  )
}

function StatRow({ stats }: { stats: StatsPayload }) {
  return (
    <div className="statgrid">
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
    <div className="data-panel" style={{ padding: 'var(--space-m)' }}>
      <div className="statblock">
        <span className="statblock__value">{value}</span>
        <span className="statblock__label">{label}</span>
      </div>
    </div>
  )
}

function Group({
  title,
  items,
  planned,
  onDelete,
  deleting,
}: {
  title: string
  items: UserFlightItem[]
  planned?: boolean
  onDelete: (id: string) => void
  deleting: boolean
}) {
  return (
    <section className="board-group" aria-label={title}>
      <h2 className="board-group__title">{title}</h2>
      <div className="logtable-wrap">
        <table className="logtable">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Flight</th>
              <th scope="col">Route</th>
              <th scope="col" className="mono">
                Dep · Arr local
              </th>
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
                <td className="mono">{flightDate(it.flight)}</td>
                <td>
                  <Link to={`/flight/${it.flight.id}`} className="board-flightcode" style={{ textDecoration: 'none', color: 'var(--accent-ink)' }}>
                    {it.flight.flightCode}
                  </Link>
                  {planned && <span className="relation-chip" style={{ marginInlineStart: 'var(--space-2xs)' }}>planned</span>}
                </td>
                <td className="mono">
                  {it.flight.departure.iata} → {it.flight.arrival.iata}
                </td>
                <td className="mono">
                  {formatLocal(it.flight.scheduledDeparture, it.flight.departure.tz)} · {formatLocal(it.flight.scheduledArrival, it.flight.arrival.tz)}
                </td>
                <td>
                  {it.flight.aircraft?.registration ?? 'n/a'} {it.flight.aircraft?.icaoType ? `(${it.flight.aircraft.icaoType})` : ''}
                </td>
                <td>{it.cabin === 'none' ? 'n/a' : it.cabin}</td>
                <td className="mono">{it.seat ?? 'n/a'}</td>
                <td className="mono">{it.rating ?? 'n/a'}</td>
                <td style={{ maxWidth: 260 }}>{it.note ?? ''}</td>
                <td>
                  <button type="button" className="btn-danger" style={{ minHeight: 40, padding: 'var(--space-2xs) var(--space-s)' }} disabled={deleting} onClick={() => onDelete(it.id)}>
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
