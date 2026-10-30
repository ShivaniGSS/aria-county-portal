import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CLASSES, iconFor, iconImages } from '../../lib/assetStyle'
import type { Road, RoadAsset } from '../../lib/roadTypes'
import { rowAt } from '../../lib/roadChecks'

export type Basemap = 'streets' | 'satellite'
export type ColorBy = 'centre' | 'width' | 'grade' | 'curve' | 'aadt'

const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
const STREETS = 'https://tiles.openfreemap.org/styles/liberty'
const SATELLITE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    sat: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, USDA FSA, USGS',
    },
    roads: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
    },
    places: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'sat', type: 'raster', source: 'sat' },
    { id: 'roads-ref', type: 'raster', source: 'roads', paint: { 'raster-opacity': 0.55 } },
    { id: 'places-ref', type: 'raster', source: 'places' },
  ],
}

const GOOD = '#2f9e5b'
const FAIR = '#f0a020'
const POOR = '#d03b3b'

export const COLOR_BY: { id: ColorBy; label: string; legend: [string, string][] }[] = [
  { id: 'centre', label: 'Centre line', legend: [[GOOD, 'Passing both ways'], [FAIR, 'Passing one way'], [POOR, 'No passing'], ['#9aa0a6', 'Not seen']] },
  { id: 'width', label: 'Paved width', legend: [[POOR, '≤ 21 ft'], [FAIR, '23 ft'], [GOOD, '≥ 25 ft']] },
  { id: 'grade', label: 'Grade', legend: [[GOOD, '0%'], [FAIR, '2%'], [POOR, '≥ 4%']] },
  { id: 'curve', label: 'Curvature', legend: [[POOR, 'Radius < 500 ft'], [FAIR, '500–1,000 ft'], [GOOD, 'Tangent / gentle']] },
  { id: 'aadt', label: 'Traffic (AADT)', legend: [['#bcd7f2', '200'], ['#5b8fd1', '800'], ['#173f78', '1,500+']] },
]

function colorExpr(by: ColorBy): maplibregl.ExpressionSpecification {
  switch (by) {
    case 'centre':
      return ['match', ['coalesce', ['get', 'centre'], ''],
        'single broken (passing both directions)', GOOD,
        'solid + broken (passing one direction)', FAIR,
        'double solid (no passing either direction)', POOR, '#9aa0a6']
    case 'width':
      return ['case', ['==', ['get', 'width'], -1], '#9aa0a6', ['interpolate', ['linear'], ['get', 'width'], 21, POOR, 23, FAIR, 25, GOOD]]
    case 'grade':
      return ['interpolate', ['linear'], ['abs', ['get', 'grade']], 0, GOOD, 2, FAIR, 4, POOR]
    case 'curve':
      return ['case', ['==', ['get', 'radius'], -1], GOOD, ['<', ['get', 'radius'], 500], POOR, ['<', ['get', 'radius'], 1000], FAIR, GOOD]
    case 'aadt':
      return ['case', ['==', ['get', 'aadt'], -1], '#9aa0a6', ['interpolate', ['linear'], ['get', 'aadt'], 200, '#bcd7f2', 800, '#5b8fd1', 1500, '#173f78']]
  }
}

interface Props {
  road: Road
  assets: RoadAsset[]
  visible: Set<string>
  flagged: Map<string, 'fail' | 'borderline' | 'note'>
  selectedId: string | null
  onSelect: (id: string | null) => void
  cursorFt: number | null
  onPickStation: (ft: number) => void
  basemap: Basemap
  threeD: boolean
  colorBy: ColorBy
  showCrashes: boolean
}

export function RoadMap(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const props = useRef(p)
  props.current = p

  // data that survives a basemap switch
  const data = useRef<{ road: maplibregl.GeoJSONSourceSpecification['data']; assets: GeoJSON.FeatureCollection; linear: GeoJSON.FeatureCollection; crashes: GeoJSON.FeatureCollection } | null>(null)

  if (!data.current) {
    const pr = p.road.profile
    data.current = {
      road: {
        type: 'FeatureCollection',
        features: pr.slice(0, -1).map((r, i) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[r.lon, r.lat], [pr[i + 1].lon, pr[i + 1].lat]] },
          properties: { ft: r.chainage_ft, centre: r.centre_type, width: r.paved_width_ft ?? -1, grade: r.grade_pct, radius: r.curve_radius_ft ?? -1, aadt: r.aadt ?? -1 },
        })),
      },
      assets: {
        type: 'FeatureCollection',
        features: p.assets.filter((a) => !a.line).map((a) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
          properties: { id: a.id, cls: a.class, icon: iconFor(a), label: a.label, flag: p.flagged.get(a.id) ?? '' },
        })),
      },
      linear: {
        type: 'FeatureCollection',
        features: p.assets.filter((a) => a.line).map((a) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: a.line! },
          properties: { id: a.id, cls: a.class, label: a.label },
        })),
      },
      crashes: {
        type: 'FeatureCollection',
        features: p.road.crashes.map((c) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
          properties: { sev: c.severity, type: c.type, date: c.date, light: c.light },
        })),
      },
    }
  }

  const addOverlay = (map: maplibregl.Map) => {
    if (map.getSource('sq-road')) return
    const d = data.current!
    for (const { id, image } of iconImages()) if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 })
    map.addSource('sq-road', { type: 'geojson', data: d.road })
    map.addSource('sq-assets', { type: 'geojson', data: d.assets })
    map.addSource('sq-linear', { type: 'geojson', data: d.linear })
    map.addSource('sq-crashes', { type: 'geojson', data: d.crashes })
    map.addSource('sq-cursor', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'sq-road-casing', type: 'line', source: 'sq-road', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 7, 14, 11, 16, 14, 19, 28], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, 1, 18, 0.35] } })
    map.addLayer({ id: 'sq-road', type: 'line', source: 'sq-road', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colorExpr(props.current.colorBy), 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 14, 7, 16, 10, 19, 22], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0.95, 18, 0.5] } })
    map.addLayer({ id: 'sq-linear', type: 'line', source: 'sq-linear',
      paint: { 'line-color': ['match', ['get', 'cls'], 'guardrail', '#c7d2dd', '#c49a6c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 18, 6],
        'line-dasharray': ['match', ['get', 'cls'], 'fence', ['literal', [2, 1.5]], ['literal', [1, 0]]] } })
    map.addLayer({ id: 'sq-crashes', type: 'circle', source: 'sq-crashes', minzoom: 12,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 18, 7], 'circle-color': '#ffffff',
        'circle-stroke-color': ['match', ['get', 'sev'], 'Fatal Crash', '#5b0b0b', 'A Injury Crash', '#b3261e', 'B Injury Crash', '#e8590c', '#7c7c7c'],
        'circle-stroke-width': 2.5 } })
    map.addLayer({ id: 'sq-flag', type: 'circle', source: 'sq-assets', minzoom: 13, filter: ['!=', ['get', 'flag'], ''],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 6, 18, 17], 'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': ['match', ['get', 'flag'], 'fail', '#e5383b', 'borderline', '#f0a020', '#8e9aaf'], 'circle-stroke-width': 2.5 } })
    map.addLayer({ id: 'sq-dot', type: 'circle', source: 'sq-assets', maxzoom: 14.6,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 14.6, 4], 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.8,
        'circle-color': ['match', ['get', 'cls'], ...CLASSES.flatMap((c) => [c.id, c.color]), '#888'] as unknown as maplibregl.ExpressionSpecification } })
    map.addLayer({ id: 'sq-icon', type: 'symbol', source: 'sq-assets', minzoom: 14.6,
      layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 14.6, 0.55, 17, 0.85, 19, 1.25], 'icon-allow-overlap': true, 'icon-ignore-placement': true } })
    map.addLayer({ id: 'sq-label', type: 'symbol', source: 'sq-assets', minzoom: 17.4,
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-max-width': 9, 'text-optional': true },
      paint: { 'text-color': '#111', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } })
    map.addLayer({ id: 'sq-selected', type: 'circle', source: 'sq-assets', filter: ['==', ['get', 'id'], props.current.selectedId ?? ''],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 9, 18, 22], 'circle-color': 'rgba(42,120,214,0.18)', 'circle-stroke-color': '#2a78d6', 'circle-stroke-width': 3 } })
    map.addLayer({ id: 'sq-linear-selected', type: 'line', source: 'sq-linear', filter: ['==', ['get', 'id'], props.current.selectedId ?? ''],
      paint: { 'line-color': '#2a78d6', 'line-width': 8, 'line-opacity': 0.6 } }, 'sq-linear')
    map.addLayer({ id: 'sq-cursor', type: 'circle', source: 'sq-cursor',
      paint: { 'circle-radius': 7, 'circle-color': '#111', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } })
    applyVisibility(map)
    applyTerrain(map)
  }

  const applyVisibility = (map: maplibregl.Map) => {
    const v = props.current.visible
    const filt = ['in', ['get', 'cls'], ['literal', [...v]]] as maplibregl.FilterSpecification
    for (const id of ['sq-dot', 'sq-icon', 'sq-label']) map.getLayer(id) && map.setFilter(id, filt)
    map.getLayer('sq-flag') && map.setFilter('sq-flag', ['all', filt, ['!=', ['get', 'flag'], '']] as maplibregl.FilterSpecification)
    map.getLayer('sq-linear') && map.setFilter('sq-linear', filt)
    map.getLayer('sq-crashes') && map.setLayoutProperty('sq-crashes', 'visibility', props.current.showCrashes ? 'visible' : 'none')
  }

  const applyTerrain = (map: maplibregl.Map) => {
    if (props.current.threeD) {
      // Boone County is nearly flat (~130 ft of relief on this road), so 3D is a tilted perspective, not terrain:
      // terrain meshes added nothing visible here and put the camera inside the ground at close zoom.
      const sel = props.current.assets.find((a) => a.id === props.current.selectedId)
      const target = sel ? { center: [sel.lon, sel.lat] as [number, number] } : {}
      if (map.getPitch() < 30) map.easeTo({ ...target, pitch: 64, bearing: map.getBearing() || -25, zoom: Math.max(map.getZoom(), 15.5), duration: 1200 })
    } else {
      if (map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 700 })
    }
  }

  // create once
  useEffect(() => {
    const line = p.road.line
    const b = new maplibregl.LngLatBounds(line[0], line[0])
    line.forEach((c) => b.extend(c))
    const map = new maplibregl.Map({
      container: el.current!,
      style: p.basemap === 'satellite' ? SATELLITE : STREETS,
      bounds: b,
      fitBoundsOptions: { padding: 60 },
      maxPitch: 75,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left')
    // an inline style can finish loading inside the constructor, before this listener exists
    map.on('style.load', () => addOverlay(map))
    map.on('error', (e) => console.error('[road map]', e.error?.message ?? e))
    if (map.isStyleLoaded()) addOverlay(map)
    else map.once('load', () => addOverlay(map))

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'road-popup' })
    const hover = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      map.getCanvas().style.cursor = 'pointer'
      const a = props.current.assets.find((x) => x.id === f.properties.id)
      if (!a) return
      const st = a.attrs.station?.value ?? ''
      const side = a.attrs.side?.value ?? ''
      const off = a.attrs.offset_travelled_way_ft?.value
      popup.setLngLat(e.lngLat).setHTML(
        `<b>${a.label}</b><br><span>Sta. ${st} · ${side}${typeof off === 'number' ? ` · ${off.toFixed(1)} ft from travelled way` : ''}</span>`,
      ).addTo(map)
    }
    const leave = () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    }
    for (const id of ['sq-icon', 'sq-dot', 'sq-linear']) {
      map.on('mousemove', id, hover)
      map.on('mouseleave', id, leave)
      map.on('click', id, (e) => {
        const f = e.features?.[0]
        if (f) props.current.onSelect(String(f.properties.id))
      })
    }
    map.on('mousemove', 'sq-crashes', (e) => {
      const f = e.features?.[0]
      if (!f) return
      map.getCanvas().style.cursor = 'pointer'
      popup.setLngLat(e.lngLat).setHTML(`<b>Crash · ${f.properties.date ?? ''}</b><br><span>${f.properties.type} · ${f.properties.sev} · ${f.properties.light}</span>`).addTo(map)
    })
    map.on('mouseleave', 'sq-crashes', leave)
    map.on('click', 'sq-road', (e) => {
      const f = e.features?.[0]
      if (f && !map.queryRenderedFeatures(e.point, { layers: ['sq-icon', 'sq-dot'] }).length) props.current.onPickStation(Number(f.properties.ft))
    })
    const fly = (e: Event) => {
      const r = (e as CustomEvent).detail as { lon: number; lat: number; heading_deg: number }
      map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 16.5), duration: 800, essential: true })
    }
    window.addEventListener('road:fly', fly)
    return () => {
      window.removeEventListener('road:fly', fly)
      map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // basemap
  const firstStyle = useRef(true)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (firstStyle.current) {
      firstStyle.current = false
      return
    }
    // a style URL carries its own default camera; keep the engineer where they were
    const cam = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
    map.setStyle(p.basemap === 'satellite' ? SATELLITE : STREETS, { diff: false })
    map.once('style.load', () => map.jumpTo(cam))
  }, [p.basemap])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer('sq-road')) map.setPaintProperty('sq-road', 'line-color', colorExpr(p.colorBy))
  }, [p.colorBy])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer('sq-dot')) applyVisibility(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.visible, p.showCrashes])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getSource('sq-road')) applyTerrain(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.threeD])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const src = map.getSource('sq-assets') as maplibregl.GeoJSONSource | undefined
    const fc = data.current!.assets
    fc.features.forEach((f) => (f.properties!.flag = p.flagged.get(String(f.properties!.id)) ?? ''))
    src?.setData(fc)
  }, [p.flagged])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('sq-selected')) return
    const id = p.selectedId ?? ''
    map.setFilter('sq-selected', ['==', ['get', 'id'], id])
    map.setFilter('sq-linear-selected', ['==', ['get', 'id'], id])
    const a = p.assets.find((x) => x.id === id)
    if (a) map.flyTo({ center: [a.lon, a.lat], zoom: Math.max(map.getZoom(), 17.6), duration: 900, essential: true })
  }, [p.selectedId, p.assets])

  useEffect(() => {
    const map = mapRef.current
    const src = map?.getSource('sq-cursor') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    if (p.cursorFt === null) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    const r = rowAt(p.road, p.cursorFt)
    src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: {} }] })
  }, [p.cursorFt, p.road])

  return <div ref={el} style={{ position: 'absolute', inset: 0 }} />
}

/** Fly the map to a chainage (used by the strip diagram). Exposed through a ref-free event to keep props simple. */
export const flyToStation = (road: Road, ft: number) => window.dispatchEvent(new CustomEvent('road:fly', { detail: rowAt(road, ft) }))
