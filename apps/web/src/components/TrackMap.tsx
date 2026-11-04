import type { AirportInfo, PositionData } from '@gfloge/shared'
import { AtlasSurface, toAtlasAirport } from './FlightAtlas'

type TrackProps = {
  departure: AirportInfo
  arrival: AirportInfo
  positions: PositionData | null
  positionsLoading: boolean
  positionsError: unknown
}

export function TrackMap({ departure, arrival, positions, positionsLoading, positionsError }: TrackProps) {
  const routeId = `${departure.iata ?? departure.icao}-${arrival.iata ?? arrival.icao}`
  const track = positions?.points.map((point) => ({ lon: point.lon, lat: point.lat }))
  const lastPoint = positions?.points.at(-1)
  const footer = positionsError
    ? 'Live track unavailable · scheduled route remains visible'
    : positionsLoading
      ? 'Requesting live positions…'
      : positions
        ? `${positions.sourceLabel}${positions.condition === 'stale' ? ' · stale sample' : ''}${lastPoint?.ts ? ` · ${lastPoint.ts.slice(11, 16)} UTC` : ''}`
        : 'No live position reported · scheduled route shown'

  return (
    <AtlasSurface
        routes={[{
          id: routeId,
          from: toAtlasAirport(departure),
          to: toAtlasAirport(arrival),
          track,
          position: lastPoint ? { lon: lastPoint.lon, lat: lastPoint.lat } : undefined,
        }]}
        airports={[toAtlasAirport(departure), toAtlasAirport(arrival)]}
        selectedRouteId={routeId}
        heading="Flight route"
        footerLabel={footer}
        description={`World map with the scheduled great-circle route from ${departure.iata ?? departure.name} to ${arrival.iata ?? arrival.name}. A separate line and marker appear only for positions returned by the configured provider.`}
    />
  )
}
