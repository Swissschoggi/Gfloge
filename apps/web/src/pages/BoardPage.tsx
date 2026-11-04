import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import type { BoardPayload } from '@gfloge/shared'
import { api } from '../api/client'
import { FlightAtlas } from '../components/FlightAtlas'
import { ConditionChip, StatusBadge } from '../components/StatusPresentation'
import { FlightProgress } from '../components/FlightProgress'
import { ActivityFeed } from '../components/ActivityFeed'
import { IconChevron } from '../components/icons'
import { formatDate, formatDuration, formatLocal, sameUtcDay } from '../format'

type BoardItem = BoardPayload['active'][number]

const STATUS_OPTIONS = [
  ['all', 'All statuses'],
  ['scheduled', 'Scheduled'],
  ['boarding', 'Boarding'],
  ['enroute', 'En route'],
  ['arrived', 'Arrived'],
  ['cancelled', 'Cancelled'],
  ['diverted', 'Diverted'],
] as const

export function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '')
  const query = searchParams.get('q') ?? ''
  const status = searchParams.get('status') ?? 'all'
  const selectedId = searchParams.get('flight')
  const board = useQuery({
    queryKey: ['board'],
    queryFn: () => api.get<BoardPayload>('/api/v1/board'),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  useEffect(() => setSearchInput(query), [query])

  const data = board.data
  const allItems = useMemo(() => data ? [...data.active, ...data.upcoming, ...data.landed] : [], [data])
  const filtered = useMemo(() => allItems.filter((item) => {
    const flight = item.flight
    const text = `${flight.flightCode} ${flight.airline?.name ?? ''} ${flight.departure.iata ?? ''} ${flight.arrival.iata ?? ''} ${flight.departure.city} ${flight.arrival.city}`.toLowerCase()
    return (!query || text.includes(query.toLowerCase())) && (status === 'all' || flight.status === status)
  }), [allItems, query, status])
  const selected = filtered.find((item) => item.userFlightId === selectedId) ?? filtered[0] ?? null
  const active = filtered.filter((item) => data?.active.some((source) => source.userFlightId === item.userFlightId))
  const upcoming = filtered.filter((item) => data?.upcoming.some((source) => source.userFlightId === item.userFlightId))
  const landed = filtered.filter((item) => data?.landed.some((source) => source.userFlightId === item.userFlightId))

  function updateParam(key: string, value: string) {
    setSearchParams((current) => {
      if (value) current.set(key, value)
      else current.delete(key)
      return current
    }, { replace: true })
  }

  function clearFilters() {
    setSearchInput('')
    setSearchParams((current) => {
      current.delete('q')
      current.delete('status')
      return current
    }, { replace: true })
  }

  return (
    <div className="flight-board">
      <header className="flight-board__heading">
        <div>
          <p className="eyebrow">{data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · live` : 'Live'}</p>
          <h1>Your flights</h1>
          <p className="flight-board__updated">Everything you’re tracking, on one map. Refreshes every 30 seconds.</p>
        </div>
        <div className="flight-board__counts" aria-label="Flight totals">
          <span><strong>{data?.active.length ?? '—'}</strong> in the air</span>
          <span><strong>{data?.upcoming.length ?? '—'}</strong> upcoming</span>
          <span><strong>{data?.landed.length ?? '—'}</strong> landed</span>
        </div>
      </header>

      <section className="board-workspace" aria-label="Flight map and manifest">
        <div className="board-workspace__map-column">
          <FlightAtlas
            items={filtered}
            selected={selected}
          />
          {!board.isPending && !board.isError && <SelectedFlight item={selected} empty={allItems.length === 0} noMatches={filtered.length === 0 && allItems.length > 0} onClearFilters={clearFilters} />}
        </div>

        <aside className="flight-manifest" aria-labelledby="manifest-title">
          <header className="flight-manifest__header">
            <div className="flight-manifest__titleline">
              <h2 id="manifest-title">Flights</h2>
              <span className="flight-manifest__count">{filtered.length}{filtered.length !== allItems.length ? ` / ${allItems.length}` : ''}</span>
              <span className="sr-only" role="status">
                {filtered.length} {filtered.length === 1 ? 'flight' : 'flights'} shown in the manifest
              </span>
            </div>
            <label className="sr-only" htmlFor="manifest-search">Search flights</label>
            <input
              id="manifest-search"
              className="manifest-search"
              type="search"
              value={searchInput}
              onChange={(event) => {
                const value = event.target.value
                setSearchInput(value)
                updateParam('q', value.trim())
              }}
              placeholder="Flight, airline, airport…"
            />
            <label className="sr-only" htmlFor="manifest-status">Filter by status</label>
            <select id="manifest-status" className="manifest-status" value={status} onChange={(event) => updateParam('status', event.target.value === 'all' ? '' : event.target.value)}>
              {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </header>

          <div className="flight-manifest__body" aria-busy={board.isPending}>
            {board.isPending ? (
              <div className="manifest-state" role="status" aria-busy="true">
                <div className="skeleton skeleton-card" />
                <div className="skeleton skeleton-card" />
                <div className="skeleton skeleton-card" />
              </div>
            ) : board.isError ? (
              <div className="manifest-state" role="alert">
                <p>Could not load your flights. Check your connection and try again.</p>
                <button className="btn-outline" type="button" onClick={() => void board.refetch()}>Retry</button>
              </div>
            ) : allItems.length === 0 ? (
              <div className="manifest-state manifest-state--empty">
                <h3>No flights yet</h3>
                <p>Add a flight to see it live on the map. Everything stays on your own server.</p>
                <Link to="/add" className="btn">Track a flight</Link>
              </div>
            ) : filtered.length === 0 ? (
              <div className="manifest-state">
                <p>No flights match these filters.</p>
                <button className="quietlink" type="button" onClick={clearFilters}>Clear filters</button>
              </div>
            ) : (
              <div className="manifest-groups">
                <ManifestGroup title="In the air" items={active} selectedId={selected?.userFlightId ?? null} onSelect={(id) => updateParam('flight', id)} />
                <ManifestGroup title="Upcoming" items={upcoming} selectedId={selected?.userFlightId ?? null} onSelect={(id) => updateParam('flight', id)} />
                <ManifestGroup title="Recently landed" items={landed} selectedId={selected?.userFlightId ?? null} onSelect={(id) => updateParam('flight', id)} />
              </div>
            )}
          </div>
          <footer className="flight-manifest__footer">
            <span>Times shown at each airport</span>
            <Link to="/logbook">Open logbook <IconChevron size={16} /></Link>
          </footer>
        </aside>
      </section>
      <section className="board-activity" aria-label="Recent activity">
        <h2>Activity</h2>
        <ActivityFeed />
      </section>
    </div>
  )
}

function ManifestGroup({
  title,
  items,
  selectedId,
  onSelect,
}: {
  title: string
  items: BoardItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section className="manifest-group" aria-label={`${title}, ${items.length} ${items.length === 1 ? 'flight' : 'flights'}`}>
      <h3 className="manifest-group__heading"><span>{title}</span><span>{items.length}</span></h3>
      {items.length === 0 ? <p className="manifest-group__empty">No flights in this group.</p> : (
        <ul className="manifest-list">
          {items.map((item) => <li key={item.userFlightId}>
            <ManifestRow item={item} selected={item.userFlightId === selectedId} onSelect={() => onSelect(item.userFlightId)} />
          </li>)}
        </ul>
      )}
    </section>
  )
}

function ManifestRow({ item, selected, onSelect }: { item: BoardItem; selected: boolean; onSelect: () => void }) {
  const flight = item.flight
  const now = new Date().toISOString()
  const departureDay = sameUtcDay(flight.scheduledDeparture, now) ? 'Today' : formatDate(flight.scheduledDeparture, flight.departure.tz)
  const arrivalIso = flight.actualArrival ?? flight.scheduledArrival
  const duration = Math.round((new Date(arrivalIso).getTime() - new Date(flight.actualDeparture ?? flight.scheduledDeparture).getTime()) / 60_000)

  return (
    <button type="button" className="manifest-row" aria-pressed={selected} onClick={onSelect}>
      <span className="manifest-row__topline">
        <span className="manifest-row__flight">{flight.flightCode}</span>
        <StatusBadge status={flight.status} />
      </span>
      <span className="manifest-row__route">
        <span>{flight.departure.iata ?? flight.departure.icao}</span>
        <span aria-hidden="true">→</span>
        <span>{flight.arrival.iata ?? flight.arrival.icao}</span>
        <span className="manifest-row__duration">{formatDuration(duration)}</span>
      </span>
      <span className="manifest-row__times">
        <span><strong>{formatLocal(flight.scheduledDeparture, flight.departure.tz)}</strong> <small>{departureDay} · {flight.departure.iata}</small></span>
        <span><strong>{item.condition === 'fresh' ? formatLocal(arrivalIso, flight.arrival.tz) : '—'}</strong> <small>arr · {flight.arrival.iata}</small></span>
      </span>
      <FlightProgress compact status={flight.status} departure={flight.actualDeparture ?? flight.scheduledDeparture} arrival={flight.actualArrival ?? flight.scheduledArrival} />
      <ConditionChip condition={item.condition} timestamp={item.lastUpdateTime} />
    </button>
  )
}

function SelectedFlight({
  item,
  empty,
  noMatches,
  onClearFilters,
}: {
  item: BoardItem | null
  empty: boolean
  noMatches: boolean
  onClearFilters: () => void
}) {
  if (!item) {
    return (
      <div className="selected-flight selected-flight--empty" aria-live="polite">
        <span className="selected-flight__index">Selected flight</span>
        <p>{empty ? 'Routes you add will light up the map.' : 'Clear the filters to select a flight.'}</p>
        {noMatches && <button type="button" className="quietlink" onClick={onClearFilters}>Clear filters</button>}
      </div>
    )
  }

  const flight = item.flight
  const arrivalIso = flight.actualArrival ?? flight.scheduledArrival
  const duration = Math.round((new Date(arrivalIso).getTime() - new Date(flight.actualDeparture ?? flight.scheduledDeparture).getTime()) / 60_000)
  return (
    <article className="selected-flight" aria-live="polite" aria-label={`Selected flight ${flight.flightCode}`}>
      <div className="selected-flight__heading">
        <div>
          <span className="selected-flight__index">Selected flight</span>
          <h2>{flight.flightCode}</h2>
        </div>
        <div className="selected-flight__badges">
          <StatusBadge status={flight.status} />
          <ConditionChip condition={item.condition} timestamp={item.lastUpdateTime} />
        </div>
      </div>
      <div className="selected-flight__route">
        <div><strong>{flight.departure.iata}</strong><span>{flight.departure.city}</span><time>{formatLocal(flight.scheduledDeparture, flight.departure.tz)} · {flight.departure.iata} local</time></div>
        <span className="selected-flight__line" aria-hidden="true" />
        <div><strong>{flight.arrival.iata}</strong><span>{flight.arrival.city}</span><time>{item.condition === 'fresh' ? formatLocal(arrivalIso, flight.arrival.tz) : 'Time unavailable'} · {flight.arrival.iata} local</time></div>
      </div>
      <FlightProgress status={flight.status} departure={flight.actualDeparture ?? flight.scheduledDeparture} arrival={flight.actualArrival ?? flight.scheduledArrival} />
      <div className="selected-flight__actions">
        <span>{formatDuration(duration)} planned duration</span>
        <Link to={`/flight/${flight.id}`}>Open flight details <IconChevron size={16} /></Link>
      </div>
    </article>
  )
}
