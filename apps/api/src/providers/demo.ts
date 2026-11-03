// Demo provider: the milestone's functioning data source. Everything it
// produces is derived exclusively from the demo dataset and timestamped as
// demo data; it never mixes with real provider feeds.
import { greatCircleInterp, type DataCondition, type FlightStatus, type RoutePoint } from '@gfloge/shared'

const FRESH_WINDOW_MIN = 5

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export type DemoTrackContext = {
  dep: { lat: number; lon: number }
  arr: { lat: number; lon: number }
  scheduledDeparture: Date
  scheduledArrival: Date
  actualDeparture: Date | null
  actualArrival: Date | null
  status: FlightStatus
  airframeStaleMin?: number
}

export type PositionResult = {
  condition: DataCondition
  sampledAt: Date
  points: RoutePoint[]
}

/**
 * Deterministic demo track: samples along the great circle between
 * departure and arrival with a climb, cruise, descent profile. While a demo
 * flight is en route the sample window ends at "now" (or the injected stale
 * age from the dataset).
 */
export function demoTrack(ctx: DemoTrackContext, now: Date): PositionResult {
  const dep = ctx.actualDeparture ?? ctx.scheduledDeparture
  const arr = ctx.actualArrival ?? ctx.scheduledArrival
  const totalMs = Math.max(60_000, arr.getTime() - dep.getTime())
  const isFlying = !ctx.actualArrival && ctx.status === 'enroute'
  const endAt = isFlying ? now.getTime() : Math.min(arr.getTime(), now.getTime())
  const elapsed = clamp(endAt - dep.getTime(), 0, totalMs)

  const points: RoutePoint[] = []
  const stepMs = Math.max(30_000, Math.floor(totalMs / 140))
  for (let t = 0; t <= elapsed; t += stepMs) {
    const f = t / totalMs
    const pos = greatCircleInterp(ctx.dep, ctx.arr, f)
    const altFt =
      f < 0.12 ? Math.round(clamp(f / 0.12, 0, 1) * 37_000) : f > 0.85 ? Math.round(clamp((1 - f) / 0.15, 0, 1) * 37_000) : 37_000
    points.push({
      lat: Math.round(pos.lat * 1000) / 1000,
      lon: Math.round(pos.lon * 1000) / 1000,
      altFt: ctx.status === 'cancelled' ? null : altFt,
      ts: new Date(dep.getTime() + t).toISOString(),
    })
  }

  const stale = isFlying && (ctx.airframeStaleMin ?? 0) > FRESH_WINDOW_MIN
  const sampledAt = isFlying ? new Date(now.getTime() - (ctx.airframeStaleMin ?? 0) * 60_000) : new Date(endAt)
  return {
    condition: stale ? 'stale' : 'fresh',
    sampledAt,
    points,
  }
}
