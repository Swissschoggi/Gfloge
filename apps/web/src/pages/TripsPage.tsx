import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TripRead } from '@gfloge/shared'
import { api } from '../api/client'
import { formatDate } from '../format'

export function TripsPage() {
  const { tripId } = useParams()
  const queryClient = useQueryClient()
  const trips = useQuery({ queryKey: ['trips'], queryFn: () => api.get<{ trips: TripRead[] }>('/api/v1/trips') })
  const logbook = useQuery({ queryKey: ['logbook', '', ''], queryFn: () => api.get<{ flown: Array<{ id: string; flight: TripRead['flights'][number]['flight'] }>; planned: Array<{ id: string; flight: TripRead['flights'][number]['flight'] }>; manual: Array<{ id: string; flight: TripRead['flights'][number]['flight'] }> }>('/api/v1/logbook') })
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trips'] })
    void queryClient.invalidateQueries({ queryKey: ['logbook'] })
  }
  const create = useMutation({ mutationFn: (v: { name: string; description?: string; startDate?: string; endDate?: string }) => api.post<{ trip: TripRead }>('/api/v1/trips', v), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/api/v1/trips/${id}`), onSuccess: invalidate })
  const attach = useMutation({ mutationFn: ({ trip, userFlight }: { trip: string; userFlight: string }) => api.put(`/api/v1/trips/${trip}/flights/${userFlight}`), onSuccess: invalidate })
  const detach = useMutation({ mutationFn: ({ trip, userFlight }: { trip: string; userFlight: string }) => api.delete(`/api/v1/trips/${trip}/flights/${userFlight}`), onSuccess: invalidate })
  const updateTrip = useMutation({ mutationFn: (v: { id: string; name: string; description: string; startDate: string | null; endDate: string | null }) => api.patch(`/api/v1/trips/${v.id}`, v), onSuccess: invalidate })
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

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) { setError('Enter a trip name.'); return }
    try {
      await create.mutateAsync({ name, description, startDate: startDate ? new Date(`${startDate}T00:00:00Z`).toISOString() : undefined, endDate: endDate ? new Date(`${endDate}T23:59:00Z`).toISOString() : undefined })
      setName(''); setDescription(''); setStartDate(''); setEndDate('')
    } catch (e) { setError((e as Error).message) }
  }

  const selected = trips.data?.trips.find((t) => t.id === tripId)
  useEffect(() => {
    if (!selected) return
    setEditName(selected.name)
    setEditDescription(selected.description ?? '')
    setEditStart(selected.startDate?.slice(0, 10) ?? '')
    setEditEnd(selected.endDate?.slice(0, 10) ?? '')
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (trips.isPending || logbook.isPending) return <div className="data-panel"><p>Loading trips…</p></div>
  if (trips.isError || logbook.isError) return <div role="alert" className="form-error">Trips could not be loaded. <button className="quietlink" onClick={() => { void trips.refetch(); void logbook.refetch() }}>Retry</button></div>
  if (tripId && !selected) return <div className="page"><h1>Trip not found</h1><Link to="/trips">Back to trips</Link></div>

  return (
    <div className="page">
      <div style={{display:'flex', alignItems:'center', gap:'var(--space-s)', flexWrap:'wrap'}}>
        {selected && <Link to="/trips" className="btn-outline">All trips</Link>}
        <h1 style={{fontSize:'var(--step-2)', margin:0}}>{selected?.name ?? 'Trips'}</h1>
      </div>
      {selected ? (
        <>
          <form className="data-panel" onSubmit={(e) => { e.preventDefault(); updateTrip.mutate({ id: selected.id, name: editName, description: editDescription, startDate: editStart ? new Date(`${editStart}T00:00:00Z`).toISOString() : null, endDate: editEnd ? new Date(`${editEnd}T23:59:00Z`).toISOString() : null }) }}>
            <h2 className="data-panel__title">Trip details</h2>
            <div className="field"><label htmlFor="trip-edit-name">Trip name</label><input id="trip-edit-name" className="input" required maxLength={120} value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
            <div className="field"><label htmlFor="trip-edit-description">Description</label><textarea id="trip-edit-description" className="textarea" maxLength={2000} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} /></div>
            <div className="field-pair"><div className="field"><label htmlFor="trip-edit-start">Start date</label><input id="trip-edit-start" className="input" type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} /></div><div className="field"><label htmlFor="trip-edit-end">End date</label><input id="trip-edit-end" className="input" type="date" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} /></div></div>
            <p className="attribution">{selected.flights.length} flight{selected.flights.length === 1 ? '' : 's'} in this itinerary.</p>
            <button className="btn-outline" type="submit" disabled={updateTrip.isPending}>Save trip details</button>
          </form>
          <section className="board-group">
            <h2 className="board-group__title">Itinerary</h2>
            {selected.flights.length ? <ol className="trip-itinerary">{selected.flights.map((item) => <li key={item.id} className="data-panel"><Link to={`/flight/${item.flight.id}`} className="board-flightcode">{item.flight.flightCode}</Link><span className="board-route"> {item.flight.departure.iata} → {item.flight.arrival.iata}</span><span className="attribution">{formatDate(item.flight.scheduledDeparture, item.flight.departure.tz)} · {item.flight.departure.tz}</span><button type="button" className="btn-outline" onClick={() => detach.mutate({trip: selected.id, userFlight: item.id})}>Remove from trip</button></li>)}</ol> : <p className="form-note">No flights in this trip yet. Add one below from your logbook.</p>}
          </section>
          <div className="data-panel">
            <h2 className="data-panel__title">Add a flight from your logbook</h2>
            <ul className="trip-picker">{[...logbook.data.flown, ...logbook.data.planned, ...logbook.data.manual].filter((entry) => !selected.flights.some((f) => f.id === entry.id)).map((entry) => <li key={entry.id}><span><strong>{entry.flight.flightCode}</strong> · {entry.flight.departure.iata} → {entry.flight.arrival.iata}</span><button className="btn-outline" type="button" onClick={() => attach.mutate({trip: selected.id, userFlight: entry.id})}>Add to trip</button></li>)}</ul>
          </div>
          <button type="button" className="btn-danger" onClick={() => deleteDialog.current?.showModal()}>Delete trip</button>
          <dialog ref={deleteDialog} aria-labelledby="delete-trip-title" className="confirm-dialog">
            <h2 id="delete-trip-title">Delete trip “{selected.name}”?</h2>
            <p>Flights stay in your logbook. Only this itinerary grouping is removed.</p>
            <div className="actions-row"><button type="button" className="btn-outline" onClick={() => deleteDialog.current?.close()}>Keep trip</button><button type="button" className="btn-danger" disabled={remove.isPending} onClick={() => { remove.mutate(selected.id); deleteDialog.current?.close() }}>Delete trip</button></div>
          </dialog>
        </>
      ) : (
        <>
          <form className="data-panel" onSubmit={(e) => void submit(e)}>
            <h2 className="data-panel__title">Create a trip</h2>
            <div className="field"><label htmlFor="trip-name">Trip name</label><input id="trip-name" className="input" required maxLength={120} value={name} onChange={(e)=>setName(e.target.value)} placeholder="Lisbon weekend" /></div>
            <div className="field"><label htmlFor="trip-description">Description</label><textarea id="trip-description" className="textarea" maxLength={2000} value={description} onChange={(e)=>setDescription(e.target.value)} /></div>
            <div className="field-pair"><div className="field"><label htmlFor="trip-start">Start date (optional)</label><input id="trip-start" type="date" className="input" value={startDate} onChange={(e)=>setStartDate(e.target.value)} /></div><div className="field"><label htmlFor="trip-end">End date (optional)</label><input id="trip-end" type="date" className="input" value={endDate} onChange={(e)=>setEndDate(e.target.value)} /></div></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn" type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create trip'}</button>
          </form>
          <section className="board-group"><h2 className="board-group__title">Your trips</h2>{trips.data.trips.length ? <ul className="trip-list">{trips.data.trips.map((trip) => <li key={trip.id}><Link to={`/trips/${trip.id}`} className="menuitem"><span><strong>{trip.name}</strong><small>{trip.flights.length} flights · {trip.startDate ? formatDate(trip.startDate, 'UTC') : 'dates flexible'}</small></span><span className="menuitem__chevron">›</span></Link></li>)}</ul> : <p className="form-note">No trips yet. Create a trip and group your flights into an itinerary.</p>}</section>
        </>
      )}
    </div>
  )
}
