import { Link } from 'react-router'
import { useSearchParams } from 'react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { BoardPayload, FlightRead } from '@gfloge/shared'
import { api } from '../api/client'
import { StatusBadge, ConditionChip, statusLabel } from '../components/StatusPresentation'
import { formatDuration, formatLocal, formatDate, sameUtcDay, timeBasisLabel } from '../format'
import { RouteSchematic } from '../components/RouteSchematic'

const SKELETON_ROWS = 3

export function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchDraft, setSearchDraft] = useState(searchParams.get('q') ?? '')
  const statusFilter = searchParams.get('status') ?? 'all'
  const board = useQuery({
    queryKey: ['board'],
    queryFn: () => api.get<BoardPayload>('/api/v1/board'),
    refetchInterval: 30_000,
  })

  if (board.isPending) {
    return (
      <div className="page">
        <div className="board-group" aria-hidden="true">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div className="board-row" key={i} style={{ minHeight: 56 }}>
              <span className="airline-mark">···</span>
              <span className="board-flightcode" style={{ color: 'var(--ink-3)' }}>
                loading flights…
              </span>
            </div>
          ))}
        </div>
        <p className="attribution">Board loading.</p>
      </div>
    )
  }

  if (board.isError) {
    return (
      <div className="page">
        <h1>Board</h1>
        <div role="alert" className="form-error" style={{ padding: 'var(--space-s) 0' }}>
          Could not load the board. {(board.error as Error).message}
        </div>
        <button type="button" className="btn" onClick={() => void board.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  const data = board.data
  const allItems = [...data.active, ...data.upcoming, ...data.landed]
  const filtered = allItems.filter((item) => {
    const text = `${item.flight.flightCode} ${item.flight.airline?.name ?? ''} ${item.flight.departure.iata ?? ''} ${item.flight.arrival.iata ?? ''} ${item.flight.departure.city} ${item.flight.arrival.city}`.toLowerCase()
    return (!searchParams.get('q') || text.includes(searchParams.get('q')!.toLowerCase())) &&
      (statusFilter === 'all' || item.flight.status === statusFilter)
  })
  const filteredIds = new Set(filtered.map((item) => item.userFlightId))
  const active = data.active.filter((item) => filteredIds.has(item.userFlightId))
  const upcoming = data.upcoming.filter((item) => filteredIds.has(item.userFlightId))
  const landed = data.landed.filter((item) => filteredIds.has(item.userFlightId))
  const isEmpty = allItems.length === 0
  const noMatches = !isEmpty && filtered.length === 0

  return (
    <div className="page">
      {isEmpty ? (
        <div className="page" style={{ gap: 'var(--space-s)' }}>
          <RouteSchematic variant="route" />
          <h1 style={{ fontSize: 'var(--step-2)' }}>Nothing flying yet</h1>
          <p className="page__meta">Track a flight and watch it here, live.</p>
          <Link to="/add" className="btn">
            Track a flight
          </Link>
          <Link to="/logbook" className="quietlink">
            or open your logbook
          </Link>
        </div>
      ) : (
        <>
          <header className="board-masthead">
            <h1 className="board-masthead__title">Board</h1>
            <div className="board-masthead__readout">
              <span className="board-masthead__value">{active.length}</span>
              <span className="board-masthead__label">in the air</span>
            </div>
            <div className="board-masthead__readout">
              <span className="board-masthead__value">{upcoming.length}</span>
              <span className="board-masthead__label">upcoming</span>
            </div>
            <div className="board-masthead__readout">
              <span className="board-masthead__value">{landed.length}</span>
              <span className="board-masthead__label">landed</span>
            </div>
          </header>
          <div className="data-panel board-filters">
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="board-search">Search followed flights</label>
              <input id="board-search" className="input" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setSearchParams((current) => { if (searchDraft) current.set('q', searchDraft); else current.delete('q'); return current }) }} placeholder="Flight, airline, airport, or city" />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="board-status">Operational status</label>
              <select id="board-status" className="select" value={statusFilter} onChange={(event) => setSearchParams((current) => { if (event.target.value === 'all') current.delete('status'); else current.set('status', event.target.value); return current })}>
                <option value="all">All statuses</option>
                <option value="scheduled">Scheduled</option>
                <option value="boarding">Boarding</option>
                <option value="enroute">En route</option>
                <option value="arrived">Arrived</option>
                <option value="cancelled">Cancelled</option>
                <option value="diverted">Diverted</option>
              </select>
            </div>
            <button type="button" className="btn-outline" onClick={() => { setSearchDraft(''); setSearchParams({}) }}>Clear</button>
            <button type="button" className="btn" onClick={() => setSearchParams((current) => { if (searchDraft) current.set('q', searchDraft); else current.delete('q'); return current })}>Search</button>
          </div>
          {noMatches ? <div className="data-panel"><p>No followed flights match “{searchParams.get('q') ?? statusFilter}”.</p><button className="quietlink" type="button" onClick={() => { setSearchDraft(''); setSearchParams({}) }}>Clear filters</button></div> : <>
          <Group title="Active and boarding" items={active} emptyText="No flight in the air right now." />
          <Group title="Upcoming" items={upcoming} emptyText="No further flights ahead." />
          <Group title="Landed recently" items={landed} emptyText="No landings in the last 24 hours." />
          </>}
          <p className="attribution">
            Board generated {new Date(data.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}. Statuses update
            automatically every 30s.
          </p>
        </>
      )}
    </div>
  )
}

type GroupProps = { title: string; items: BoardPayload['active']; emptyText: string }

function Group({ title, items, emptyText }: GroupProps) {
  return (
    <section className="board-group" aria-label={title}>
      <h2 className="board-group__title">{title}</h2>
      {items.length === 0 ? (
        <p className="form-note" style={{ padding: 'var(--space-2xs) 0' }}>{emptyText}</p>
      ) : (
        <ul className="board-rows">
          {items.map((item) => (
            <li key={item.userFlightId}>
              <BoardRow flight={item.flight} relation={item.relation} condition={item.condition} lastUpdate={item.lastUpdateTime} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function BoardRow({
  flight,
  relation,
  condition,
  lastUpdate,
}: {
  flight: FlightRead
  relation: 'following' | 'planned' | 'logged'
  condition: BoardPayload['active'][number]['condition']
  lastUpdate: string | null
}) {
  const today = new Date().toISOString()
  const depDate = formatDate(flight.scheduledDeparture, flight.departure.tz)
  return (
    <Link to={`/flight/${flight.id}`} className="board-row">
      <StatusBadge status={flight.status} />
      <span className="airline-mark" aria-label={flight.airline?.name ?? 'self entered'}>
        {flight.airline?.iata ?? '…'}
      </span>
      <span>
        <span className="board-flightcode">{flight.flightCode}</span>
        <span className="board-route" style={{ marginInlineStart: 'var(--space-s)' }}>
          {flight.departure.iata} → {flight.arrival.iata}
        </span>
        <span className="readout-row__meta">{relation === 'planned' ? 'planned trip' : relation === 'logged' ? 'from your logbook' : flight.airline?.name ?? 'self entered'}</span>
      </span>
      <span className="board-times">
        {formatLocal(flight.scheduledDeparture, flight.departure.tz)}
        <small>
          {timeBasisLabel(flight.departure.iata ?? '?', flight.departure.tz)}{sameUtcDay(flight.scheduledDeparture, today) ? '' : ` · ${depDate}`}
        </small>
      </span>
      <span aria-hidden="true" />
      {condition === 'fresh' ? (
        <span className="board-times">
          {formatLocal(flight.actualArrival ?? flight.scheduledArrival, flight.arrival.tz)}
          <small>
            {flight.arrival.iata} local{sameUtcDay(flight.scheduledArrival, today) ? '' : ` · ${formatDate(flight.scheduledArrival, flight.arrival.tz)}`} ·{' '}
            {function () {
              const dep = new Date(flight.actualDeparture ?? flight.scheduledDeparture)
              const arr = new Date(flight.actualArrival ?? flight.scheduledArrival)
              return formatDuration(Math.round((arr.getTime() - dep.getTime()) / 60_000))
            }()}{' '}
            · {statusLabel(flight.status).toLowerCase()}
          </small>
        </span>
      ) : null}
      <ConditionChip condition={condition} timestamp={lastUpdate} />
    </Link>
  )
}
