import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CLASSES } from '../../lib/assetStyle'
import type { Pano, Road, RoadAsset } from '../../lib/roadTypes'

/** Small locator map for the street-view and plan-sheet layouts: the road, its assets, and where the viewer stands. */
interface Props {
  road: Road
  assets: RoadAsset[]
  pano: Pano | undefined
  heading: number | null
  selectedId: string | null
  onPickPano: (index: number) => void
  zoom?: number
}

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Esri, Maxar',
    },
  },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
}

export function MiniMap(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const marker = useRef<maplibregl.Marker | null>(null)
  const cone = useRef<HTMLDivElement | null>(null)
  const props = useRef(p)
  props.current = p

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: STYLE, center: [p.road.line[0][0], p.road.line[0][1]], zoom: p.zoom ?? 15.5, attributionControl: false, dragRotate: false })
    map.current = m
    const add = () => {
      if (m.getSource('r')) return
      m.addSource('r', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p.road.line } } })
      m.addLayer({ id: 'r-case', type: 'line', source: 'r', paint: { 'line-color': '#fff', 'line-width': 6, 'line-opacity': 0.7 } })
      m.addLayer({ id: 'r', type: 'line', source: 'r', paint: { 'line-color': '#2a78d6', 'line-width': 3 } })
      m.addSource('a', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: p.assets.filter((a) => !a.line).map((a) => ({ type: 'Feature', properties: { id: a.id, cls: a.class }, geometry: { type: 'Point', coordinates: [a.lon, a.lat] } })) },
      })
      m.addLayer({ id: 'a', type: 'circle', source: 'a', paint: {
        'circle-radius': ['case', ['==', ['get', 'id'], props.current.selectedId ?? ''], 7, 3.5],
        'circle-color': ['match', ['get', 'cls'], ...CLASSES.flatMap((c) => [c.id, c.color]), '#888'] as unknown as maplibregl.ExpressionSpecification,
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } })
    }
    m.on('load', add)
    if (m.isStyleLoaded()) add()
    m.on('click', (e) => {
      // jump the viewer to the nearest survey stop
      let best = 0
      let bd = Infinity
      props.current.road.panos.forEach((q, i) => {
        const d = (q.lon - e.lngLat.lng) ** 2 + ((q.lat - e.lngLat.lat) * 1.35) ** 2
        if (d < bd) {
          bd = d
          best = i
        }
      })
      props.current.onPickPano(best)
    })
    const node = document.createElement('div')
    node.style.cssText = 'width:44px;height:44px;position:relative;pointer-events:none'
    node.innerHTML = '<div style="position:absolute;inset:0;border-radius:50%;background:conic-gradient(from -35deg, rgba(42,120,214,0.55) 0deg 70deg, transparent 70deg 360deg)"></div><div style="position:absolute;left:16px;top:16px;width:12px;height:12px;border-radius:50%;background:#ffd23f;border:2px solid #111"></div>'
    cone.current = node.firstChild as HTMLDivElement
    marker.current = new maplibregl.Marker({ element: node }).setLngLat([p.road.line[0][0], p.road.line[0][1]]).addTo(m)
    return () => m.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!p.pano || !map.current) return
    marker.current?.setLngLat([p.pano.lon, p.pano.lat])
    map.current.easeTo({ center: [p.pano.lon, p.pano.lat], duration: 300 })
  }, [p.pano])

  useEffect(() => {
    if (cone.current) cone.current.style.transform = `rotate(${p.heading ?? p.pano?.heading ?? 0}deg)`
    // the street view announces where it is looking; follow it without re-rendering the page
    const h = (e: Event) => {
      if (cone.current) cone.current.style.transform = `rotate(${(e as CustomEvent).detail}deg)`
    }
    window.addEventListener('road:heading', h)
    return () => window.removeEventListener('road:heading', h)
  }, [p.heading, p.pano])

  useEffect(() => {
    const m = map.current
    if (m?.getLayer('a')) m.setPaintProperty('a', 'circle-radius', ['case', ['==', ['get', 'id'], p.selectedId ?? ''], 7, 3.5])
  }, [p.selectedId])

  return <div ref={el} style={{ position: 'absolute', inset: 0 }} />
}
