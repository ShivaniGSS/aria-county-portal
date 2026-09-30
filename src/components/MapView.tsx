import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { SignProperties, WaypointProperties } from '../lib/types'

export interface LayerVisibility {
  signs: boolean
  pavement: boolean
  waypoints: boolean
}

interface Props {
  visibility: LayerVisibility
  selectedSignId: string | null
  onSelectSign: (props: SignProperties) => void
  onSelectWaypoint: (props: WaypointProperties) => void
  onMapReady?: (map: maplibregl.Map) => void
}

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

export function MapView({ visibility, selectedSignId, onSelectSign, onSelectWaypoint, onMapReady }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!mapContainer.current) return
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: STYLE,
      center: [-88.72, 42.28],
      zoom: 13,
    })
    mapRef.current = map
    onMapReady?.(map)

    map.on('load', async () => {
      const [routeGeo, signsGeo, pavementGeo] = await Promise.all([
        fetch('data/route.geojson').then((r) => r.json()),
        fetch('data/signs.geojson').then((r) => r.json()),
        fetch('data/pavement_synthetic.geojson').then((r) => r.json()),
      ])

      const routeLine = routeGeo.features.find((f: any) => f.geometry.type === 'LineString')
      const waypoints: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: routeGeo.features.filter((f: any) => f.geometry.type === 'Point'),
      }
      const routeCollection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [routeLine] }

      map.addSource('route', { type: 'geojson', data: routeCollection })
      map.addSource('waypoints', { type: 'geojson', data: waypoints })
      map.addSource('signs', { type: 'geojson', data: signsGeo })
      map.addSource('pavement', { type: 'geojson', data: pavementGeo })

      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#898781', 'line-width': 2.5 },
      })

      map.addLayer({
        id: 'pavement-line',
        type: 'line',
        source: 'pavement',
        paint: {
          'line-width': 5,
          'line-color': [
            'match',
            ['get', 'condition_class'],
            'good', '#0ca30c',
            'fair', '#fab219',
            'poor', '#d03b3b',
            '#898781',
          ],
        },
      })

      map.addLayer({
        id: 'waypoints-layer',
        type: 'circle',
        source: 'waypoints',
        paint: {
          'circle-radius': 4,
          'circle-color': '#2a78d6',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      })

      map.addLayer({
        id: 'signs-layer',
        type: 'circle',
        source: 'signs',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'sign_id'], selectedSignId ?? ''], 9, 6],
          'circle-color': ['match', ['get', 'review_status'], 'flagged', '#d03b3b', '#0ca30c'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })

      const bounds = new maplibregl.LngLatBounds()
      routeLine.geometry.coordinates.forEach((c: [number, number]) => bounds.extend(c))
      map.fitBounds(bounds, { padding: 40 })

      map.on('click', 'signs-layer', (e) => {
        const f = e.features?.[0]
        if (f) onSelectSign(f.properties as SignProperties)
      })
      map.on('click', 'waypoints-layer', (e) => {
        const f = e.features?.[0]
        if (f) onSelectWaypoint(f.properties as WaypointProperties)
      })
      for (const layer of ['signs-layer', 'waypoints-layer']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }
    })

    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('signs-layer')) return
    map.setLayoutProperty('signs-layer', 'visibility', visibility.signs ? 'visible' : 'none')
    map.setLayoutProperty('pavement-line', 'visibility', visibility.pavement ? 'visible' : 'none')
    map.setLayoutProperty('waypoints-layer', 'visibility', visibility.waypoints ? 'visible' : 'none')
  }, [visibility])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('signs-layer')) return
    map.setPaintProperty('signs-layer', 'circle-radius', [
      'case',
      ['==', ['get', 'sign_id'], selectedSignId ?? ''],
      9,
      6,
    ])
  }, [selectedSignId])

  return <div ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />
}
