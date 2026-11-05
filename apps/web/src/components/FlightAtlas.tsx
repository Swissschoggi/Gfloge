/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import type { AirportInfo, AirportSearchResult, BoardPayload } from '@gfloge/shared'
import { api } from '../api/client'
import { geoInterpolate } from 'd3-geo'

type BoardItem = BoardPayload['active'][number]

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
  code?: string | null
  from: AtlasAirport
  to: AtlasAirport
  track?: Array<{ lon: number; lat: number }>
  position?: { lon: number; lat: number }
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

export function useWorldAtlas() {
  return { data: null, isError: false, isPending: false, refetch: () => {} }
}

function greatCircleCoords(from: AtlasAirport, to: AtlasAirport, steps = 64): [number, number][] {
  const interp = geoInterpolate([from.lon, from.lat], [to.lon, to.lat])
  const out: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const p = interp(i / steps)
    out.push([p[1], p[0]])
  }
  return out
}

export function FlightAtlas({ items, selected, onSelectFlight }: { items: BoardItem[]; selected: BoardItem | null; onSelectFlight?: (id: string | null) => void }) {
  const routes: AtlasRoute[] = items.map((item) => ({
    id: item.userFlightId,
    code: item.flight.flightCode,
    from: toAtlasAirport(item.flight.departure),
    to: toAtlasAirport(item.flight.arrival),
  }))
  const airports = Array.from(new Map(routes.flatMap((r) => [r.from, r.to]).map((a) => [a.id, a])).values())
  return (
    <AtlasSurface
      routes={routes}
      airports={airports}
      selectedRouteId={selected?.userFlightId ?? null}
      onSelectRoute={onSelectFlight}
      heading="Flight atlas"
      countLabel={`${items.length} ${items.length === 1 ? 'route' : 'routes'}`}
      footerLabel="© OpenStreetMap contributors"
      description="Interactive geographic map with flight routes and airports."
    />
  )
}

export function AtlasSurface({
  routes,
  airports,
  selectedRouteId = null,
  featuredAirportId = null,
  onSelectRoute,
  heading = 'Map',
  countLabel,
  footerLabel = '© OpenStreetMap contributors',
  description,
  initialCenter,
  initialZoom,
}: {
  routes: AtlasRoute[]
  airports: AtlasAirport[]
  selectedRouteId?: string | null
  featuredAirportId?: string | null
  onSelectRoute?: (id: string | null) => void
  heading?: string
  countLabel?: string
  footerLabel?: string
  description?: string
  initialCenter?: [number, number]
  initialZoom?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const leafletRef = useRef<any>(null)
  const layersRef = useRef<any>({ routes: [], airports: [] })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AirportSearchResult[]>([])
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let map: any
    import('leaflet').then((mod) => {
      if (cancelled || !containerRef.current) return
      const L = (mod as any).default || mod
      leafletRef.current = L
      map = L.map(containerRef.current).setView(initialCenter ? [initialCenter[0], initialCenter[1]] : [20, 0], initialZoom ?? 2)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map)
      mapRef.current = map
      ;(window as any).__gfMap = map
      setMapReady(true)
    })
    return () => {
      cancelled = true
      if (map) map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    layersRef.current.routes.forEach((l: any) => map.removeLayer(l))
    layersRef.current.airports.forEach((l: any) => map.removeLayer(l))
    layersRef.current.routes = []
    layersRef.current.airports = []

    routes.forEach((route) => {
      const coords = route.track?.length ? route.track.map((p) => [p.lat, p.lon]) : greatCircleCoords(route.from, route.to)
      const selected = route.id === selectedRouteId
      const L = leafletRef.current
      if (!L) return
      const poly = L.polyline(coords, { color: selected ? '#ffffff' : '#2563eb', weight: selected ? 3 : 1.5, opacity: selected ? 1 : 0.7 }).addTo(map)
      poly.on('click', () => { if (onSelectRoute) onSelectRoute(route.id) })
      layersRef.current.routes.push(poly)
    })

    airports.forEach((a) => {
      const L = leafletRef.current
      if (!L) return
      const marker = L.circleMarker([a.lat, a.lon], { radius: a.id === featuredAirportId ? 8 : 5, color: '#1e40af', fillColor: '#ffffff', fillOpacity: 1, weight: 2 }).addTo(map)
      if (a.code) marker.bindTooltip(a.code)
      layersRef.current.airports.push(marker)
    })
  }, [routes, airports, selectedRouteId, featuredAirportId, onSelectRoute, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const route = routes.find((r) => r.id === selectedRouteId)
    if (route) {
      const mid = geoInterpolate([route.from.lon, route.from.lat], [route.to.lon, route.to.lat])(0.5)
      map.flyTo([mid[1], mid[0]], Math.max(map.getZoom(), 3))
    }
  }, [selectedRouteId, routes, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !featuredAirportId) return
    const airport = airports.find((a) => a.id === featuredAirportId)
    if (airport) map.flyTo([airport.lat, airport.lon], Math.max(map.getZoom(), 10))
  }, [featuredAirportId, airports, mapReady])

  useEffect(() => {
    if (searchQuery.trim().length < 2) { setSearchResults([]); return }
    let cancelled = false
    api.get<{ results: AirportSearchResult[] }>(`/api/v1/airports?q=${encodeURIComponent(searchQuery)}`)
      .then((r) => { if (!cancelled) setSearchResults((r.results ?? []).filter((a) => a.lat !== null && a.lon !== null).slice(0, 6)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [searchQuery])

  function resetView() {
    mapRef.current?.setView([20, 0], 2)
    if (onSelectRoute) onSelectRoute(null)
  }

  void description

  return (
    <section className="atlas-panel" aria-label="Geographic flight atlas">
      <div className="atlas-panel__topline">
        <div>
          <span className="atlas-panel__kicker">{heading}</span>
          <span className="atlas-panel__scale">Interactive map</span>
        </div>
        <span className="atlas-panel__route-count">{countLabel ?? `${routes.length} ${routes.length === 1 ? 'route' : 'routes'}`}</span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 300 }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 1000, display: 'flex', gap: 8 }}>
          <input
            className="input"
            placeholder="Search airport…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 200 }}
          />
          {searchResults.length > 0 && (
            <ul className="combobox-list" style={{ position: 'absolute', top: 40, left: 0, width: 260, zIndex: 1001 }}>
              {searchResults.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => {
                    mapRef.current?.setView([a.lat as number, a.lon as number], 10)
                    setSearchQuery('')
                    setSearchResults([])
                  }}>
                    <span>{a.iata ?? a.icao ?? '—'}</span>
                    <span>{a.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 1000 }}>
          <button className="btn-outline" type="button" onClick={resetView}>Reset view</button>
        </div>
      </div>
      <div className="atlas-panel__footer">
        <span className="atlas-panel__source">{footerLabel}</span>
        <span className="atlas-panel__hint">Drag to pan · scroll to zoom</span>
      </div>
    </section>
  )
}
