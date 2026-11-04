import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { api } from '../api/client'

type PreviewRow = {
  rowIndex: number
  flightNumber: string | null
  airline: string | null
  departure: string | null
  arrival: string | null
  departureTime: string | null
  arrivalTime: string | null
  aircraft: string | null
  registration: string | null
  seat: string | null
  cabin: string | null
}

type PreviewResponse = {
  fileName: string | null
  format: string
  headers: string[]
  totalRows: number
  errors: string[]
  preview: PreviewRow[]
}

type CommitResponse = {
  batchId: string
  totalRows: number
  imported: number
  enriched: number
  skipped: number
  failed: number
  failures: Array<{ row: number; reason: string }>
}

export function ImportPage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [format, setFormat] = useState('generic')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const previewMutation = useMutation({
    mutationFn: async (payload: { content: string; format: string; fileName: string }) => {
      return api.post<PreviewResponse>('/api/v1/import/preview', payload)
    },
  })

  const commitMutation = useMutation({
    mutationFn: async (payload: { content: string; format: string; fileName: string }) => {
      return api.post<CommitResponse>('/api/v1/import/commit', payload)
    },
  })

  async function handleFile(selected: File) {
    setFile(selected)
    setError(null)
    setPreview(null)
    setCommitResult(null)
    if (selected.size > 5 * 1024 * 1024) {
      setError('File exceeds 5 MB. Split the archive or remove unused rows.')
      return
    }
    const text = await selected.text()
    setContent(text)
    try {
      const response = await previewMutation.mutateAsync({ content: text, format, fileName: selected.name })
      setPreview(response)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not parse this file.')
    }
  }

  // Re-preview when format changes (file content is already loaded)
  useEffect(() => {
    if (!content || !file) return
    setError(null)
    previewMutation.mutateAsync({ content, format, fileName: file.name })
      .then((response) => setPreview(response))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not parse this file.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format])

  async function handleCommit() {
    if (!content || !file) return
    setError(null)
    try {
      const response = await commitMutation.mutateAsync({ content, format, fileName: file.name })
      setCommitResult(response)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed.')
    }
  }

  function reset() {
    setFile(null)
    setContent(null)
    setPreview(null)
    setCommitResult(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="page import-page">

      <header className="pagehead">
        <div>
          <p className="eyebrow">Personal archive / migration</p>
          <h1 className="pagehead__title">Import flight history</h1>
          <p className="pagehead__sub">Migrate flights from another tracker without losing provenance.</p>
        </div>
        <div className="pagehead__actions">
          <Link to="/logbook" className="btn-outline">Back to logbook</Link>
        </div>
      </header>

      {commitResult ? (
        <section className="import-result">
          <h2>Import complete</h2>
          <div className="import-result__stats">
            <span><strong>{commitResult.imported}</strong> imported</span>
            <span><strong>{commitResult.enriched}</strong> enriched</span>
            <span><strong>{commitResult.skipped}</strong> skipped as duplicates</span>
            <span><strong>{commitResult.failed}</strong> failed</span>
          </div>
          {commitResult.failures.length > 0 && (
            <details className="import-failures">
              <summary>{commitResult.failures.length} rows could not be imported</summary>
              <ul>
                {commitResult.failures.map((failure) => (
                  <li key={failure.row}>Row {failure.row}: {failure.reason}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="actions-row">
            <button type="button" className="btn" onClick={() => navigate('/logbook')}>Open logbook</button>
            <button type="button" className="btn-outline" onClick={reset}>Import another file</button>
          </div>
        </section>
      ) : (
        <>
          <section
            className={`import-dropzone${dragging ? ' import-dropzone--active' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              const dropped = event.dataTransfer.files[0]
              if (dropped) void handleFile(dropped)
            }}
          >
            <p className="eyebrow">Step 1 · Select file</p>
            <h2>Drop a CSV, TXT or ICS file here</h2>
            <p>Or choose a file from your device. Maximum 5 MB.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.ics,text/csv,text/plain,text/calendar"
              onChange={(event) => {
                const selected = event.target.files?.[0]
                if (selected) void handleFile(selected)
              }}
              className="import-file-input"
            />
            <button type="button" className="btn-outline" onClick={() => fileInputRef.current?.click()}>
              Browse files
            </button>
            {file && <p className="form-note">Selected: {file.name} ({Math.round(file.size / 1024)} KB)</p>}
          </section>

          <section className="import-options">
            <div className="field">
              <label htmlFor="import-format">Source format</label>
              <select id="import-format" className="select" value={format} onChange={(event) => setFormat(event.target.value)}>
                <option value="generic">Generic CSV</option>
                <option value="flighty">Flighty CSV</option>
                <option value="openflights">OpenFlights CSV</option>
                <option value="ics">ICS (TripIt calendar)</option>
              </select>
            </div>
          </section>

          {previewMutation.isPending && <p role="status" className="form-note">Parsing file…</p>}

          {error && <p role="alert" className="form-error">{error}</p>}

          {preview && (
            <section className="import-preview">
              <header className="import-preview__header">
                <div>
                  <p className="eyebrow">Step 2 · Inspect</p>
                  <h2>{preview.totalRows} rows found</h2>
                  <p className="form-note">{preview.preview.length} shown in preview. {preview.errors.length} issue{preview.errors.length === 1 ? '' : 's'}.</p>
                </div>
              </header>
              {preview.errors.length > 0 && (
                <details className="import-preview__errors">
                  <summary>{preview.errors.length} parsing issue{preview.errors.length === 1 ? '' : 's'}</summary>
                  <ul>
                    {preview.errors.map((issue, index) => <li key={index}>{issue}</li>)}
                  </ul>
                </details>
              )}
              <div className="import-preview__table-wrap">
                <table className="logtable">
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Flight</th>
                      <th scope="col">Route</th>
                      <th scope="col">Departure</th>
                      <th scope="col">Arrival</th>
                      <th scope="col">Aircraft / Reg</th>
                      <th scope="col">Seat / Cabin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((row) => (
                      <tr key={row.rowIndex}>
                        <td className="mono">{row.rowIndex}</td>
                        <td className="mono">{row.flightNumber ?? '—'}{row.airline ? <span className="import-preview__secondary">{row.airline}</span> : null}</td>
                        <td className="mono">{row.departure ?? '—'} → {row.arrival ?? '—'}</td>
                        <td className="mono">{row.departureTime ?? '—'}</td>
                        <td className="mono">{row.arrivalTime ?? '—'}</td>
                        <td>{row.aircraft ?? '—'}{row.registration ? <span className="import-preview__secondary">{row.registration}</span> : null}</td>
                        <td>{row.seat ?? '—'}{row.cabin ? <span className="import-preview__secondary">{row.cabin}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="actions-row">
                <button type="button" className="btn" onClick={() => void handleCommit()} disabled={commitMutation.isPending}>
                  {commitMutation.isPending ? 'Importing…' : `Import ${preview.totalRows} flight${preview.totalRows === 1 ? '' : 's'}`}
                </button>
                <button type="button" className="btn-outline" onClick={reset}>Cancel</button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}