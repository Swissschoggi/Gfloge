import { useMemo, useRef, useState } from 'react'
import type { WheelEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  geoCentroid,
  geoGraticule,
  geoInterpolate,
  geoNaturalEarth1,
  geoPath,
} from 'd3-geo'
import type { FeatureCollection, Geometry, Point } from 'geojson'
import type { AirportInfo, AirportSearchResult, BoardPayload } from '@gfloge/shared'

type BoardItem = BoardPayload['active'][number]
type CountryProperties = { name: string; continent: string; labelRank: number }
type PlaceProperties = { name: string; scaleRank: number; labelRank: number; country: string; capital: boolean }
type WorldData = {
  countries: FeatureCollection<Geometry, CountryProperties>
  places: FeatureCollection<Point, PlaceProperties>
}
type View = { scale: number; x: number; y: number }

export type AtlasAirport = {
  id: string
  code: string | null
  name: string
  city: string
  lon: number
  lat: number
}

export type AtlasRoute = {
  id: string
  from: AtlasAirport
  to: AtlasAirport
  track?: Array<{ lon: number; lat: number }>
  position?: { lon: number; lat: number }
}

const WIDTH = 1200
const HEIGHT = 700
const INITIAL_VIEW: View = { scale: 1, x: 0, y: 0 }

async function readGzipJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('The bundled map file could not be loaded.')
  if (!response.body) throw new Error('The bundled map file could not be loaded.')
  const alreadyDecoded = response.headers.get('content-encoding') === 'gzip'
  if (alreadyDecoded) {
    return response.json() as Promise<T>
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot open the bundled map data.')
  }
  const body = response.body.pipeThrough(new DecompressionStream('gzip'))
  return new Response(body).json() as Promise<T>
}

async function loadWorld(signal: AbortSignal): Promise<WorldData> {
  const [countries, places] = await Promise.all([
    readGzipJson<WorldData['countries']>('/geo/ne-50m-countries.geojson.gz', signal),
    readGzipJson<WorldData['places']>('/geo/ne-50m-places.geojson.gz', signal),
  ])
  return { countries, places }
}

export function useWorldAtlas() {
  return useQuery({
    queryKey: ['world-atlas', 'natural-earth-50m'],
    queryFn: ({ signal }) => loadWorld(signal),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  })
}

export function toAtlasAirport(airport: AirportInfo | (AirportSearchResult & { lat: number; lon: number })): AtlasAirport {
  const code = airport.iata ?? airport.icao
  return {
    id: `${code ?? airport.name}:${airport.lat.toFixed(4)}:${airport.lon.toFixed(4)}`,
    code,
    name: airport.name,
    city: airport.city ?? '',
    lon: airport.lon,
    lat: airport.lat,
  }
}

export function FlightAtlas({ items, selected }: { items: BoardItem[]; selected: BoardItem | null }) {
  const { routes, airports } = useMemo(() => {
    const byId = new Map<string, AtlasAirport>()
    const routes = items.map((item) => {
      const from = toAtlasAirport(item.flight.departure)
      const to = toAtlasAirport(item.flight.arrival)
      byId.set(from.id, from)
      byId.set(to.id, to)
      return { id: item.userFlightId, from, to }
    })
    return { routes, airports: [...byId.values()] }
  }, [items])

  return (
    <AtlasSurface
      routes={routes}
      airports={airports}
      selectedRouteId={selected?.userFlightId ?? null}
      heading="World overview"
      countLabel={`${items.length} ${items.length === 1 ? 'route' : 'routes'}`}
      footerLabel="Airport positions from Gfloge reference data"
      description="Select a flight in the manifest to emphasize its great-circle route and origin and destination airports."
    />
  )
}

export function AtlasSurface({
  routes,
  airports,
  selectedRouteId = null,
  featuredAirportId = null,
  heading = 'World overview',
  countLabel,
  footerLabel = 'Made with Natural Earth · public-domain geography',
  description = 'Pan and zoom the geographic map. Airport coordinates and great-circle routes are taken from the selected records.',
}: {
  routes: AtlasRoute[]
  airports: AtlasAirport[]
  selectedRouteId?: string | null
  featuredAirportId?: string | null
  heading?: string
  countLabel?: string
  footerLabel?: string
  description?: string
}) {
  const world = useWorldAtlas()
  const [view, setView] = useState(INITIAL_VIEW)
  const [dragging, setDragging] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null)
  const projection = useMemo(() => {
    if (!world.data) return null
    return geoNaturalEarth1().fitExtent([[16, 20], [WIDTH - 16, HEIGHT - 20]], world.data.countries)
  }, [world.data])
  const path = useMemo(() => projection ? geoPath(projection) : null, [projection])
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? null

  const worldCountries = useMemo(() => {
    if (!world.data || !path || !projection) return null
    return world.data.countries.features.map((feature, index) => {
      const centroid = geoCentroid(feature)
      return {
        key: `${feature.properties.name}-${index}`,
        name: feature.properties.name,
        labelRank: Number(feature.properties.labelRank),
        path: path(feature) ?? undefined,
        point: projection(centroid),
      }
    })
  }, [path, projection, world.data])

  const graticulePath = useMemo(() => {
    if (!path) return null
    return path(geoGraticule().step(view.scale > 2 ? [15, 15] : [30, 30])())
  }, [path, view.scale])

  const visiblePlaces = useMemo(() => {
    if (!world.data || !projection) return []
    const maxRank = view.scale < 1.25 ? 0 : view.scale < 1.8 ? 1 : 2
    return world.data.places.features.flatMap((place) => {
      if (place.properties.scaleRank > maxRank) return []
      const coordinates = place.geometry.coordinates
      if (coordinates.length < 2) return []
      const point = projection([coordinates[0]!, coordinates[1]!])
      if (!point) return []
      const x = view.x + view.scale * point[0]
      const y = view.y + view.scale * point[1]
      if (x < -20 || x > WIDTH + 20 || y < -20 || y > HEIGHT + 20) return []
      return [{ place, x: point[0], y: point[1] }]
    })
  }, [projection, view.scale, view.x, view.y, world.data])

  const routePaths = useMemo(() => {
    if (!path) return []
    return routes.map((route) => {
      const coordinates = [[route.from.lon, route.from.lat], [route.to.lon, route.to.lat]]
      return {
        id: route.id,
        selected: route.id === selectedRouteId,
        d: path({ type: 'LineString', coordinates }) ?? undefined,
        trackD: route.track?.length && route.track.length > 1
          ? path({ type: 'LineString', coordinates: route.track.map((point) => [point.lon, point.lat]) }) ?? undefined
          : undefined,
        position: route.position ? projection?.([route.position.lon, route.position.lat]) : null,
      }
    })
  }, [path, projection, routes, selectedRouteId])

  const airportPoints = useMemo(() => {
    if (!projection) return []
    const roles = new Map<string, 'origin' | 'destination' | 'featured'>()
    if (selectedRoute) {
      roles.set(selectedRoute.from.id, 'origin')
      roles.set(selectedRoute.to.id, 'destination')
    }
    if (featuredAirportId && !roles.has(featuredAirportId)) roles.set(featuredAirportId, 'featured')
    return airports.flatMap((airport) => {
      const point = projection([airport.lon, airport.lat])
      return point ? [{ airport, role: roles.get(airport.id) ?? null, x: point[0], y: point[1] }] : []
    })
  }, [airports, featuredAirportId, projection, selectedRoute])

  function clampView(next: View): View {
    const scale = Math.min(8, Math.max(1, next.scale))
    return {
      scale,
      x: Math.min(0, Math.max(WIDTH * (1 - scale), next.x)),
      y: Math.min(0, Math.max(HEIGHT * (1 - scale), next.y)),
    }
  }

  function svgPoint(clientX: number, clientY: number): [number, number] {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return [WIDTH / 2, HEIGHT / 2]
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const local = point.matrixTransform(matrix.inverse())
    return [local.x, local.y]
  }

  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    const [px, py] = clientX !== undefined && clientY !== undefined ? svgPoint(clientX, clientY) : [WIDTH / 2, HEIGHT / 2]
    setView((current) => {
      const scale = Math.min(8, Math.max(1, current.scale * factor))
      const ratio = scale / current.scale
      return clampView({ scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio })
    })
  }

  function pan(dx: number, dy: number) {
    setView((current) => clampView({ ...current, x: current.x + dx, y: current.y + dy }))
  }

  function centerRoute() {
    if (!selectedRoute || !projection) return
    const midpoint = geoInterpolate(
      [selectedRoute.from.lon, selectedRoute.from.lat],
      [selectedRoute.to.lon, selectedRoute.to.lat]
    )(0.5)
    const point = projection(midpoint)
    if (!point) return
    const scale = 2.25
    setView(clampView({ scale, x: WIDTH / 2 - point[0] * scale, y: HEIGHT / 2 - point[1] * scale }))
  }

  function onWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault()
    zoomAt(event.deltaY < 0 ? 1.18 : 1 / 1.18, event.clientX, event.clientY)
  }

  return (
    <section className="atlas-panel" aria-label="Geographic flight atlas">
      <div className="atlas-panel__topline">
        <div>
          <span className="atlas-panel__kicker">{heading}</span>
          <span className="atlas-panel__scale">World map · 1:50m</span>
        </div>
        <span className="atlas-panel__route-count">{countLabel ?? `${routes.length} ${routes.length === 1 ? 'route' : 'routes'}`}</span>
      </div>

      <div className="atlas-canvas">
        {world.data && projection && path && worldCountries ? (
          <svg
            ref={svgRef}
            className="atlas-canvas__svg"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-labelledby="atlas-title atlas-description"
            onWheel={onWheel}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              const [x, y] = svgPoint(event.clientX, event.clientY)
              dragRef.current = { x, y, viewX: view.x, viewY: view.y }
              setDragging(true)
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const start = dragRef.current
              if (!start) return
              const [x, y] = svgPoint(event.clientX, event.clientY)
              const dx = x - start.x
              const dy = y - start.y
              setView((current) => clampView({ ...current, x: start.viewX + dx, y: start.viewY + dy }))
            }}
            onPointerUp={() => { dragRef.current = null; setDragging(false) }}
            onPointerCancel={() => { dragRef.current = null; setDragging(false) }}
            data-dragging={dragging ? 'true' : undefined}
          >
            <title id="atlas-title">Flight route map</title>
            <desc id="atlas-description">{description}</desc>
            <defs>
              <clipPath id="atlas-viewport"><rect width={WIDTH} height={HEIGHT} /></clipPath>
            </defs>
            <rect width={WIDTH} height={HEIGHT} className="atlas-canvas__ocean" />
            <g clipPath="url(#atlas-viewport)" transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
              {graticulePath && <path d={graticulePath} className="atlas-graticule" />}
              {worldCountries.map((country) => country.path && (
                <path key={country.key} d={country.path} className="atlas-country" />
              ))}
              {worldCountries.map((country) => {
                const rankLimit = view.scale < 1.35 ? 2 : view.scale < 2.1 ? 4 : 6
                if (country.labelRank > rankLimit || !country.point) return null
                return (
                  <text
                    key={`label-${country.key}`}
                    x={country.point[0]}
                    y={country.point[1]}
                    className="atlas-country-label"
                    style={{ fontSize: `${10 / view.scale}px` }}
                  >
                    {country.name}
                  </text>
                )
              })}
              {visiblePlaces.map(({ place, x, y }) => (
                <g key={`place-${place.properties.name}-${place.properties.country}`} className="atlas-place-label" style={{ fontSize: `${9.5 / view.scale}px` }}>
                  <circle cx={x} cy={y} r={1.7 / view.scale} />
                  <text x={x + 4 / view.scale} y={y - 3 / view.scale}>{place.properties.name}</text>
                </g>
              ))}
              {routePaths.map((route) => route.d && (
                <g key={route.id}>
                  <path d={route.d} className={`atlas-route${route.selected ? ' atlas-route--selected' : ''}`} vectorEffect="non-scaling-stroke" />
                  {route.trackD && <path d={route.trackD} className="atlas-route--track" vectorEffect="non-scaling-stroke" />}
                  {route.position && (
                    <g className="atlas-live-position" transform={`translate(${route.position[0]} ${route.position[1]})`}>
                      <circle r={8 / view.scale} vectorEffect="non-scaling-stroke" />
                      <path d={`M${-5 / view.scale},0 H${5 / view.scale} M0,${-5 / view.scale} V${5 / view.scale}`} vectorEffect="non-scaling-stroke" />
                    </g>
                  )}
                </g>
              ))}
              {airportPoints.map(({ airport, role, x, y }) => (
                <g key={airport.id}>
                  {role === 'origin' ? (
                    <circle cx={x} cy={y} r={7 / view.scale} className="atlas-airport atlas-airport--origin" vectorEffect="non-scaling-stroke" />
                  ) : role === 'destination' ? (
                    <path d={`M${x},${y - 6 / view.scale} L${x + 6 / view.scale},${y} L${x},${y + 6 / view.scale} L${x - 6 / view.scale},${y} Z`} className="atlas-airport atlas-airport--destination" vectorEffect="non-scaling-stroke" />
                  ) : role === 'featured' ? (
                    <circle cx={x} cy={y} r={6 / view.scale} className="atlas-airport atlas-airport--featured" vectorEffect="non-scaling-stroke" />
                  ) : (
                    <circle cx={x} cy={y} r={2.8 / view.scale} className="atlas-airport atlas-airport--context" vectorEffect="non-scaling-stroke" />
                  )}
                  {(role || view.scale > 1.4) && airport.code && (
                    <text x={x + 8 / view.scale} y={y + 4 / view.scale} className="atlas-airport-label" style={{ fontSize: `${11 / view.scale}px` }}>
                      {airport.code}
                    </text>
                  )}
                </g>
              ))}
            </g>
          </svg>
        ) : world.isError ? (
          <div className="atlas-state" role="alert">
            <p>The local map data could not be loaded.</p>
            <button className="btn-outline" type="button" onClick={() => void world.refetch()}>Retry map</button>
          </div>
        ) : (
          <div className="atlas-state" aria-busy="true">
            <p>Loading local geographic data…</p>
          </div>
        )}

        <div className="atlas-controls" role="group" aria-label="Map controls">
          <button type="button" onClick={() => zoomAt(1.35)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => zoomAt(1 / 1.35)} aria-label="Zoom out">−</button>
          <span className="atlas-controls__rule" />
          <button type="button" onClick={() => pan(0, -80)} aria-label="Pan map north">↑</button>
          <div>
            <button type="button" onClick={() => pan(80, 0)} aria-label="Pan map west">←</button>
            <button type="button" onClick={() => setView(INITIAL_VIEW)} aria-label="Reset map view">⌂</button>
            <button type="button" onClick={() => pan(-80, 0)} aria-label="Pan map east">→</button>
          </div>
          <button type="button" onClick={() => pan(0, 80)} aria-label="Pan map south">↓</button>
          {selectedRoute && <button className="atlas-controls__center" type="button" onClick={centerRoute}>Center selected</button>}
        </div>
      </div>

      <div className="atlas-panel__footer">
        {selectedRouteId ? (
          <>
            <span><i className="atlas-legend__route" aria-hidden="true" /> Selected route</span>
            {routes.some((route) => route.track?.length) && <span><i className="atlas-legend__track" aria-hidden="true" /> Tracked path</span>}
            <span><i className="atlas-legend__origin" aria-hidden="true" /> Departure</span>
            <span><i className="atlas-legend__destination" aria-hidden="true" /> Arrival</span>
          </>
        ) : null}
        <span className="atlas-panel__source">{footerLabel}</span>
        <span className="atlas-panel__hint">Drag to pan · scroll or use controls to zoom</span>
      </div>
    </section>
  )
}
