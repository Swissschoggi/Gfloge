// Track drawing: schematic great-circle route from airports plus demo
// position polyline. Stays an SVG (no tiles), reflects data condition.
import type { AirportInfo, PositionData } from '@gfloge/shared'
import { greatCircleInterp } from '@gfloge/shared'

type TrackProps = {
  departure: AirportInfo
  arrival: AirportInfo
  positions: PositionData | null
  positionsLoading: boolean
  positionsError: unknown
}

const W = 640
const H = 260
const PAD = 40

type Projector = (lat: number, lon: number) => { x: number; y: number }

/** Linear projection on the dep/arr bounding box (schematic, not map tiles). */
function makeProjector(departure: AirportInfo, arrival: AirportInfo): Projector {
  let lonA = departure.lon
  let lonB = arrival.lon
  if (Math.abs(lonB - lonA) > 180) {
    if (lonA < 0) lonA += 360
    else lonB += 360
  }
  const minLon = Math.min(lonA, lonB) - 6
  const maxLon = Math.max(lonA, lonB) + 6
  const minLat = Math.min(departure.lat, arrival.lat) - 6
  const maxLat = Math.max(departure.lat, arrival.lat) + 6
  const spanLon = Math.max(1, maxLon - minLon)
  const spanLat = Math.max(1, maxLat - minLat)
  return (lat, lon) => {
    const nLon = lon < minLon + 0 ? (lon < 0 ? lon + 360 : lon) : lon // antimeridian samples fall in the span
    const clampedLon = Math.min(maxLon, Math.max(minLon, nLon))
    const clampedLat = Math.min(maxLat, Math.max(minLat, lat))
    return {
      x: PAD + ((clampedLon - minLon) / spanLon) * (W - 2 * PAD),
      y: H - PAD - ((clampedLat - minLat) / spanLat) * (H - 2 * PAD),
    }
  }
}

export function TrackMap({ departure, arrival, positions, positionsLoading, positionsError }: TrackProps) {
  const project = makeProjector(departure, arrival)
  const refPoints: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= 24; i++) {
    const p = greatCircleInterp(departure, arrival, i / 24)
    refPoints.push(project(p.lat, p.lon))
  }
  const refPath = refPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

  const samplePoints = (positions?.points ?? []).map((p) => project(p.lat, p.lon))
  const flowPath = samplePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const last = samplePoints[samplePoints.length - 1]
  const first = refPoints[0]!
  const terminal = refPoints[refPoints.length - 1]!

  return (
    <figure className="data-panel" style={{ padding: 0 }}>
      <svg className="track" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Route schematic from departure to arrival">
        <line x1={first.x} y1={first.y} x2={terminal.x} y2={terminal.y} className="track__grid" opacity="0.35" />
        <path d={refPath} className="track__plan" />
        <circle cx={first.x} cy={first.y} r="6" className="track__node-dep" />
        <circle cx={terminal.x} cy={terminal.y} r="5" className="track__node-arr" />
        <text x={first.x} y={first.y + 24} textAnchor="middle" className="track__airport">
          {departure.iata ?? departure.icao ?? 'DEP'}
        </text>
        <text x={terminal.x} y={terminal.y + 24} textAnchor="middle" className="track__airport">
          {arrival.iata ?? arrival.icao ?? 'ARR'}
        </text>
        {samplePoints.length > 1 && <path d={flowPath} className="track__flow" />}
        {last && <circle cx={last.x} cy={last.y} r="5" className="track__plane" />}
      </svg>
      <figcaption className="attribution" style={{ padding: 'var(--space-s) var(--space-m)' }}>
        {positionsError ? (
          'Track unavailable: the feed did not answer. Route shows scheduled data only.'
        ) : positionsLoading ? (
          'Track loading.'
        ) : positions ? (
          <>
            {positions.sourceLabel}
            {positions.condition === 'stale' ? ' · stale sample' : ''}
            {positions.points.length > 0
              ? ` · last update ${positions.points[positions.points.length - 1]!.ts?.slice(11, 16)} UTC`
              : ''}
          </>
        ) : (
          'No tracking data for this flight yet.'
        )}
      </figcaption>
    </figure>
  )
}
