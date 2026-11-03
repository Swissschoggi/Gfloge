import { useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CABIN_CLASSES, type AlertsPayload, type Cabin, type FlightRead, type PositionData } from '@gfloge/shared'
import { api } from '../api/client'
import { formatDate, formatDistance, formatDuration, formatLocal, sameUtcDay } from '../format'
import { ConditionChip, StatusBadge } from '../components/StatusPresentation'
import { TrackMap } from '../components/TrackMap'

const today = () => new Date().toISOString()

export function FlightDetailPage() {
  const { flightId = '' } = useParams()
  const queryClient = useQueryClient()
  const isManual = flightId.startsWith('manual:')

  const flight = useQuery({
    queryKey: ['flight', flightId],
    queryFn: () => api.get<{ flight: FlightRead }>(`/api/v1/flights/${flightId}`).then((r) => r.flight),
  })

  const positions = useQuery({
    queryKey: ['positions', flightId],
    queryFn: () => api.get<PositionData>(`/api/v1/flights/${flightId}/positions`),
    enabled: !isManual,
    retry: false,
    staleTime: 0,
    refetchInterval: flight.data?.status === 'enroute' ? 20_000 : false,
  })

  const alerts = useQuery({
    queryKey: ['alerts', flightId],
    queryFn: () => api.get<{ alerts: AlertsPayload[] }>(`/api/v1/flights/${flightId}/alerts`),
    enabled: !isManual,
  })

  const relation = useQuery({
    queryKey: ['relation', flightId],
    queryFn: () => api.get<{ relation: {
      id: string; role: 'tracked' | 'logged'; isFollowing: boolean
      loggedState: 'flown' | 'planned' | null; seat: string | null
      cabin: Cabin; note: string | null; rating: number | null; tripId: string | null
    } | null }>(`/api/v1/user-flights/by-flight/${encodeURIComponent(flightId)}`).then((r) => r.relation),
  })

  const follow = useMutation({
    mutationFn: (nextFollow: 'follow' | 'unfollow') => {
      if (!relation.data) {
        return api.post('/api/v1/user-flights', {
          flightId: isManual ? undefined : flightId,
          manualFlightId: isManual ? flightId.slice(7) : undefined,
          follow: nextFollow === 'follow',
        })
      }
      return api.patch(`/api/v1/user-flights/${relation.data.id}`, { follow: nextFollow === 'follow' })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board'] })
      void queryClient.invalidateQueries({ queryKey: ['relation', flightId] })
    },
  })

  if (flight.isError) {
    const status = (flight.error as { status?: number }).status
    if (status === 404) {
      return (
        <div className="page">
          <h1>Flight not found</h1>
          <p className="page__meta">There is no flight at this address that you can view.</p>
          <Link to="/" className="btn" style={{ marginTop: 'var(--space-s)' }}>
            Back to the Board
          </Link>
        </div>
      )
    }
    return (
      <div className="page">
        <h1>Flight</h1>
        <div role="alert" className="form-error">
          Could not load this flight. {(flight.error as Error).message}
        </div>
        <button className="btn" type="button" style={{ marginTop: 'var(--space-s)' }} onClick={() => void flight.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  if (flight.isPending) {
    return (
      <div className="page">
        <div className="data-panel">
          <p className="form-note">Loading flight…</p>
        </div>
      </div>
    )
  }

  const f = flight.data
  const isPast = (f.actualArrival ?? f.scheduledArrival) < today() && f.status !== 'scheduled' && f.status !== 'boarding'
  const condition = f.isManual ? ('unavailable' as const) : positions.error ? ('unavailable' as const) : (positions.data?.condition ?? 'fresh')

  return (
    <article className="page">
      <header className="hero">
        <div className="hero__meta">
          <span className="airline-mark">{f.airline?.iata ?? 'SEL'}</span>
          <span className="hero__airline">{f.airline?.name ?? 'Self-entered flight'}</span>
          <StatusBadge status={f.status} />
          <ConditionChip condition={condition} timestamp={positions.data?.fetchedAt ?? null} />
          {relation.data?.loggedState === 'planned' && <span className="relation-chip">Planned</span>}
        </div>
        <h1 className="hero__code">{f.flightCode}</h1>
        <div className="hero__route">
          <div className="hero__end">
            <span className="hero__iata">{f.departure.iata}</span>
            <span className="hero__city">{f.departure.city}</span>
          </div>
          <span className="hero__arrow" aria-hidden="true">
            <svg viewBox="0 0 120 12" preserveAspectRatio="none"><path d="M0 6h112M106 1l8 5-8 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {f.distanceKm !== null && <span className="hero__distance">{formatDistance(f.distanceKm)}</span>}
          </span>
          <div className="hero__end hero__end--arr">
            <span className="hero__iata">{f.arrival.iata}</span>
            <span className="hero__city">{f.arrival.city}</span>
          </div>
        </div>
        <p className="hero__sub">{f.departure.name} to {f.arrival.name}</p>
      </header>

      <div className="dossier">
        <div className="dossier__map">
          {!isManual && (
            <TrackMap departure={f.departure} arrival={f.arrival} positions={positions.data ?? null} positionsLoading={positions.isLoading} positionsError={positions.error} />
          )}
          <p className="attribution" style={{ marginTop: 'var(--space-s)' }}>
            {f.isDemo
              ? 'Data source: Gfloge demo dataset (fabricated for testing, not real aviation data).'
              : f.isManual
                ? 'Self-entered record: schedule data is your input; no provider tracking until configured.'
                : `Data source: ${f.providerId ?? 'unconfigured'} · demo: ${String(f.isDemo)}`}
          </p>
        </div>

        <div className="dossier__info">
          {(alerts.data?.alerts ?? []).map((a) => (
            <div className="alertbanner" role="alert" key={a.id}>
              <strong>Update:</strong>
              <span>
                {a.type === 'time_shift'
                  ? `Departure moved to ${formatLocal(newDateAsIso(a.new), f.departure.tz)} ${f.departure.iata} local (was ${formatLocal(
                      oldDateAsIso(a.old),
                      f.departure.tz
                    )})`
                  : `Status change: ${a.type.replace('_', ' ')}`}
              </span>
            </div>
          ))}

          <div className="data-panel">
            <h2 className="data-panel__title">Times</h2>
            <TimeRow label="Scheduled departure" value={f.scheduledDeparture} tz={f.departure.tz} airport={f.departure.iata} />
            {f.actualDeparture && <TimeRow label="Actual departure" value={f.actualDeparture} tz={f.departure.tz} airport={f.departure.iata} />}
            <TimeRow label="Scheduled arrival" value={f.scheduledArrival} tz={f.arrival.tz} airport={f.arrival.iata} />
            {f.actualArrival && <TimeRow label="Actual arrival" value={f.actualArrival} tz={f.arrival.tz} airport={f.arrival.iata} />}
            {(f.depGate || f.depTerminal || f.arrGate || f.arrTerminal) && (
              <div className="readout-row">
                <span className="readout-row__label">Gates</span>
                <span className="readout-row__value">
                  {[f.depTerminal, f.depGate].filter(Boolean).join(' / ') || 'not published'} →{' '}
                  {[f.arrTerminal, f.arrGate].filter(Boolean).join(' / ') || 'not published'}
                </span>
              </div>
            )}
            <div className="readout-row">
              <span className="readout-row__label">Duration</span>
              <span className="readout-row__value">
                {formatDuration(
                  Math.round(
                    (new Date(f.actualArrival ?? f.scheduledArrival).getTime() - new Date(f.actualDeparture ?? f.scheduledDeparture).getTime()) / 60_000
                  )
                )}
              </span>
            </div>
          </div>

          {f.aircraft && (f.aircraft.registration || f.aircraft.icaoType) && (
            <div className="data-panel">
              <h2 className="data-panel__title">Aircraft</h2>
              <div className="readout-row">
                <span className="readout-row__label">Registration</span>
                <span className="readout-row__value">{f.aircraft.registration ?? 'unknown'}</span>
              </div>
              <div className="readout-row">
                <span className="readout-row__label">Type</span>
                <span className="readout-row__value">
                  {f.aircraft.icaoType ?? '?'} {f.aircraft.typeName ? `· ${f.aircraft.typeName}` : ''}
                </span>
              </div>
            </div>
          )}

          <div className="data-panel">
            <h2 className="data-panel__title">Airport weather</h2>
            <ConditionChip condition="unavailable" />
            <p className="form-note">Weather observations are not connected in this milestone. No conditions are inferred.</p>
            <div className="weather-pair"><span>{f.departure.iata} · {f.departure.tz}</span><span>{f.arrival.iata} · {f.arrival.tz}</span></div>
          </div>

          {relation.data && relation.data.role === 'logged' ? (
            <LogEditor
              userFlightId={relation.data.id}
              loggedState={relation.data.loggedState}
              seat={relation.data.seat ?? ''}
              cabin={relation.data.cabin}
              note={relation.data.note ?? ''}
              rating={relation.data.rating ?? 0}
              initialTripId={relation.data.tripId}
              isFollowing={relation.data.isFollowing}
              onUnfollow={() => follow.mutate('unfollow')}
              onSaved={() => {
                void queryClient.invalidateQueries({ queryKey: ['board'] })
                void queryClient.invalidateQueries({ queryKey: ['relation', flightId] })
                void queryClient.invalidateQueries({ queryKey: ['logbook'] })
                void queryClient.invalidateQueries({ queryKey: ['stats'] })
              }}
            />
          ) : (
            <div className="data-panel">
              <h2 className="data-panel__title">Your record</h2>
              <p className="form-note" style={{ marginBottom: 'var(--space-s)' }}>
                {isPast
                  ? 'This flight already flew. Add it to your personal logbook.'
                  : relation.data?.isFollowing
                    ? 'You are following this flight. Log it to keep a personal record (planned or flown).'
                    : 'Follow it on the Board, or save it as a planned trip.'}
              </p>
              <div className="actions-row">
                {!isPast && !relation.data?.isFollowing && (
                  <button type="button" className="btn-outline" onClick={() => follow.mutate('follow')} disabled={follow.isPending}>
                    {follow.isPending ? 'Saving…' : 'Follow this flight'}
                  </button>
                )}
                {relation.data?.isFollowing ? (
                  <button type="button" className="btn" onClick={() => addLog(isPast, queryClient, flightId, isManual)}>
                    {isPast ? 'Add to logbook' : 'Save as planned trip'}
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function oldDateAsIso(old: Record<string, unknown> | null): string {
  return String((old as Record<string, unknown> | null)?.departure ?? '')
}
function newDateAsIso(newPayload: Record<string, unknown> | null): string {
  return String((newPayload as Record<string, unknown> | null)?.departure ?? '')
}

function TimeRow({ label, value, tz, airport }: { label: string; value: string; tz: string; airport?: string | null }) {
  const isToday = sameUtcDay(value, today())
  return (
    <div className="readout-row">
      <span className="readout-row__label">{label}</span>
      <span className="readout-row__value">
        {formatLocal(value, tz)}
        <span className="readout-row__meta">
          {airport ?? '?'} local{isToday ? '' : ` · ${formatDate(value, tz)}`} · {tz}
        </span>
      </span>
    </div>
  )
}

async function addLog(isPast: boolean, queryClient: ReturnType<typeof useQueryClient>, flightId: string, isManual: boolean): Promise<void> {
  await api.post('/api/v1/user-flights', {
    flightId: isManual ? undefined : flightId,
    manualFlightId: isManual ? flightId.slice(7) : undefined,
    follow: false,
    logging: { state: isPast ? 'flown' : 'planned', cabin: 'none' },
  })
  void queryClient.invalidateQueries({ queryKey: ['board'] })
  void queryClient.invalidateQueries({ queryKey: ['relation', flightId] })
  void queryClient.invalidateQueries({ queryKey: ['logbook'] })
  void queryClient.invalidateQueries({ queryKey: ['stats'] })
}

function LogEditor({
  userFlightId,
  loggedState,
  seat: initialSeat,
  cabin: initialCabin,
  note: initialNote,
  rating: initialRating,
  initialTripId,
  isFollowing,
  onUnfollow,
  onSaved,
}: {
  userFlightId: string
  loggedState: 'flown' | 'planned' | null
  seat: string
  cabin: Cabin
  note: string
  rating: number
  initialTripId: string | null
  isFollowing: boolean
  onUnfollow: () => void
  onSaved: () => void
}) {
  const [seat, setSeat] = useState(initialSeat)
  const [cabin, setCabin] = useState<Cabin>(initialCabin)
  const [note, setNote] = useState(initialNote)
  const [rating, setRating] = useState<number>(initialRating)
  const [tripId, setTripId] = useState<string | null>(initialTripId)
  const [saved, setSaved] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false); void confirmOpen
  const dialogRef = useRef<HTMLDialogElement>(null)
  const trips = useQuery({ queryKey: ['trips'], queryFn: () => api.get<{ trips: Array<{ id: string; name: string }> }>('/api/v1/trips') })

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/v1/user-flights/${userFlightId}`, {
        seat: seat === '' ? undefined : seat,
        cabin,
        note: note === '' ? undefined : note,
        rating: rating > 0 ? rating : undefined,
        tripId,
      }),
    onSuccess: () => {
      const stamp = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setSaved(`Saved ${stamp}`)
      onSaved()
    },
  })

  const markFlown = useMutation({
    mutationFn: () => api.patch(`/api/v1/user-flights/${userFlightId}`, { markFlown: true }),
    onSuccess: onSaved,
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/v1/user-flights/${userFlightId}`),
    onSuccess: onSaved,
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  return (
    <form className="data-panel" onSubmit={submit} aria-label="Personal logbook record">
      <h2 className="data-panel__title">Your logbook record {loggedState === 'planned' ? '(planned trip)' : '(flown)'}</h2>
      {loggedState === 'planned' && (
        <button type="button" className="btn" onClick={() => markFlown.mutate()} style={{ marginBottom: 'var(--space-s)' }} disabled={markFlown.isPending}>
          {markFlown.isPending ? 'Updating…' : 'Mark as flown'}
        </button>
      )}
      <div className="field">
        <label htmlFor="seat">Seat</label>
        <input id="seat" className="input" style={{ maxWidth: 120 }} value={seat} onChange={(e) => setSeat(e.target.value)} placeholder="e.g. 12A" />
      </div>
      <div className="field">
        <label htmlFor="cabin">Cabin</label>
        <select id="cabin" className="select" value={cabin} onChange={(e) => setCabin(e.target.value as Cabin)}>
          {CABIN_CLASSES.map((c) => (
            <option key={c} value={c}>
              {c === 'none' ? 'not recorded' : c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rating">Rating (0 to 5)</label>
        <input id="rating" className="input" style={{ maxWidth: 120 }} type="number" inputMode="numeric" min={0} max={5} value={rating} onChange={(e) => setRating(Number(e.target.value))} />
      </div>
      <div className="field">
        <label htmlFor="trip">Trip</label>
        <select id="trip" className="select" value={tripId ?? ''} onChange={(e) => setTripId(e.target.value || null)}>
          <option value="">No trip</option>
          {(trips.data?.trips ?? []).map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="note">Note</label>
        <textarea id="note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="actions-row" style={{ marginTop: 0 }}>
        <button type="submit" className="btn" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save record'}
        </button>
        <button type="button" className="btn-danger" onClick={() => { setConfirmOpen(true); dialogRef.current?.showModal() }}>
          Remove from logbook
        </button>
        {isFollowing && <button type="button" className="btn-outline" onClick={onUnfollow}>Unfollow flight</button>}
        {saved && <span className="form-note" role="status">{saved}</span>}
      </div>
      <dialog
        ref={dialogRef}
        onClose={() => setConfirmOpen(false)}
        style={{ border: 'var(--border-strong)', borderRadius: 'var(--radius)', padding: 'var(--space-l)' }}
      >
        <h2 style={{ fontSize: 'var(--step-1)', marginBottom: 'var(--space-s)' }}>Remove this record?</h2>
        <p className="form-note">The personal record (seat, note, rating) is permanently removed.</p>
        <div className="actions-row">
          <button type="button" className="btn-outline" onClick={() => dialogRef.current?.close()}>
            Keep it
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              remove.mutate()
              dialogRef.current?.close()
            }}
          >
            Remove record
          </button>
        </div>
      </dialog>
      {save.isError && (
        <div className="form-error" role="alert">
          Save failed: {(save.error as Error).message}
        </div>
      )}
    </form>
  )
}
