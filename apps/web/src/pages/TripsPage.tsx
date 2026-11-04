import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TripRead } from '@gfloge/shared'
import { api } from '../api/client'
import { formatDate, formatLocal } from '../format'
import { IconChevron } from '../components/icons'

type TripLogbook = {
  flown: Array<{ id: string; flight: TripRead['flights'][number]['flight'] }>
  planned: Array<{ id: string; flight: TripRead['flights'][number]['flight'] }>
  manual: Array<{ id: string; flight: TripRead['flights'][number]['flight'] }>
}

export function TripsPage() {
  const { tripId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const trips = useQuery({ queryKey: ['trips'], queryFn: () => api.get<{ trips: TripRead[] }>('/api/v1/trips') })
  const logbook = useQuery({ queryKey: ['logbook', '', ''], queryFn: () => api.get<TripLogbook>('/api/v1/logbook') })
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trips'] })
    void queryClient.invalidateQueries({ queryKey: ['logbook'] })
  }
  const create = useMutation({ mutationFn: (value: { name: string; description?: string; startDate?: string; endDate?: string }) => api.post<{ trip: TripRead }>('/api/v1/trips', value), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/api/v1/trips/${id}`), onSuccess: () => { invalidate(); navigate('/trips', { replace: true }) } })
  const attach = useMutation({ mutationFn: ({ trip, userFlight }: { trip: string; userFlight: string }) => api.put(`/api/v1/trips/${trip}/flights/${userFlight}`), onSuccess: invalidate })
  const detach = useMutation({ mutationFn: ({ trip, userFlight }: { trip: string; userFlight: string }) => api.delete(`/api/v1/trips/${trip}/flights/${userFlight}`), onSuccess: invalidate })
  const updateTrip = useMutation({ mutationFn: (value: { id: string; name: string; description: string; startDate: string | null; endDate: string | null }) => api.patch(`/api/v1/trips/${value.id}`, value), onSuccess: invalidate })
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const selected = trips.data?.trips.find((trip) => trip.id === tripId)

  useEffect(() => {
    if (!selected) return
    setEditName(selected.name)
    setEditDescription(selected.description ?? '')
    setEditStart(selected.startDate?.slice(0, 10) ?? '')
    setEditEnd(selected.endDate?.slice(0, 10) ?? '')
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!name.trim()) { setError('Enter a trip name.'); return }
    try {
      await create.mutateAsync({
        name: name.trim(),
        description,
        startDate: startDate ? new Date(`${startDate}T00:00:00Z`).toISOString() : undefined,
        endDate: endDate ? new Date(`${endDate}T23:59:00Z`).toISOString() : undefined,
      })
      setName('')
      setDescription('')
      setStartDate('')
      setEndDate('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the trip.')
    }
  }

  if (trips.isPending || logbook.isPending) return <div className="page trips-page" aria-busy="true"><p role="status">Loading your itineraries…</p></div>
  if (trips.isError || logbook.isError) {
    return (
      <div className="page trips-page">
        <h1>Itineraries</h1>
        <p role="alert" className="form-error">Trips could not be loaded. Check your connection and retry.</p>
        <button className="btn-outline" type="button" onClick={() => { void trips.refetch(); void logbook.refetch() }}>Retry</button>
      </div>
    )
  }
  if (tripId && !selected) {
    return <div className="page trips-page"><h1>Trip not found</h1><p className="form-note">This itinerary may have been deleted.</p><Link to="/trips" className="btn-outline">Back to itineraries</Link></div>
  }

  const availableFlights = [...logbook.data.flown, ...logbook.data.planned, ...logbook.data.manual]

  return (
    <div className="page trips-page">
      {tripId && <button type="button" className="back-link" onClick={() => navigate(-1)}>← Back</button>}
      <header className="trips-heading">
        <div>
          <p className="eyebrow">Personal planning / itinerary groups</p>
          <h1>{selected?.name ?? 'Trips'}</h1>
          <p>{selected ? `${selected.flights.length} ${selected.flights.length === 1 ? 'flight' : 'flights'} in this itinerary` : 'Group saved flights into journeys without changing your logbook.'}</p>
        </div>
        {selected && <Link className="btn-outline" to="/trips">All trips <IconChevron size={16} /></Link>}
      </header>

      <div className="trips-workspace">
        <aside className="trips-index" aria-labelledby="trip-index-title">
          <header><h2 id="trip-index-title">Itinerary index</h2><span>{trips.data.trips.length}</span></header>
          {trips.data.trips.length ? (
            <ul>
              {trips.data.trips.map((trip) => (
                <li key={trip.id}>
                  <Link to={`/trips/${trip.id}`} aria-current={selected?.id === trip.id ? 'page' : undefined}>
                    <strong>{trip.name}</strong>
                    <small>{trip.flights.length} flights · {trip.startDate ? formatDate(trip.startDate, 'UTC') : 'Dates flexible'}</small>
                    <IconChevron size={16} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="trips-index__empty">No itinerary groups yet.</p>}
        </aside>

        <section className="trip-stage" aria-label={selected ? `${selected.name} itinerary` : 'Create itinerary'}>
          {selected ? (
            <>
              <form className="trip-edit-form" onSubmit={(event) => {
                event.preventDefault()
                updateTrip.mutate({
                  id: selected.id,
                  name: editName,
                  description: editDescription,
                  startDate: editStart ? new Date(`${editStart}T00:00:00Z`).toISOString() : null,
                  endDate: editEnd ? new Date(`${editEnd}T23:59:00Z`).toISOString() : null,
                })
              }}>
                <div className="trip-form-heading"><h2>Itinerary details</h2><button className="btn-outline" type="submit" disabled={updateTrip.isPending}>{updateTrip.isPending ? 'Saving…' : 'Save details'}</button></div>
                <div className="trip-edit-form__fields">
                  <div className="field"><label htmlFor="trip-edit-name">Trip name</label><input id="trip-edit-name" className="input" required maxLength={120} value={editName} onChange={(event) => setEditName(event.target.value)} /></div>
                  <div className="field"><label htmlFor="trip-edit-description">Description</label><textarea id="trip-edit-description" className="textarea" maxLength={2000} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></div>
                  <div className="field-pair">
                    <div className="field"><label htmlFor="trip-edit-start">Start date</label><input id="trip-edit-start" className="input" type="date" value={editStart} onChange={(event) => setEditStart(event.target.value)} /></div>
                    <div className="field"><label htmlFor="trip-edit-end">End date</label><input id="trip-edit-end" className="input" type="date" value={editEnd} onChange={(event) => setEditEnd(event.target.value)} /></div>
                  </div>
                </div>
                {updateTrip.isError && <p role="alert" className="form-error">Could not save itinerary details. Your edits are still here.</p>}
              </form>

              <section className="trip-itinerary-section" aria-labelledby="trip-itinerary-title">
                <header className="trip-form-heading"><h2 id="trip-itinerary-title">Flight sequence</h2><span>{selected.flights.length} legs</span></header>
                {selected.flights.length ? (
                  <ol className="trip-itinerary">
                    {selected.flights.map((item, index) => (
                      <li key={item.id}>
                        <span className="trip-itinerary__number">{String(index + 1).padStart(2, '0')}</span>
                        <Link to={`/flight/${item.flight.id}`} className="trip-itinerary__route">
                          <strong>{item.flight.departure.iata} <span>→</span> {item.flight.arrival.iata}</strong>
                          <small>{item.flight.flightCode} · {formatDate(item.flight.scheduledDeparture, item.flight.departure.tz)}</small>
                        </Link>
                        <time>{formatLocal(item.flight.scheduledDeparture, item.flight.departure.tz)}</time>
                        <button type="button" className="btn-quiet-danger" disabled={detach.isPending} onClick={() => detach.mutate({ trip: selected.id, userFlight: item.id })} aria-label={`Remove ${item.flight.flightCode} from ${selected.name}`}>Remove</button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="trip-itinerary__empty">This itinerary has no flights yet. Add a saved flight from your logbook below.</p>
                )}
                {detach.isError && <p role="alert" className="form-error">Could not remove that flight from the itinerary. It remains in your logbook.</p>}
              </section>

              <section className="trip-attach" aria-labelledby="trip-attach-title">
                <header className="trip-form-heading"><h2 id="trip-attach-title">Add from logbook</h2><span>{availableFlights.filter((entry) => !selected.flights.some((flight) => flight.id === entry.id)).length} available</span></header>
                <ul className="trip-picker">
                  {availableFlights.filter((entry) => !selected.flights.some((flight) => flight.id === entry.id)).map((entry) => (
                    <li key={entry.id}>
                      <span><strong>{entry.flight.flightCode}</strong><small>{entry.flight.departure.iata} → {entry.flight.arrival.iata} · {formatDate(entry.flight.scheduledDeparture, entry.flight.departure.tz)}</small></span>
                      <button className="btn-outline" type="button" disabled={attach.isPending} onClick={() => attach.mutate({ trip: selected.id, userFlight: entry.id })}>Add to trip</button>
                    </li>
                  ))}
                </ul>
                {availableFlights.length === selected.flights.length && <p className="form-note">Every saved flight is already in this trip.</p>}
                {attach.isError && <p role="alert" className="form-error">Could not add that flight. It remains in your logbook.</p>}
              </section>

              <div className="trip-danger-zone">
                <p>Deleting this group will not remove any flight from your logbook.</p>
                <button type="button" className="btn-danger" onClick={() => deleteDialog.current?.showModal()}>Delete itinerary</button>
              </div>
              <dialog ref={deleteDialog} aria-labelledby="delete-trip-title" className="confirm-dialog">
                <h2 id="delete-trip-title">Delete “{selected.name}”?</h2>
                <p>The itinerary group will be removed. Its flights and personal logbook details stay intact.</p>
                <div className="actions-row"><button type="button" className="btn-outline" onClick={() => deleteDialog.current?.close()}>Keep itinerary</button><button type="button" className="btn-danger" disabled={remove.isPending} onClick={() => { remove.mutate(selected.id); deleteDialog.current?.close() }}>Delete itinerary</button></div>
              </dialog>
            </>
          ) : (
            <>
              <section className="trip-stage-intro">
                <p className="eyebrow">Build a journey</p>
                <h2>Keep related flights together.</h2>
                <p>An itinerary is only a grouping. Add flown or planned logbook entries to it, and your flight records stay unchanged.</p>
              </section>
              <form className="trip-create-form" onSubmit={(event) => void submit(event)}>
                <div className="trip-form-heading"><h2>New itinerary</h2></div>
                <div className="field"><label htmlFor="trip-name">Trip name</label><input id="trip-name" className="input" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="A name you’ll recognize" /></div>
                <div className="field"><label htmlFor="trip-description">Description <span className="form-note">Optional</span></label><textarea id="trip-description" className="textarea" maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
                <div className="field-pair">
                  <div className="field"><label htmlFor="trip-start">Start date <span className="form-note">Optional</span></label><input id="trip-start" type="date" className="input" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
                  <div className="field"><label htmlFor="trip-end">End date <span className="form-note">Optional</span></label><input id="trip-end" type="date" className="input" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
                </div>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="btn" type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create itinerary'}</button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
