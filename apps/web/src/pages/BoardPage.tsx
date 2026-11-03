import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import type { BoardPayload, FlightRead } from '@gfloge/shared'
import { api } from '../api/client'
import { StatusBadge, ConditionChip, statusLabel } from '../components/StatusPresentation'
import { formatDuration, formatLocal, formatDate, sameUtcDay } from '../format'
import { RouteSchematic } from '../components/RouteSchematic'

const SKELETON_ROWS = 3

const STATUS_FILTERS: Array<[string, string]> = [
  ['all', 'All'],
  ['enroute', 'En route'],
  ['boarding', 'Boarding'],
  ['scheduled', 'Scheduled'],
  ['arrived', 'Arrived'],
  ['cancelled', 'Cancelled'],
  ['diverted', 'Diverted'],
]

export function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const statusFilter = searchParams.get('status') ?? 'all'
  const board = useQuery({
    queryKey: ['board'],
    queryFn: () => api.get<BoardPayload>('/api/v1/board'),
    refetchInterval: 30_000,
  })

  if (board.isPending) {
    return (
      <div className="page" aria-busy="true">
        <p className="sr-only">Board loading.</p>
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <div className="flightcard flightcard--skeleton" key={i} aria-hidden="true" />
        ))}
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
    return (!query || text.includes(query.toLowerCase())) &&
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
            <div>
              <h1 className="board-masthead__title">Board</h1>
              <p className="board-masthead__sub">
                Updated {new Date(data.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · refreshes every 30s
              </p>
            </div>
            <dl className="board-masthead__stats">
              <div className="board-masthead__readout board-masthead__readout--live">
                <dt className="board-masthead__label">In the air</dt>
                <dd className="board-masthead__value">{active.length}</dd>
              </div>
              <div className="board-masthead__readout">
                <dt className="board-masthead__label">Upcoming</dt>
                <dd className="board-masthead__value">{upcoming.length}</dd>
              </div>
              <div className="board-masthead__readout">
                <dt className="board-masthead__label">Landed</dt>
                <dd className="board-masthead__value">{landed.length}</dd>
              </div>
            </dl>
          </header>
          <div className="toolbar">
            <div className="searchfield">
              <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M16 16l4.5 4.5" />
              </svg>
              <label htmlFor="board-search" className="sr-only">Search followed flights</label>
              <input
                id="board-search"
                type="search"
                value={query}
                onChange={(event) => {
                  const value = event.target.value
                  setSearchParams((current) => { if (value) current.set('q', value); else current.delete('q'); return current }, { replace: true })
                }}
                placeholder="Search flight, airline, airport or city"
              />
            </div>
            <div className="chips" role="group" aria-label="Operational status">
              {STATUS_FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="chip"
                  aria-pressed={statusFilter === value}
                  onClick={() => setSearchParams((current) => { if (value === 'all') current.delete('status'); else current.set('status', value); return current }, { replace: true })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {noMatches ? <div className="data-panel"><p>No followed flights match “{query || statusLabel(statusFilter as FlightRead['status'])}”.</p><button className="quietlink" type="button" onClick={() => setSearchParams({}, { replace: true })}>Clear filters</button></div> : <>
          <Group title="Active and boarding" items={active} emptyText="No flight in the air right now." />
          <Group title="Upcoming" items={upcoming} emptyText="No further flights ahead." />
          <Group title="Landed recently" items={landed} emptyText="No landings in the last 24 hours." />
          </>}
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
  const depIso = flight.actualDeparture ?? flight.scheduledDeparture
  const arrIso = flight.actualArrival ?? flight.scheduledArrival
  const minutes = Math.round((new Date(arrIso).getTime() - new Date(depIso).getTime()) / 60_000)
  const progress =
    flight.status === 'enroute'
      ? Math.min(1, Math.max(0, (Date.now() - new Date(depIso).getTime()) / Math.max(1, new Date(arrIso).getTime() - new Date(depIso).getTime())))
      : flight.status === 'arrived'
        ? 1
        : 0
  const note = relation === 'planned' ? 'Planned trip' : relation === 'logged' ? 'From your logbook' : flight.airline?.name ?? 'Self entered'
  const depDay = sameUtcDay(flight.scheduledDeparture, today) ? null : formatDate(flight.scheduledDeparture, flight.departure.tz)
  const arrDay = sameUtcDay(flight.scheduledArrival, today) ? null : formatDate(flight.scheduledArrival, flight.arrival.tz)
  return (
    <Link to={`/flight/${flight.id}`} className="flightcard" data-status={flight.status}>
      <div className="flightcard__id">
        <span className="airline-mark" aria-label={flight.airline?.name ?? 'self entered'}>
          {flight.airline?.iata ?? '…'}
        </span>
        <span className="flightcard__idtext">
          <span className="flightcard__code">{flight.flightCode}</span>
          <span className="flightcard__note">{note}</span>
        </span>
      </div>

      <div className="flightcard__route">
        <div className="flightcard__end">
          <span className="flightcard__iata">{flight.departure.iata}</span>
          <span className="flightcard__city">{flight.departure.city}</span>
          <span className="flightcard__time">{formatLocal(flight.scheduledDeparture, flight.departure.tz)}</span>
          <span className="flightcard__day">{depDay ?? 'Today'}</span>
        </div>
        <div className="flightcard__track" aria-hidden="true">
          <span className="flightcard__line">
            <span className="flightcard__progress" style={{ width: `${Math.round(progress * 100)}%` }} />
            {flight.status === 'enroute' && <span className="flightcard__plane" style={{ left: `${Math.round(progress * 100)}%` }} />}
          </span>
          <span className="flightcard__dur">{formatDuration(minutes)}</span>
        </div>
        <div className="flightcard__end flightcard__end--arr">
          <span className="flightcard__iata">{flight.arrival.iata}</span>
          <span className="flightcard__city">{flight.arrival.city}</span>
          <span className="flightcard__time">{condition === 'fresh' ? formatLocal(arrIso, flight.arrival.tz) : '—'}</span>
          <span className="flightcard__day">{arrDay ?? 'Today'}</span>
        </div>
      </div>

      <div className="flightcard__status">
        <StatusBadge status={flight.status} />
        <ConditionChip condition={condition} timestamp={lastUpdate} />
      </div>
    </Link>
  )
}
