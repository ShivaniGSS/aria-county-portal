import { useCallback, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMaintenanceData } from '../lib/useMaintenanceData'
import { useAppState } from '../lib/AppStateContext'
import { addBasemap, baseStyle, mergeConditionOntoGeometry, segmentCoordinates } from '../lib/countyMapSource'
import { OFFLINE_BASEMAP } from '../lib/basemaps'

const W = 270
const H = 260

/**
 * The map that follows you. Once you've drilled into a segment, this stays pinned in the
 * corner of whatever page you're on, showing where on the county system you are -- so the
 * graphs are never read without the place they describe. Drag it; collapse it.
 */
export function FloatingMap() {
  const { data } = useMaintenanceData()
  const { selection, setPage, drillTo } = useAppState()
  const [collapsed, setCollapsed] = useState(false)
  const [pos, setPos] = useState({ right: 20, bottom: 20 })
  const drag = useRef<{ x: number; y: number; right: number; bottom: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, ...pos }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    setPos({
      right: Math.max(8, d.right - (e.clientX - d.x)),
      bottom: Math.max(8, d.bottom - (e.clientY - d.y)),
    })
  }
  const onPointerUp = () => { drag.current = null }

  const segment = selection.segmentId ? data?.countySegmentById.get(selection.segmentId) : null
  if (!data || !segment) return null

  return (
    <div style={{ ...shellStyle, right: pos.right, bottom: pos.bottom, width: collapsed ? 'auto' : W }}>
      <div
        style={barStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Where this is
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {segment.label}
          </span>
        </span>
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          <button style={barBtn} title="Open the full county map"
            onClick={() => { setPage('county'); drillTo({ segmentId: segment.segment_id }) }}>⤢</button>
          <button style={barBtn} title={collapsed ? 'Show map' : 'Hide map'}
            onClick={() => setCollapsed((c) => !c)}>{collapsed ? '▣' : '–'}</button>
        </div>
      </div>
      {!collapsed && (
        <>
          <MiniMap data={data} segmentId={segment.segment_id} />
          <div style={captionStyle}>
            {segment.length_mi.toFixed(1)} mi · {segment.functional_class}
            {segment.township ? ` · ${segment.township}` : ''}
          </div>
        </>
      )}
    </div>
  )
}

function MiniMap({
  data, segmentId,
}: {
  data: NonNullable<ReturnType<typeof useMaintenanceData>['data']>
  segmentId: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const boundsRef = useRef<[[number, number], [number, number]] | null>(null)
  const [ready, setReady] = useState(false)

  // This is a LOCATOR, so it always frames the whole county and never zooms to the
  // segment. Cropped tight to a mile of road, the panel read as another chart rather
  // than as a map -- the one question it exists to answer is "where in Boone is this".
  const frame = useCallback((map: maplibregl.Map, bounds: [[number, number], [number, number]] | null) => {
    if (bounds) {
      map.fitBounds(bounds, { padding: 10, duration: 0 })
      return
    }
    const all = new maplibregl.LngLatBounds()
    for (const f of data.countyGeometry.features) {
      for (const c of segmentCoordinates(f)) all.extend(c)
    }
    if (!all.isEmpty()) map.fitBounds(all, { padding: 10, duration: 0 })
  }, [data])

  useEffect(() => {
    if (!container.current) return
    const map = new maplibregl.Map({
      container: container.current,
      style: baseStyle(OFFLINE_BASEMAP),
      center: [-88.82, 42.32],
      zoom: 10,
      attributionControl: false,
      interactive: false,
    })
    mapRef.current = map

    map.on('load', async () => {
      const countyBounds = await addBasemap(map, 'mini')
      map.addSource('county', {
        type: 'geojson',
        data: mergeConditionOntoGeometry(data.countyGeometry, data.countySegmentById),
      })
      // The rest of the system stays visible but recessive, so the highlighted segment
      // reads as a place in the county rather than a line floating on a basemap.
      map.addLayer({
        id: 'mini-context', type: 'line', source: 'county',
        paint: { 'line-width': 1.6, 'line-color': '#8d8b84', 'line-opacity': 0.6 },
      })
      // A halo under the active segment so a short one is still findable at this size.
      map.addLayer({
        id: 'mini-halo', type: 'line', source: 'county',
        filter: ['==', ['get', 'segment_id'], segmentId],
        paint: { 'line-width': 9, 'line-color': ['get', 'color'], 'line-opacity': 0.25, 'line-blur': 3 },
      })
      map.addLayer({
        id: 'mini-active', type: 'line', source: 'county',
        filter: ['==', ['get', 'segment_id'], segmentId],
        paint: { 'line-width': 3.2, 'line-color': ['get', 'color'] },
      })
      boundsRef.current = countyBounds
      frame(map, countyBounds)
      setReady(true)
    })

    return () => { map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the selection without rebuilding the map or moving the view: the frame is
  // the county, and only which segment is lit changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const filter = ['==', ['get', 'segment_id'], segmentId] as maplibregl.FilterSpecification
    map.setFilter('mini-active', filter)
    map.setFilter('mini-halo', filter)
  }, [segmentId, ready])

  return <div ref={container} style={{ width: '100%', height: H }} />
}

const shellStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 60,
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
  boxShadow: '0 6px 24px rgb(0 0 0 / 0.22)',
}
const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  borderBottom: '1px solid var(--gridline)',
  cursor: 'grab',
  touchAction: 'none',
  userSelect: 'none',
}
const barBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  padding: '3px 5px',
  borderRadius: 5,
}
const captionStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  padding: '6px 9px',
  borderTop: '1px solid var(--gridline)',
}
