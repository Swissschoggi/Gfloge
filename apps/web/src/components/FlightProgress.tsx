import { useEffect, useState } from 'react'

type Props = { status: string; departure: string; arrival: string; compact?: boolean }

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'arriving'
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0) return `${h}h ${m}m left`
  return `${m}m left`
}

export function FlightProgress({ status, departure, arrival, compact }: Props) {
  const dep = parse(departure)
  const arr = parse(arrival)
  const [now, setNow] = useState(() => Date.now())
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (status !== 'enroute' && status !== 'boarding') return
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [status])

  if (dep === null || arr === null || arr <= dep) {
    const pct = status === 'arrived' ? 100 : 0
    return (
      <div className={`flight-progress${compact ? ' flight-progress--compact' : ''}`} aria-label={`Flight progress ${pct}%`}>
        <div className="flight-progress__track"><div className="flight-progress__fill" style={{ width: `${pct}%` }} /></div>
      </div>
    )
  }

  const total = arr - dep
  const elapsed = Math.min(Math.max(now - dep, 0), total)
  const pct = Math.round((elapsed / total) * 100)
  const remaining = arr - now
  const showPlane = status === 'enroute' || status === 'boarding'

  return (
    <div className={`flight-progress${compact ? ' flight-progress--compact' : ''}`} aria-label={`Flight progress ${pct}%`}>
      <div className="flight-progress__track">
        <div className="flight-progress__fill" style={{ width: `${pct}%`, transition: reduced ? 'none' : undefined }} />
        {showPlane && pct > 0 && pct < 100 && (
          <span className="flight-progress__plane" style={{ left: `${pct}%` }} aria-hidden="true">✈</span>
        )}
      </div>
      {showPlane && remaining > 0 && (
        <span className="flight-progress__remaining">{formatRemaining(remaining)}</span>
      )}
    </div>
  )
}