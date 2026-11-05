import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api } from '../api/client'

type AircraftTypeProfile = {
  type: { icaoType: string | null; iataType: string | null; manufacturer: string | null; name: string; family: string | null }
  registrations: string[]
}

export function AircraftTypePage() {
  const { icao = '' } = useParams()
  const q = useQuery<AircraftTypeProfile>({
    queryKey: ['aircraft-type', icao],
    queryFn: () => api.get<AircraftTypeProfile>(`/api/v1/aircraft-types/${encodeURIComponent(icao)}`),
  })

  if (q.isPending) return <div className="page"><p role="status">Loading aircraft type…</p></div>
  if (q.isError) return <div className="page"><h1>Aircraft type not found</h1></div>

  const data = q.data!
  return (
    <div className="page aircraft-type-page">
      <header className="pagehead">
        <p className="eyebrow">Aircraft type</p>
        <h1 className="pagehead__title">{data.type.name}</h1>
        <p className="pagehead__sub">{data.type.manufacturer ?? 'Unknown manufacturer'}{data.type.family ? ` · ${data.type.family}` : ''}</p>
      </header>
      <div className="data-panel">
        <h2 className="data-panel__title">Type details</h2>
        <div className="readout-row"><span className="readout-row__label">ICAO type</span><span className="readout-row__value">{data.type.icaoType ?? 'not recorded'}</span></div>
        <div className="readout-row"><span className="readout-row__label">IATA type</span><span className="readout-row__value">{data.type.iataType ?? 'not recorded'}</span></div>
        <div className="readout-row"><span className="readout-row__label">Manufacturer</span><span className="readout-row__value">{data.type.manufacturer ?? 'not recorded'}</span></div>
        <div className="readout-row"><span className="readout-row__label">Family</span><span className="readout-row__value">{data.type.family ?? 'not recorded'}</span></div>
      </div>
      {data.registrations.length > 0 && (
        <div className="data-panel">
          <h2 className="data-panel__title">Your aircraft of this type</h2>
          <ul className="trip-picker">
            {data.registrations.map((reg) => (
              <li key={reg}><Link to={`/aircraft/${encodeURIComponent(reg)}`}>{reg}</Link></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
