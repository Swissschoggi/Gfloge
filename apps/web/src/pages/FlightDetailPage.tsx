import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CABIN_CLASSES, type AlertsPayload, type Cabin, type FlightRead, type PositionData } from '@gfloge/shared'
import { api } from '../api/client'
import { formatDate, formatDistance, formatDuration, formatLocal, sameUtcDay } from '../format'
import { ConditionChip, StatusBadge } from '../components/StatusPresentation'
import { TrackMap } from '../components/TrackMap'
import { FlightProgress } from '../components/FlightProgress'
import { diagnoseFlight } from '@gfloge/shared'
import { ActivityFeed } from '../components/ActivityFeed'
import { exportFlightCardPng } from '../lib/exportImage'

const today = () => new Date().toISOString()

export function FlightDetailPage() {
  const { flightId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const createShare = useMutation({
    mutationFn: (userFlightId: string) => api.post<{ token: string; url: string }>('/api/v1/share/flights', { userFlightId }),
    onSuccess: (data) => setShareToken(data.token),
    onError: (cause) => setShareError(cause instanceof Error ? cause.message : 'Could not create share link'),
  })
  const isManual = flightId.startsWith('manual:')
  const manualId = isManual ? flightId.slice(7) : null
  const [editing, setEditing] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const updateFlight = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch<{ flight: FlightRead }>(`/api/v1/manual-flights/${manualId}`, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['flight', flightId] })
      setEditing(false)
      setEditError(null)
    },
    onError: (cause) => setEditError(cause instanceof Error ? cause.message : 'Could not save changes'),
  })

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
        <div className="page flight-detail-page">
          <h1>Flight not found</h1>
          <p className="page__meta">There is no flight at this address that you can view.</p>
          <Link to="/" className="btn" style={{ marginTop: 'var(--space-s)' }}>
            Back to the Board
          </Link>
        </div>
      )
    }
    return (
      <div className="page flight-detail-page">
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
      <div className="page flight-detail-page">
        <div className="data-panel">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      </div>
    )
  }

  const f = flight.data!
  const isHistoricalObservation = f.providerId === 'mrairspace'
  const isPast = (f.actualArrival ?? f.scheduledArrival) < today() && f.status !== 'scheduled' && f.status !== 'boarding'
  const condition = f.isManual ? ('unavailable' as const) : positions.error ? ('unavailable' as const) : (positions.data?.condition ?? 'fresh')

  return (
    <article className="page flight-detail-page">
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        ← Back
      </button>
      <header className="hero flight-detail-hero">
        <div className="hero__meta">
          <FlightProgress status={f.status} departure={f.actualDeparture ?? f.scheduledDeparture} arrival={f.actualArrival ?? f.scheduledArrival} />
          <span className="airline-mark">{f.airline?.iata ?? 'SEL'}</span>
          <span className="hero__airline">{f.airline?.name ?? 'Self-entered flight'}</span>
          <StatusBadge status={f.status} />
          <ConditionChip condition={condition} timestamp={positions.data?.fetchedAt ?? null} />
          {relation.data?.loggedState === 'planned' && <span className="relation-chip">Planned</span>}
        </div>
        <h1 className="hero__code">{f.flightCode}</h1>
        <div className="hero__route flight-detail-route">
          <div className="hero__end">
            <span className="hero__iata">{f.departure.iata ?? f.departure.icao}</span>
            <span className="hero__city">{f.departure.city}</span>
          </div>
          <span className="hero__arrow" aria-hidden="true">
            <svg viewBox="0 0 120 12" preserveAspectRatio="none"><path d="M0 6h112M106 1l8 5-8 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {f.distanceKm !== null && <span className="hero__distance">{formatDistance(f.distanceKm)}</span>}
          </span>
          <div className="hero__end hero__end--arr">
            <span className="hero__iata">{f.arrival.iata ?? f.arrival.icao}</span>
            <span className="hero__city">{f.arrival.city}</span>
          </div>
        </div>
        <p className="hero__sub">{f.departure.name} to {f.arrival.name}</p>
      </header>

      <div className="dossier flight-detail-layout">
        <div className="dossier__map flight-detail-map">
          <TrackMap departure={f.departure} arrival={f.arrival} positions={positions.data ?? null} positionsLoading={positions.isLoading} positionsError={positions.error} />
          <p className="attribution" style={{ marginTop: 'var(--space-s)' }}>
            {f.isDemo
              ? 'Data source: Gfloge demo dataset (fabricated for testing, not real aviation data).'
              : isHistoricalObservation
                ? 'Historical observation · MrAirspace / adsblol initiative · ODbL. Recorded times are historical observations, not a future schedule.'
                : f.isManual
                  ? 'Self-entered record: schedule data is your input; no provider tracking until configured.'
                : `Data source: ${f.providerId ?? 'unconfigured'} · demo: ${String(f.isDemo)}`}
          </p>
        </div>

        <aside className="dossier__info flight-detail-facts" aria-label="Flight details and actions">
           {isManual && (
             <div className="actions-row" style={{ marginBottom: 'var(--space-s)' }}>
               <button type="button" className="btn" onClick={() => setEditing((v) => !v)}>
                 {editing ? 'Close editor' : 'Edit flight'}
               </button>
             </div>
           )}
           {f.fieldSources && Object.keys(f.fieldSources).length > 0 && (
             <div className="data-panel">
               <h2 className="data-panel__title">Corrected fields</h2>
               <p className="form-note" style={{ margin: 0 }}>You overrode provider data for: {Object.keys(f.fieldSources).join(', ')}.</p>
             </div>
           )}
          {(alerts.data?.alerts ?? []).map((a) => (
            <div className="alertbanner" role="alert" key={a.id}>
              <strong>Update:</strong>
              <span>
                {a.type === 'time_shift'
                  ? `Departure moved to ${formatLocal(newDateAsIso(a.new), f.departure.tz)} ${(f.departure.iata ?? f.departure.icao)} local (was ${formatLocal(
                      oldDateAsIso(a.old),
                      f.departure.tz
                    )})`
                  : `Status change: ${a.type.replace('_', ' ')}`}
              </span>
            </div>
          ))}

          <div className="data-panel">
            <h2 className="data-panel__title">Flight operations</h2>
            <TimeRow label={isHistoricalObservation ? 'Observed departure' : 'Scheduled departure'} value={f.scheduledDeparture} tz={f.departure.tz} airport={f.departure.iata ?? f.departure.icao} />
            {f.actualDeparture && <TimeRow label="Actual departure" value={f.actualDeparture} tz={f.departure.tz} airport={f.departure.iata ?? f.departure.icao} />}
            {f.actualDeparture && (() => {
              const delay = Math.round((new Date(f.actualDeparture).getTime() - new Date(f.scheduledDeparture).getTime()) / 60000)
              return delay !== 0 ? <div className="readout-row"><span className="readout-row__label">Departure delay</span><span className="readout-row__value">{delay > 0 ? `+${delay} min` : `${delay} min`}</span></div> : null
            })()}
            <TimeRow label={isHistoricalObservation ? 'Observed arrival' : 'Scheduled arrival'} value={f.scheduledArrival} tz={f.arrival.tz} airport={f.arrival.iata ?? f.arrival.icao} />
            {f.actualArrival && <TimeRow label="Actual arrival" value={f.actualArrival} tz={f.arrival.tz} airport={f.arrival.iata ?? f.arrival.icao} />}
            {f.actualArrival && (() => {
              const delay = Math.round((new Date(f.actualArrival).getTime() - new Date(f.scheduledArrival).getTime()) / 60000)
              return delay !== 0 ? <div className="readout-row"><span className="readout-row__label">Arrival delay</span><span className="readout-row__value">{delay > 0 ? `+${delay} min` : `${delay} min`}</span></div> : null
            })()}
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
            {(f.depTerminal || f.depGate || f.arrTerminal || f.arrGate) && (
              <div className="readout-row">
                <span className="readout-row__label">Terminals / gates</span>
                <span className="readout-row__value">{[f.depTerminal, f.depGate].filter(Boolean).join(' / ') || 'not recorded'} → {[f.arrTerminal, f.arrGate].filter(Boolean).join(' / ') || 'not recorded'}</span>
              </div>
            )}
          </div>

          {(f.aircraft && (f.aircraft.registration || f.aircraft.icaoType)) || f.seatType || f.bookingReference || f.flightReason || f.sourceName || f.cancelled || f.divertedTo || f.depTerminal || f.depGate || f.arrTerminal || f.arrGate ? (
            <>
              {f.aircraft && (f.aircraft.registration || f.aircraft.icaoType) && (
                <div className="data-panel">
                  <h2 className="data-panel__title">Aircraft</h2>
                  <div className="readout-row">
                    <span className="readout-row__label">Registration</span>
                    <span className="readout-row__value">{f.aircraft.registration ? <Link to={`/aircraft/${encodeURIComponent(f.aircraft.registration)}`}>{f.aircraft.registration}</Link> : 'not recorded'}</span>
                  </div>
                  <div className="readout-row">
                    <span className="readout-row__label">Type</span>
                    <span className="readout-row__value">
                      {f.aircraft.icaoType ?? '?'} {f.aircraft.typeName ? `· ${f.aircraft.typeName}` : ''}
                    </span>
                  </div>
                </div>
              )}
              {(f.seatType || f.bookingReference || f.flightReason || f.sourceName || f.cancelled || f.divertedTo) && (
                <div className="data-panel">
                  <h2 className="data-panel__title">Your experience</h2>
                  {f.seatType && <div className="readout-row"><span className="readout-row__label">Seat type</span><span className="readout-row__value">{f.seatType}</span></div>}
                  {f.bookingReference && <div className="readout-row"><span className="readout-row__label">Booking reference</span><span className="readout-row__value">{f.bookingReference}</span></div>}
                  {f.flightReason && <div className="readout-row"><span className="readout-row__label">Reason</span><span className="readout-row__value">{f.flightReason}</span></div>}
                  {f.cancelled && <div className="readout-row"><span className="readout-row__label">Status</span><span className="readout-row__value">Cancelled</span></div>}
                  {f.divertedTo && <div className="readout-row"><span className="readout-row__label">Diverted to</span><span className="readout-row__value">{f.divertedTo}</span></div>}
                  {f.sourceName && <div className="readout-row"><span className="readout-row__label">Source</span><span className="readout-row__value">{f.sourceName}{f.sourceType ? ` · ${f.sourceType}` : ''}</span></div>}
                  {f.sourceMetadata && Object.keys(f.sourceMetadata).length > 0 && (
                    <details className="readout-row">
                      <summary className="readout-row__label">Additional source fields</summary>
                      <div className="readout-row__value">
                        {Object.entries(f.sourceMetadata).map(([key, value]) => (
                          <div key={key}>{key}: {value}</div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </>
          ) : null}

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
        </aside>
      </div>
      {isManual && editing && (
        <section className="data-panel" style={{ marginTop: 'var(--space-m)' }}>
          <h2 className="data-panel__title">Edit flight</h2>
          <ManualEditForm flight={f} onSave={(payload) => updateFlight.mutate(payload)} saving={updateFlight.isPending} error={editError} />
        </section>
      )}
      {relation.data && (
        <section className="data-panel" style={{ marginTop: 'var(--space-m)' }}>
          <h2 className="data-panel__title">Sharing</h2>
          <p className="form-note" style={{ marginBottom: 'var(--space-s)' }}>Create a read-only public link for this flight.</p>
          <button type="button" className="btn-outline" disabled={createShare.isPending} onClick={() => { if (relation.data) createShare.mutate(relation.data.id) }}>
            {createShare.isPending ? 'Creating…' : 'Create share link'}
          </button>
          {shareToken && <p className="form-note" role="status">Share URL: /share/flight/{shareToken}</p>}
          <button type="button" className="btn-outline" style={{ marginTop: 'var(--space-2xs)' }} onClick={() => exportFlightCardPng({
            flightCode: f.flightCode,
            airlineName: f.airline?.name ?? null,
            depCode: (f.departure.iata ?? f.departure.icao) ?? '',
            arrCode: (f.arrival.iata ?? f.arrival.icao) ?? '',
            departureTime: formatLocal(f.actualDeparture ?? f.scheduledDeparture, f.departure.tz),
            arrivalTime: formatLocal(f.actualArrival ?? f.scheduledArrival, f.arrival.tz),
            duration: formatDuration(Math.round((new Date(f.actualArrival ?? f.scheduledArrival).getTime() - new Date(f.actualDeparture ?? f.scheduledDeparture).getTime()) / 60000)),
            status: f.status,
          })}>Export PNG</button>
          {shareError && <p role="alert" className="form-error">{shareError}</p>}
        </section>
      )}
      {(() => {
        const diagnostics = diagnoseFlight(f)
        if (diagnostics.length === 0) return null
        return (
          <section className="data-panel" style={{ marginTop: 'var(--space-m)' }}>
            <h2 className="data-panel__title">Data quality</h2>
            <ul>{diagnostics.map((d) => <li key={d.code} className={d.severity === 'error' ? 'form-error' : 'form-note'}>{d.message}</li>)}</ul>
          </section>
        )
      })()}
      <section className="data-panel" style={{ marginTop: 'var(--space-m)' }}>
        <h2 className="data-panel__title">Activity history</h2>
        <ActivityFeed flightId={flightId} />
      </section>
    </article>
  )
}

function oldDateAsIso(old: Record<string, unknown> | null): string {
  return String((old as Record<string, unknown> | null)?.departure ?? '')
}
function newDateAsIso(newPayload: Record<string, unknown> | null): string {
  return String((newPayload as Record<string, unknown> | null)?.departure ?? '')
}

function TimeRow({ label, value, tz, airport }: { label: string; value: string; tz: string | null; airport?: string | null }) {
  const isToday = sameUtcDay(value, today())
  return (
    <div className="readout-row">
      <span className="readout-row__label">{label}</span>
      <span className="readout-row__value">
        {formatLocal(value, tz)}
        <span className="readout-row__meta">
          {airport ?? '?'} local{isToday ? '' : ` · ${formatDate(value, tz)}`} · {tz ?? 'tz unknown'}
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

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ManualEditForm({ flight, onSave, saving, error }: { flight: FlightRead; onSave: (payload: Record<string, unknown>) => void; saving: boolean; error: string | null }) {
  const [flightNumber, setFlightNumber] = useState(flight.flightCode === 'Recorded flight' ? '' : flight.flightCode)
  const [depCode, setDepCode] = useState(flight.departure?.iata ?? flight.departure?.icao ?? '')
  const [arrCode, setArrCode] = useState(flight.arrival?.iata ?? flight.arrival?.icao ?? '')
  const [depLocal, setDepLocal] = useState(toLocalInput(flight.scheduledDeparture))
  const [arrLocal, setArrLocal] = useState(toLocalInput(flight.scheduledArrival))
  const [depTerminal, setDepTerminal] = useState(flight.depTerminal ?? '')
  const [depGate, setDepGate] = useState(flight.depGate ?? '')
  const [arrTerminal, setArrTerminal] = useState(flight.arrTerminal ?? '')
  const [arrGate, setArrGate] = useState(flight.arrGate ?? '')
  const [arrBaggage, setArrBaggage] = useState(flight.arrBaggage ?? '')
  const [aircraftType, setAircraftType] = useState(flight.aircraft?.icaoType ?? '')
  const [registration, setRegistration] = useState(flight.aircraft?.registration ?? '')
  const [seat, setSeat] = useState(flight.seat ?? '')
  const [seatType, setSeatType] = useState(flight.seatType ?? '')
  const [cabin, setCabin] = useState('none')
  const [bookingReference, setBookingReference] = useState(flight.bookingReference ?? '')
  const [flightReason, setFlightReason] = useState(flight.flightReason ?? '')
  const [note, setNote] = useState('')
  const [rating, setRating] = useState('')
  const [cancelled, setCancelled] = useState(false)
  const [divertedTo, setDivertedTo] = useState('')
  const [sGateDep, setSGateDep] = useState(toLocalInput(flight.scheduledGateDeparture))
  const [aGateDep, setAGateDep] = useState(toLocalInput(flight.actualGateDeparture))
  const [sTakeoff, setSTakeoff] = useState(toLocalInput(flight.scheduledTakeoff))
  const [aTakeoff, setATakeoff] = useState(toLocalInput(flight.actualTakeoff))
  const [sLanding, setSLanding] = useState(toLocalInput(flight.scheduledLanding))
  const [aLanding, setALanding] = useState(toLocalInput(flight.actualLanding))
  const [sGateArr, setSGateArr] = useState(toLocalInput(flight.scheduledGateArrival))
  const [aGateArr, setAGateArr] = useState(toLocalInput(flight.actualGateArrival))

  function toIso(local: string): string | null {
    if (!local) return null
    const d = new Date(local)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const payload: Record<string, unknown> = {}
    if (flightNumber) payload.flightNumber = flightNumber
    if (depCode) payload.departureIata = depCode
    if (arrCode) payload.arrivalIata = arrCode
    if (depLocal) payload.departureLocal = depLocal
    if (arrLocal) payload.arrivalLocal = arrLocal
    payload.depTerminal = depTerminal || null
    payload.depGate = depGate || null
    payload.arrTerminal = arrTerminal || null
    payload.arrGate = arrGate || null
    payload.arrBaggage = arrBaggage || null
    if (aircraftType) payload.aircraftIcaoType = aircraftType
    payload.aircraftRegistration = registration || null
    payload.seat = seat || null
    payload.seatType = seatType || null
    payload.cabin = cabin
    payload.bookingReference = bookingReference || null
    payload.flightReason = flightReason || null
    payload.note = note || null
    if (rating) payload.rating = Number(rating)
    payload.cancelled = cancelled
    if (divertedTo) payload.divertedTo = divertedTo
    if (sGateDep) payload.scheduledGateDeparture = toIso(sGateDep)
    if (aGateDep) payload.actualGateDeparture = toIso(aGateDep)
    if (sTakeoff) payload.scheduledTakeoff = toIso(sTakeoff)
    if (aTakeoff) payload.actualTakeoff = toIso(aTakeoff)
    if (sLanding) payload.scheduledLanding = toIso(sLanding)
    if (aLanding) payload.actualLanding = toIso(aLanding)
    if (sGateArr) payload.scheduledGateArrival = toIso(sGateArr)
    if (aGateArr) payload.actualGateArrival = toIso(aGateArr)
    onSave(payload)
  }

  return (
    <form className="manual-flight-form" onSubmit={onSubmit}>
      {error && <p className="form-error" role="alert">{error}</p>}
      <details open>
        <summary>Flight information</summary>
        <div className="manual-flight-fields">
          <div className="field"><span>Flight number</span><input className="input" value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} /></div>
          <div className="field"><span>Departure (IATA)</span><input className="input" value={depCode} onChange={(e) => setDepCode(e.target.value.toUpperCase())} maxLength={4} /></div>
          <div className="field"><span>Arrival (IATA)</span><input className="input" value={arrCode} onChange={(e) => setArrCode(e.target.value.toUpperCase())} maxLength={4} /></div>
          <div className="field"><span>Departure (local)</span><input className="input" type="datetime-local" value={depLocal} onChange={(e) => setDepLocal(e.target.value)} /></div>
          <div className="field"><span>Arrival (local)</span><input className="input" type="datetime-local" value={arrLocal} onChange={(e) => setArrLocal(e.target.value)} /></div>
        </div>
      </details>
      <details>
        <summary>Timing and airport details</summary>
        <div className="manual-flight-fields">
          <div className="field"><span>Dep terminal</span><input className="input" value={depTerminal} onChange={(e) => setDepTerminal(e.target.value)} /></div>
          <div className="field"><span>Dep gate</span><input className="input" value={depGate} onChange={(e) => setDepGate(e.target.value)} /></div>
          <div className="field"><span>Arr terminal</span><input className="input" value={arrTerminal} onChange={(e) => setArrTerminal(e.target.value)} /></div>
          <div className="field"><span>Arr gate</span><input className="input" value={arrGate} onChange={(e) => setArrGate(e.target.value)} /></div>
          <div className="field"><span>Baggage belt</span><input className="input" value={arrBaggage} onChange={(e) => setArrBaggage(e.target.value)} /></div>
        </div>
        <div className="manual-flight-fields">
          <div className="field"><span>Sched gate dep</span><input className="input" type="datetime-local" value={sGateDep} onChange={(e) => setSGateDep(e.target.value)} /></div>
          <div className="field"><span>Actual gate dep</span><input className="input" type="datetime-local" value={aGateDep} onChange={(e) => setAGateDep(e.target.value)} /></div>
          <div className="field"><span>Sched takeoff</span><input className="input" type="datetime-local" value={sTakeoff} onChange={(e) => setSTakeoff(e.target.value)} /></div>
          <div className="field"><span>Actual takeoff</span><input className="input" type="datetime-local" value={aTakeoff} onChange={(e) => setATakeoff(e.target.value)} /></div>
          <div className="field"><span>Sched landing</span><input className="input" type="datetime-local" value={sLanding} onChange={(e) => setSLanding(e.target.value)} /></div>
          <div className="field"><span>Actual landing</span><input className="input" type="datetime-local" value={aLanding} onChange={(e) => setALanding(e.target.value)} /></div>
          <div className="field"><span>Sched gate arr</span><input className="input" type="datetime-local" value={sGateArr} onChange={(e) => setSGateArr(e.target.value)} /></div>
          <div className="field"><span>Actual gate arr</span><input className="input" type="datetime-local" value={aGateArr} onChange={(e) => setAGateArr(e.target.value)} /></div>
        </div>
      </details>
      <details>
        <summary>Aircraft</summary>
        <div className="manual-flight-fields">
          <div className="field"><span>Aircraft type (ICAO)</span><input className="input" value={aircraftType} onChange={(e) => setAircraftType(e.target.value.toUpperCase())} /></div>
          <div className="field"><span>Registration</span><input className="input" value={registration} onChange={(e) => setRegistration(e.target.value.toUpperCase())} /></div>
        </div>
      </details>
      <details>
        <summary>Booking and seating</summary>
        <div className="manual-flight-fields">
          <div className="field"><span>Seat</span><input className="input" value={seat} onChange={(e) => setSeat(e.target.value)} /></div>
          <div className="field"><span>Seat type</span><input className="input" value={seatType} onChange={(e) => setSeatType(e.target.value)} placeholder="window/aisle" /></div>
          <div className="field"><span>Cabin</span>
            <select className="input" value={cabin} onChange={(e) => setCabin(e.target.value)}>
              <option value="none">None</option>
              <option value="eco">Economy</option>
              <option value="premium">Premium economy</option>
              <option value="business">Business</option>
              <option value="first">First</option>
            </select>
          </div>
          <div className="field"><span>Booking reference (PNR)</span><input className="input" value={bookingReference} onChange={(e) => setBookingReference(e.target.value)} /></div>
        </div>
      </details>
      <details>
        <summary>Personal notes</summary>
        <div className="manual-flight-fields">
          <div className="field"><span>Flight reason</span><input className="input" value={flightReason} onChange={(e) => setFlightReason(e.target.value)} /></div>
          <div className="field"><span>Notes</span><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="field"><span>Rating (1-5)</span><input className="input" type="number" min={1} max={5} value={rating} onChange={(e) => setRating(e.target.value)} /></div>
          <div className="field"><label><input type="checkbox" checked={cancelled} onChange={(e) => setCancelled(e.target.checked)} /> Cancelled</label></div>
          <div className="field"><span>Diverted to (IATA)</span><input className="input" value={divertedTo} onChange={(e) => setDivertedTo(e.target.value.toUpperCase())} /></div>
        </div>
      </details>
      <div className="actions-row" style={{ marginTop: 'var(--space-s)' }}>
        <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  )
}
