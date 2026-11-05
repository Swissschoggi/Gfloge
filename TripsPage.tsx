import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isTightLayover, layoverMinutes, type TripRead } from '@gfloge/shared'
import { api } from '../api/client'
import { formatDate, formatDistance, formatDuration, formatLocal } from '../format'
import { IconChevron, IconPlus } from '../components/icons'
import { StatusBadge } from '../components/StatusPresentation'
import { FlightProgress } from '../components/FlightProgress'
import { AtlasSurface, toAtlasAirport } from '../components/FlightAtlas'
import { exportTripCardPng } from '../lib/exportImage'
import {
  airportCode,
  describeLayover,
  summarizeTrip,
  type Layover,
  type TripLeg,
  type TripPhase,
  type TripSummary,
} from '../lib/trip'

type TripLogbook = {
  flown: Array<{ id: string; flight: TripLeg['flight'] }>
  planned: Array<{ id: string; flight: TripLeg['flight'] }>
  manual: Array<{ id: string; flight: TripLeg['flight'] }>
}
type NewTrip = { name: string; description?: string; startDate?: string; endDate?: string }

/** "2026-11-05" → "Thu 5 Nov" (formatDate returns an ISO date in the chosen timezone). */
function friendlyDate(iso: string, tz: string | null): string {
  const [y, m, d] = formatDate(iso, tz).split('-').map(Number)
  if (!y || !m || !d) return formatDate(iso, tz)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function dateRange(trip: TripRead, summary: TripSummary): string | null {
  const first = summary.legs[0]?.flight
  const last = summary.legs[summary.legs.length - 1]?.flight
  const start = first ? friendlyDate(first.scheduledDeparture, first.departure.tz) : trip.startDate ? friendlyDate(trip.startDate, 'UTC') : null
  const end = last ? friendlyDate(last.scheduledArrival, last.arrival.tz) : trip.endDate ? friendlyDate(trip.endDate, 'UTC') : null
  if (!start) return null
  return end && end !== start ? `${start} – ${end}` : start
}

const PHASE_INK: Record<TripPhase, string> = {
  empty: 'var(--ink-3)',
  upcoming: 'var(--ink-2)',
  active: 'var(--st-enrt-ink)',
  done: 'var(--st-done-ink)',
}

function PhasePill({ phase, label }: { phase: TripPhase; label: string | null }) {
  if (!label) return null
  return (
    <span className="statusbadge" style={{ color: PHASE_INK[phase] }}>
      <span className="phase-dot" aria-hidden="true" data-phase={phase} />
      {label}
    </span>
  )
}

function RouteChain({ chain, size = 'md' }: { chain: string[]; size?: 'md' | 'lg' }) {
  if (!chain.length) return null
  return (
    <ol className={`route-chain route-chain--${size}`} aria-label={`Route ${chain.join(' to ')}`}>
      {chain.map((code, i) => (
        <li key={`${code}-${i}`}>
          {i > 0 && <span className="route-chain__arrow" aria-hidden="true">→</span>}
          <span>{code}</span>
        </li>
      ))}
    </ol>
  )
}

/* ---------------------------------------------------------------- list */

function TripCard({ trip }: { trip: TripRead }) {
  const s = summarizeTrip(trip)
  const range = dateRange(trip, s)
  return (
    <li>
      <Link to={`/trips/${trip.id}`} className="trip-card">
        <div className="trip-card__top">
          <PhasePill phase={s.phase} label={s.phaseLabel} />
          {range && <span className="trip-card__dates">{range}</span>}
        </div>
        <h2 className="trip-card__name">{trip.name}</h2>
        {s.chain.length ? <RouteChain chain={s.chain} /> : <p className="muted">No flights yet</p>}
        <div className="trip-card__foot">
          <span>{s.legs.length} {s.legs.length === 1 ? 'flight' : 'flights'}</span>
          {s.distanceKm > 0 && <span>{formatDistance(s.distanceKm)}</span>}
          <IconChevron size={18} className="trip-card__chev" />
        </div>
      </Link>
    </li>
  )
}

function TripsEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="trips-empty">
      <h2>Plan a journey</h2>
      <p>Group flights into a trip to see the whole route on one map, with layovers and a countdown. Your logbook stays untouched.</p>
      <button type="button" className="btn" onClick={onCreate}>
        <IconPlus size={18} /> Create your first trip
      </button>
    </div>
  )
}

/* ---------------------------------------------------------------- overview */

function LayoverChip({ layover }: { layover: Layover }) {
  const { kind, minutes, city, inboundDelayed } = layover
  const duration = minutes !== null ? formatDuration(minutes) : null
  let text: string
  let warn = false
  if (kind === 'check-times') {
    text = 'Check the times on these two flights'
    warn = true
  } else if (kind === 'airport-change') {
    text = `Change airports${duration ? ` · ${duration} between flights` : ''}`
    warn = true
  } else if (kind === 'stay') {
    const nights = Math.max(1, Math.round((minutes ?? 0) / 1440))
    text = `${nights} ${nights === 1 ? 'night' : 'nights'} in ${city}`
  } else if (kind === 'tight') {
    text = `Tight connection · ${duration} in ${city}${inboundDelayed ? ' · inbound is delayed' : ''}`
    warn = true
  } else {
    text = `${duration} layover in ${city}`
  }
  return (
    <li className="timeline__gap">
      <span className={`layover${warn ? ' layover--warn' : ''}`}>
        {warn && (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 8v5M12 16.5h.01M10.3 4.5 3.5 17a2 2 0 0 0 1.7 3h13.6a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0z" />
          </svg>
        )}
        {text}
      </span>
    </li>
  )
}

function LegCard({
  leg,
  selected,
  editing,
  removing,
  onSelect,
  onRemove,
}: {
  leg: TripLeg
  selected: boolean
  editing: boolean
  removing: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  const f = leg.flight
  const dep = airportCode(f.departure)
  const arr = airportCode(f.arrival)
  const live = f.status === 'enroute' || f.status === 'boarding'
  const gate = [f.depTerminal, f.depGate].filter(Boolean).join(' / ')
  return (
    <li className="timeline__leg">
      <article className="leg-card" data-selected={selected}>
        <div className="leg-card__top">
          <strong>{f.flightCode}</strong>
          <span className="muted">{f.airline?.name ?? 'Unknown airline'}</span>
          <StatusBadge status={f.status} />
        </div>

        <button type="button" className="leg-card__route" aria-pressed={selected} onClick={onSelect} aria-label={`Show ${dep} to ${arr} on the map`}>
          <span className="leg-card__end">
            <strong>{dep}</strong>
            <small>{f.departure.city || f.departure.name}</small>
          </span>
          <span className="leg-card__line" aria-hidden="true" />
          <span className="leg-card__end leg-card__end--arr">
            <strong>{arr}</strong>
            <small>{f.arrival.city || f.arrival.name}</small>
          </span>
        </button>

        <dl className="leg-card__times">
          <div>
            <dt>Departs</dt>
            <dd>{friendlyDate(f.scheduledDeparture, f.departure.tz)} · {formatLocal(f.scheduledDeparture, f.departure.tz)}</dd>
          </div>
          <div>
            <dt>Arrives</dt>
            <dd>{formatLocal(f.actualArrival ?? f.scheduledArrival, f.arrival.tz)}</dd>
          </div>
          {gate && (
            <div>
              <dt>Gate</dt>
              <dd>{gate}</dd>
            </div>
          )}
        </dl>

        {live && <FlightProgress status={f.status} departure={f.actualDeparture ?? f.scheduledDeparture} arrival={f.actualArrival ?? f.scheduledArrival} />}

        <div className="leg-card__foot">
          {leg.loggedState === 'planned' && f.status === 'scheduled' && <span className="tag">Planned</span>}
          <Link to={`/flight/${f.id}`} className="quietlink">Details</Link>
          {editing && (
            <button type="button" className="btn-quiet-danger" disabled={removing} onClick={onRemove} aria-label={`Remove ${f.flightCode} from this trip`}>
              Remove
            </button>
          )}
        </div>
      </article>
    </li>
  )
}

function SharePanel({ tripId, title, legs }: { tripId: string; title: string; legs: TripLeg[] }) {
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const share = useMutation({
    mutationFn: () => api.post<{ token: string; url?: string }>('/api/v1/share/trips', { tripId }),
    onSuccess: (d) => setUrl(new URL(d.url ?? `/share/trip/${d.token}`, window.location.origin).toString()),
  })
  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard unavailable: the field is selectable */
    }
  }
  return (
    <section className="trip-share" aria-label="Share this trip">
      <div className="trip-share__head">
        <h2>Share this trip</h2>
        <p className="muted">Anyone with the link sees the route and times, never your seat, notes or bookings.</p>
      </div>
      <div className="trip-share__row">
        {url ? (
          <>
            <input className="input" readOnly value={url} aria-label="Public link" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
          </>
        ) : (
          <button type="button" className="btn" disabled={share.isPending} onClick={() => share.mutate()}>
            {share.isPending ? 'Creating…' : 'Create link'}
          </button>
        )}
        <button
          type="button"
          className="btn-outline"
          onClick={() =>
            exportTripCardPng({
              title,
              flights: legs.map(({ flight }) => ({ depCode: airportCode(flight.departure), arrCode: airportCode(flight.arrival), flightCode: flight.flightCode })),
            })
          }
        >
          Save as image
        </button>
      </div>
      {share.isError && <p role="alert" className="form-error">Could not create a link. Try again.</p>}
    </section>
  )
}

function EditPanel({
  trip,
  onDone,
  onSave,
  saving,
  saveError,
  onDelete,
}: {
  trip: TripRead
  onDone: () => void
  onSave: (v: { name: string; description: string; startDate: string | null; endDate: string | null }) => void
  saving: boolean
  saveError: boolean
  onDelete: () => void
}) {
  const [name, setName] = useState(trip.name)
  const [description, setDescription] = useState(trip.description ?? '')
  const [start, setStart] = useState(trip.startDate?.slice(0, 10) ?? '')
  const [end, setEnd] = useState(trip.endDate?.slice(0, 10) ?? '')
  return (
    <form
      className="trip-edit"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({
          name,
          description,
          startDate: start ? new Date(`${start}T00:00:00Z`).toISOString() : null,
          endDate: end ? new Date(`${end}T23:59:00Z`).toISOString() : null,
        })
      }}
    >
      <div className="trip-edit__head">
        <h2>Edit trip</h2>
        <div className="trip-edit__actions">
          <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
          <button type="submit" className="btn" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      <div className="trip-edit__grid">
        <div className="field trip-edit__wide">
          <label htmlFor="trip-edit-name">Name</label>
          <input id="trip-edit-name" className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field trip-edit__wide">
          <label htmlFor="trip-edit-description">Notes</label>
          <textarea id="trip-edit-description" className="textarea" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="trip-edit-start">Start date</label>
          <input id="trip-edit-start" className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="trip-edit-end">End date</label>
          <input id="trip-edit-end" className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      {saveError && <p role="alert" className="form-error">Couldn’t save. Your edits are still here.</p>}
      <div className="trip-edit__danger">
        <button type="button" className="btn-quiet-danger" onClick={onDelete}>Delete trip…</button>
        <span className="muted">Flights stay in your logbook.</span>
      </div>
    </form>
  )
}

function AddFlights({ available, onAdd, adding }: { available: TripLogbook['flown']; onAdd: (id: string) => void; adding: boolean }) {
  return (
    <section className="trip-add" aria-label="Add flights from your logbook">
      <h2>Add from your logbook</h2>
      {available.length ? (
        <ul>
          {available.map((entry) => (
            <li key={entry.id}>
              <span>
                <strong>{entry.flight.flightCode}</strong>
                <small>{airportCode(entry.flight.departure)} → {airportCode(entry.flight.arrival)} · {friendlyDate(entry.flight.scheduledDeparture, entry.flight.departure.tz)}</small>
              </span>
              <button type="button" className="btn-outline btn--sm" disabled={adding} onClick={() => onAdd(entry.id)}>Add</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Every flight in your logbook is already in this trip.</p>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- page */

export function TripsPage() {
  const { tripId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const editing = searchParams.get('edit') === '1'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const createDialog = useRef<HTMLDialogElement>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const [selectedLeg, setSelectedLeg] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', description: '', startDate: '', endDate: '' })
  const [formError, setFormError] = useState<string | null>(null)

  const trips = useQuery({ queryKey: ['trips'], queryFn: () => api.get<{ trips: TripRead[] }>('/api/v1/trips') })
  // The logbook only feeds the "add flights" list, so it never blocks the page.
  const logbook = useQuery({ queryKey: ['logbook', '', ''], queryFn: () => api.get<TripLogbook>('/api/v1/logbook'), enabled: !!tripId && editing })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trips'] })
    void queryClient.invalidateQueries({ queryKey: ['logbook'] })
  }
  const create = useMutation({ mutationFn: (v: NewTrip) => api.post<{ trip: TripRead }>('/api/v1/trips', v), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/api/v1/trips/${id}`), onSuccess: () => { invalidate(); navigate('/trips', { replace: true }) } })
  const attach = useMutation({ mutationFn: (v: { trip: string; userFlight: string }) => api.put(`/api/v1/trips/${v.trip}/flights/${v.userFlight}`), onSuccess: invalidate })
  const detach = useMutation({ mutationFn: (v: { trip: string; userFlight: string }) => api.delete(`/api/v1/trips/${v.trip}/flights/${v.userFlight}`), onSuccess: invalidate })
  const update = useMutation({ mutationFn: (v: { id: string; name: string; description: string; startDate: string | null; endDate: string | null }) => api.patch(`/api/v1/trips/${v.id}`, v), onSuccess: invalidate })

  const selected = trips.data?.trips.find((t) => t.id === tripId)
  const summary = selected ? summarizeTrip(selected) : null

  useEffect(() => {
    document.title = `${selected?.name ?? 'Trips'} · Gfloge`
  }, [selected?.name])
  useEffect(() => {
    setSelectedLeg(null)
  }, [tripId])

  async function submitNew(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (!form.name.trim()) return setFormError('Give the trip a name.')
    try {
      const { trip } = await create.mutateAsync({
        name: form.name.trim(),
        description: form.description,
        startDate: form.startDate ? new Date(`${form.startDate}T00:00:00Z`).toISOString() : undefined,
        endDate: form.endDate ? new Date(`${form.endDate}T23:59:00Z`).toISOString() : undefined,
      })
      createDialog.current?.close()
      setForm({ name: '', description: '', startDate: '', endDate: '' })
      navigate(`/trips/${trip.id}?edit=1`)
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not create the trip.')
    }
  }

  const createDialogEl = (
    <dialog ref={createDialog} className="confirm-dialog" aria-labelledby="new-trip-title">
      <form onSubmit={(e) => void submitNew(e)} className="trip-new">
        <h2 id="new-trip-title">New trip</h2>
        <div className="field">
          <label htmlFor="trip-name">Name</label>
          <input id="trip-name" className="input" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Singapore work trip" />
        </div>
        <div className="trip-new__dates">
          <div className="field">
            <label htmlFor="trip-start">Start <span className="muted">(optional)</span></label>
            <input id="trip-start" type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="trip-end">End <span className="muted">(optional)</span></label>
            <input id="trip-end" type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </div>
        </div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="actions-row">
          <button type="button" className="btn-ghost" onClick={() => createDialog.current?.close()}>Cancel</button>
          <button type="submit" className="btn" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create trip'}</button>
        </div>
      </form>
    </dialog>
  )

  if (trips.isPending) {
    return (
      <div className="page trips-page" aria-busy="true">
        <span className="sr-only" role="status">Loading trips</span>
        <div className="skeleton skeleton--title" />
        <div className="trip-grid">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton skeleton--card" />)}
        </div>
      </div>
    )
  }
  if (trips.isError) {
    return (
      <div className="page trips-page">
        <h1>Trips</h1>
        <p role="alert" className="form-error">Trips couldn’t be loaded.</p>
        <button className="btn-outline" type="button" onClick={() => void trips.refetch()}>Try again</button>
      </div>
    )
  }
  if (tripId && !selected) {
    return (
      <div className="page trips-page">
        <h1>Trip not found</h1>
        <p className="muted">It may have been deleted.</p>
        <Link to="/trips" className="btn-outline">Back to trips</Link>
      </div>
    )
  }

  /* ---- list ---- */
  if (!selected || !summary) {
    const list = trips.data.trips
    return (
      <div className="page trips-page">
        <header className="pagehead">
          <div>
            <h1>Trips</h1>
            <p className="pagehead__lede">Group flights into journeys: one route, one map, one countdown.</p>
          </div>
          {list.length > 0 && (
            <button type="button" className="btn" onClick={() => createDialog.current?.showModal()}>
              <IconPlus size={18} /> New trip
            </button>
          )}
        </header>
        {list.length ? (
          <ul className="trip-grid">{list.map((t) => <TripCard key={t.id} trip={t} />)}</ul>
        ) : (
          <TripsEmpty onCreate={() => createDialog.current?.showModal()} />
        )}
        {createDialogEl}
      </div>
    )
  }

  /* ---- overview ---- */
  const range = dateRange(selected, summary)
  const inTrip = new Set(selected.flights.map((f) => f.id))
  const available = logbook.data ? [...logbook.data.planned, ...logbook.data.flown, ...logbook.data.manual].filter((e) => !inTrip.has(e.id)) : []
  const activeLeg = selectedLeg ?? summary.nextLegId
  const stats = [
    `${summary.legs.length} ${summary.legs.length === 1 ? 'flight' : 'flights'}`,
    summary.distanceKm > 0 ? formatDistance(summary.distanceKm) : null,
    summary.daysAway ? `${summary.daysAway} ${summary.daysAway === 1 ? 'day' : 'days'} away` : null,
  ].filter(Boolean) as string[]

  return (
    <div className="page trips-page">
      <header className="trip-hero">
        <Link to="/trips" className="back-link">← Trips</Link>
        <div className="trip-hero__body">
          <div className="trip-hero__text">
            <div className="trip-hero__meta">
              <PhasePill phase={summary.phase} label={summary.phaseLabel} />
              {range && <span className="muted">{range}</span>}
            </div>
            <h1>{selected.name}</h1>
            {selected.description && <p className="pagehead__lede">{selected.description}</p>}
            <RouteChain chain={summary.chain} size="lg" />
            {stats.length > 0 && (
              <ul className="chiprow" aria-label="Trip totals">
                {stats.map((s) => <li key={s}>{s}</li>)}
              </ul>
            )}
          </div>
          {!editing && (
            <div className="pagehead__actions">
              <button type="button" className="btn-outline" onClick={() => setSearchParams({ edit: '1' })}>Edit</button>
            </div>
          )}
        </div>
      </header>

      {editing && (
        <EditPanel
          key={selected.id}
          trip={selected}
          onDone={() => setSearchParams({})}
          onSave={(v) => update.mutate({ id: selected.id, ...v }, { onSuccess: () => setSearchParams({}) })}
          saving={update.isPending}
          saveError={update.isError}
          onDelete={() => deleteDialog.current?.showModal()}
        />
      )}

      {summary.legs.length ? (
        <div className="trip-layout">
          <ol className="timeline" aria-label="Flights in this trip">
            {summary.legs.flatMap((leg, i) => {
              const prev = summary.legs[i - 1]
              const items = []
              if (prev) items.push(<LayoverChip key={`gap-${leg.id}`} layover={describeLayover(prev, leg, layoverMinutes, isTightLayover)} />)
              items.push(
                <LegCard
                  key={leg.id}
                  leg={leg}
                  selected={leg.id === activeLeg}
                  editing={editing}
                  removing={detach.isPending}
                  onSelect={() => setSelectedLeg(leg.id)}
                  onRemove={() => detach.mutate({ trip: selected.id, userFlight: leg.id })}
                />,
              )
              return items
            })}
          </ol>

          <aside className="trip-layout__map">
            <AtlasSurface
              routes={summary.legs.map((l) => ({ id: l.id, code: l.flight.flightCode, from: toAtlasAirport(l.flight.departure), to: toAtlasAirport(l.flight.arrival) }))}
              airports={[]}
              selectedRouteId={activeLeg}
              heading="Trip route"
              countLabel={`${summary.legs.length} ${summary.legs.length === 1 ? 'leg' : 'legs'}`}
              footerLabel="Great-circle routes"
            />
          </aside>
        </div>
      ) : (
        <div className="trips-empty">
          <h2>No flights in this trip yet</h2>
          <p>Add flights from your logbook to see the route, layovers and countdown.</p>
          {!editing && <button type="button" className="btn" onClick={() => setSearchParams({ edit: '1' })}>Add flights</button>}
        </div>
      )}

      {editing && (
        <AddFlights
          available={available}
          adding={attach.isPending}
          onAdd={(id) => attach.mutate({ trip: selected.id, userFlight: id })}
        />
      )}
      {(detach.isError || attach.isError) && <p role="alert" className="form-error">That change didn’t go through. Your logbook is unchanged.</p>}

      {summary.legs.length > 0 && !editing && <SharePanel tripId={selected.id} title={selected.name} legs={summary.legs} />}

      <dialog ref={deleteDialog} aria-labelledby="delete-trip-title" className="confirm-dialog">
        <h2 id="delete-trip-title">Delete “{selected.name}”?</h2>
        <p>The trip is removed. Its flights stay in your logbook.</p>
        <div className="actions-row">
          <button type="button" className="btn-ghost" onClick={() => deleteDialog.current?.close()}>Keep trip</button>
          <button type="button" className="btn-danger" disabled={remove.isPending} onClick={() => { remove.mutate(selected.id); deleteDialog.current?.close() }}>Delete trip</button>
        </div>
      </dialog>
    </div>
  )
}
