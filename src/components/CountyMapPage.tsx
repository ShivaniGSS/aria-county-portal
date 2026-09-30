import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMaintenanceData } from '../lib/useMaintenanceData'
import { useAppState } from '../lib/AppStateContext'
import { CONDITION_BANDS, conditionColor, type CountySegment } from '../lib/assetTypes'
import { addBasemap, baseStyle, mergeConditionOntoGeometry } from '../lib/countyMapSource'
import { BASEMAPS, basemapById, DEFAULT_BASEMAP, OFFLINE_BASEMAP, probeTiles, type Basemap } from '../lib/basemaps'
import { MapLabels, NorthArrow, type RouteLabel } from './MapLabels'

export type MapMode = 'county' | 'network'

/**
 * Page 1 -- the whole county highway system, cut into ~6-mile planning segments.
 * Clicking a segment drills into its condition graphs on page 2.
 */
export function CountyMapPage() {
  const { data, loading } = useMaintenanceData()
  const { selection, drillTo, setPage } = useAppState()
  const [hovered, setHovered] = useState<string | null>(null)
  // Two maps, one page. 'county' is the condition map of the 93 miles the engineer is
  // responsible for, on a quiet grey street network -- the default, because colouring
  // 3,088 other roads in the same ramp turns the county into an orange wash and buries
  // the subject. 'network' colours every jurisdiction: a coverage map, not a work plan.
  const [mode, setMode] = useState<MapMode>('county')
  const [measuredOnly, setMeasuredOnly] = useState(false)
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP.id)
  // Set when tiles cannot be reached at all -- a sandboxed embed, or an office with no
  // route out. The map falls back to the backdrop that ships with the portal rather
  // than showing a blank canvas, and says so instead of failing silently.
  const [offline, setOffline] = useState(false)
  const basemap = offline ? OFFLINE_BASEMAP : basemapById(basemapId)

  // Ask the network directly whether the chosen service is reachable, rather than
  // waiting for the map to fail quietly and leave the user with an empty canvas.
  useEffect(() => {
    const chosen = basemapById(basemapId)
    if (!chosen.tiles) return
    let cancelled = false
    probeTiles(chosen).then((ok) => { if (!cancelled && !ok) setOffline(true) })
    return () => { cancelled = true }
  }, [basemapId])

  const merged = useMemo(
    () => (data ? mergeConditionOntoGeometry(data.countyGeometry, data.countySegmentById) : null),
    [data],
  )

  // Where each route name goes: the midpoint of the segment's LONGEST constituent line,
  // which sits on the road. A centroid would float off it wherever a corridor bends.
  const routeLabels = useMemo<RouteLabel[]>(() => {
    if (!data) return []
    return data.countyGeometry.features.flatMap((f) => {
      const seg = data.countySegmentById.get(String(f.properties?.segment_id))
      const g = f.geometry
      if (!seg || g.type !== 'MultiLineString' || g.coordinates.length === 0) return []
      const longest = g.coordinates.reduce((a, b) => (b.length > a.length ? b : a))
      const mid = longest[Math.floor(longest.length / 2)] as [number, number]
      return [{
        id: seg.segment_id,
        name: seg.road_name,
        lon: mid[0],
        lat: mid[1],
        lengthMi: seg.length_mi,
      }]
    })
  }, [data])

  const open = (segmentId: string) => {
    drillTo({ segmentId })
    setPage('condition')
  }

  if (loading || !data || !merged) return <div style={{ padding: 24 }}>Loading the county road network…</div>

  const segments = data.countyAssets.segments
  const totalMiles = segments.reduce((a, s) => a + s.length_mi, 0)
  const measured = segments.filter((s) => s.tier === 'measured')
  // Miles in each band, so the legend states the network rather than just decoding ink.
  const bandMiles = CONDITION_BANDS.map((b, i) => {
    const upper = i === 0 ? 101 : CONDITION_BANDS[i - 1].min
    return segments
      .filter((s) => s.condition_now >= b.min && s.condition_now < upper)
      .reduce((a, s) => a + s.length_mi, 0)
  })

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', minHeight: 0 }}>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <CountyMap
          geojson={merged}
          routeLabels={routeLabels}
          selectedId={selection.segmentId}
          hoveredId={hovered}
          mode={mode}
          measuredOnly={measuredOnly}
          basemap={basemap}
          onTilesUnavailable={() => setOffline(true)}
          onHover={setHovered}
          onSelect={open}
        />
        <div style={basemapBox}>
          <div style={{ ...legendTitle, marginBottom: 5 }}>Basemap</div>
          {BASEMAPS.map((b) => {
            const active = basemap.id === b.id
            const unavailable = offline && b.id !== OFFLINE_BASEMAP.id
            return (
              <label key={b.id} style={{ ...basemapRow, opacity: unavailable ? 0.4 : 1 }}>
                <input
                  type="radio" name="basemap" id={`basemap-${b.id}`}
                  checked={active} disabled={unavailable}
                  onChange={() => { setOffline(false); setBasemapId(b.id) }}
                />
                <span>
                  <span style={{ fontWeight: active ? 700 : 500 }}>{b.label}</span>
                  <span style={{ display: 'block', fontSize: 9.5, color: 'var(--text-muted)' }}>{b.note}</span>
                </span>
              </label>
            )
          })}
          {offline && (
            <div style={offlineNote}>
              Tile services unreachable — using the backdrop that ships with the portal.
            </div>
          )}
        </div>

        <div style={legendBox}>
          <div style={legendTitle}>Pavement condition</div>
          <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginBottom: 7 }}>
            County highway system · centerline miles
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {CONDITION_BANDS.map((b, i) => (
                <tr key={b.label}>
                  <td style={{ paddingRight: 7, width: 26 }}>
                    <CasedSwatch color={b.color} />
                  </td>
                  <td style={legendCell}>{b.label}</td>
                  <td style={{ ...legendCell, color: 'var(--text-muted)' }}>
                    {i === 0 ? '75+' : `${b.min}–${CONDITION_BANDS[i - 1].min}`}
                  </td>
                  <td style={{ ...legendCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {bandMiles[i].toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={legendDivider} />
          <div style={legendRow}>
            <CasedSwatch color="#8C8577" />
            condition measured by IDOT
          </div>
          <div style={legendRow}>
            <CasedSwatch color="#8C8577" provisional />
            synthetic stand-in · not surveyed
          </div>
          <div style={legendRow}>
            <span style={{ width: 22, height: 3, background: mode === 'network' ? '#D59469' : '#CFCABC', borderRadius: 2, flexShrink: 0 }} />
            {mode === 'network' ? 'other jurisdictions · lighter tint' : 'other jurisdictions · not coloured'}
          </div>

          <div style={legendDivider} />
          <div style={{ display: 'flex', gap: 0, marginBottom: 7 }}>
            {(['county', 'network'] as MapMode[]).map((m) => (
              <button key={m} id={`mode-${m}`} onClick={() => setMode(m)}
                style={{ ...modeBtn, ...(mode === m ? modeBtnActive : {}) }}>
                {m === 'county' ? 'County system' : 'All jurisdictions'}
              </button>
            ))}
          </div>
          <label style={legendToggle}>
            <input type="checkbox" id="measured-only" checked={measuredOnly}
              onChange={(e) => setMeasuredOnly(e.target.checked)} />
            Only roads with a real reading
          </label>
        </div>
      </div>

      <aside style={railStyle}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--gridline)' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Boone County highway system</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
            {segments.length} planning segments · {totalMiles.toFixed(0)} centerline miles. Each county
            road is cut into runs of about 6 miles; roads shorter than that stay whole, so segments
            range from {Math.min(...segments.map((s) => s.length_mi)).toFixed(1)} to{' '}
            {Math.max(...segments.map((s) => s.length_mi)).toFixed(1)} mi. {measured.length} carry a real
            IDOT condition reading; the other {segments.length - measured.length} carry a{' '}
            <strong>synthetic placeholder</strong> awaiting survey.
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
            Boone's other 684 miles — state, township and city — are drawn grey as context.
            Switch the legend to <em>all jurisdictions</em> to colour them too, or tick{' '}
            <em>only roads with a real reading</em> to see how little of the county has
            actually been surveyed.
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {[...segments]
            .sort((a, b) => a.condition_now - b.condition_now)
            .map((s) => (
              <SegmentRow
                key={s.segment_id}
                segment={s}
                active={selection.segmentId === s.segment_id}
                hovered={hovered === s.segment_id}
                onHover={setHovered}
                onClick={() => open(s.segment_id)}
              />
            ))}
        </div>
      </aside>
    </div>
  )
}

function CasedSwatch({ color, provisional }: { color: string; provisional?: boolean }) {
  return (
    <svg width={24} height={9} style={{ display: 'block', flexShrink: 0 }}>
      <line x1={1} y1={4.5} x2={23} y2={4.5} stroke="rgba(52,47,38,0.42)" strokeWidth={7} strokeLinecap="round" />
      <line x1={1} y1={4.5} x2={23} y2={4.5} stroke={color} strokeWidth={5} strokeLinecap="round" />
      {provisional && (
        <line x1={1} y1={4.5} x2={23} y2={4.5} stroke="#fff" strokeWidth={1.6} strokeDasharray="1.6 2.4" />
      )}
    </svg>
  )
}

function SegmentRow({
  segment, active, hovered, onHover, onClick,
}: {
  segment: CountySegment
  active: boolean
  hovered: boolean
  onHover: (id: string | null) => void
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover(segment.segment_id)}
      onMouseLeave={() => onHover(null)}
      style={{
        ...rowStyle,
        background: active ? 'var(--surface-2)' : hovered ? 'var(--surface-1)' : 'transparent',
        borderLeftColor: conditionColor(segment.condition_now),
      }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <strong style={{ fontSize: 13 }}>{segment.label}</strong>
        <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: conditionColor(segment.condition_now) }}>
          {segment.condition_now.toFixed(0)}
        </span>
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}>
        {segment.length_mi.toFixed(1)} mi · {segment.asset_classes.reduce((a, c) => a + c.assets.length, 0)} assets
        <span className={segment.tier === 'measured' ? 'badge badge-good' : 'badge badge-synthetic'}>
          {segment.tier}
        </span>
      </span>
    </button>
  )
}

/* --------------------------------------------------------------------- map */

function CountyMap({
  geojson, routeLabels, selectedId, hoveredId, mode, measuredOnly, basemap,
  onTilesUnavailable, onHover, onSelect,
}: {
  geojson: GeoJSON.FeatureCollection
  routeLabels: RouteLabel[]
  selectedId: string | null
  hoveredId: string | null
  mode: MapMode
  measuredOnly: boolean
  basemap: Basemap
  onTilesUnavailable: () => void
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const viewRef = useRef<{ center: maplibregl.LngLatLike; zoom: number } | null>(null)
  const [ready, setReady] = useState(false)
  // Held in state, not just the ref, so the label overlay re-renders once it exists.
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)

  // Handlers are read through a ref so the map is built once and never torn down
  // when a parent re-render hands down new closures.
  const handlers = useRef({ onHover, onSelect })
  handlers.current = { onHover, onSelect }

  useEffect(() => {
    if (!container.current) return
    const map = new maplibregl.Map({
      container: container.current,
      style: baseStyle(basemap),
      // Resume where the previous basemap left off, so switching backdrop does not
      // throw away the view the user had navigated to.
      center: viewRef.current?.center ?? [-88.82, 42.32],
      zoom: viewRef.current?.zoom ?? 10,
    })
    let disposed = false
    mapRef.current = map
    setMapInstance(map)
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'imperial' }), 'bottom-right')

    // A handful of tile errors in quick succession means the service is unreachable,
    // not that one tile dropped. Count them rather than falling back on the first.
    let tileErrors = 0
    map.on('error', (e) => {
      const src = (e as unknown as { sourceId?: string }).sourceId
      if (src !== 'basemap') return
      if (++tileErrors === 4) onTilesUnavailable()
    })

    map.on('load', async () => {
      const countyBounds = await addBasemap(map, 'full', basemap.tiles ? 'overlay' : 'vector', !!basemap.dark)
      // addBasemap awaits a fetch; by the time it resolves this map may already have
      // been removed (a basemap switch, or StrictMode's double mount in development).
      // Touching a removed map throws "Style is not done loading".
      if (disposed || !map.getLayer('ground')) return
      map.addSource('county', { type: 'geojson', data: geojson })

      // A wide invisible line makes segments clickable without drawing them fat.
      map.addLayer({
        id: 'county-hit', type: 'line', source: 'county',
        paint: { 'line-width': 18, 'line-opacity': 0 },
      })

      // The county system is drawn as a cased line, the way a condition map is drawn on
      // paper: a white halo lifts it clear of the street grid, a hairline casing keeps
      // the pale Fair band legible on a pale ground, and the band colour sits inside.
      // Earlier versions dashed the whole line for synthetic segments, which at this
      // width broke each road into chunky slabs and read as highlighter, not survey.
      const cw = (a: number, b: number) =>
        ['interpolate', ['linear'], ['zoom'], 9, a, 13, b] as unknown as maplibregl.ExpressionSpecification
      const CORE = cw(3.6, 7)

      map.addLayer({
        id: 'county-halo', type: 'line', source: 'county',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFFFFF', 'line-width': cw(7.4, 12.6) },
      })
      map.addLayer({
        id: 'county-casing', type: 'line', source: 'county',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // The selected segment takes a heavier, darker casing -- an outline rather
          // than the translucent black slab this used to lay over the road.
          'line-color': ['case', ['==', ['get', 'segment_id'], ['literal', '']], '#111111', 'rgba(52,47,38,0.42)'],
          'line-width': cw(5.2, 9),
        },
      })
      map.addLayer({
        id: 'county-core', type: 'line', source: 'county',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': CORE },
      })
      // Provenance, drawn INSIDE the line: a white dotted centreline marks a segment
      // whose condition is a synthetic stand-in. The road keeps its shape and its
      // colour; only its certainty is qualified.
      map.addLayer({
        id: 'county-provisional', type: 'line', source: 'county',
        filter: ['==', ['get', 'tier'], 'synthetic'],
        layout: { 'line-cap': 'butt' },
        paint: {
          'line-color': '#FFFFFF',
          'line-width': cw(0.9, 1.5),
          'line-dasharray': [1, 3],
          'line-opacity': 0.8,
        },
      })

      if (countyBounds && !viewRef.current) {
        map.fitBounds(countyBounds, { padding: 28, duration: 0 })
      } else {
        const bounds = new maplibregl.LngLatBounds()
        for (const f of geojson.features) {
          const g = f.geometry as GeoJSON.MultiLineString
          for (const part of g.coordinates) for (const c of part) bounds.extend(c as [number, number])
        }
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40 })
      }

      map.on('click', 'county-hit', (e) => {
        const id = e.features?.[0]?.properties?.segment_id
        if (id) handlers.current.onSelect(String(id))
      })
      map.on('mousemove', 'county-hit', (e) => {
        const id = e.features?.[0]?.properties?.segment_id
        map.getCanvas().style.cursor = 'pointer'
        handlers.current.onHover(id ? String(id) : null)
      })
      map.on('mouseleave', 'county-hit', () => {
        map.getCanvas().style.cursor = ''
        handlers.current.onHover(null)
      })

      setReady(true)
    })

    return () => {
      disposed = true
      viewRef.current = { center: map.getCenter(), zoom: map.getZoom() }
      map.remove()
      mapRef.current = null
      setMapInstance(null)
      setReady(false)
    }
    // Rebuilt from scratch when the basemap changes: swapping a raster source and
    // reordering every overlay by hand is far more error-prone than one clean remount,
    // and the view is carried across in viewRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap.id])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource('county') as maplibregl.GeoJSONSource | undefined)?.setData(geojson)
  }, [geojson, ready])

  // "Only roads with a real reading" is the honest view of the network: turn it on and
  // almost everything but the state highways disappears. Both toggles are applied to the
  // county's own layers and the context layers together.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const vis = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    vis('bm-cond-measured', mode === 'network')
    vis('bm-cond-synthetic', mode === 'network' && !measuredOnly)
    // Hiding synthetic county segments entirely is what "measured only" means. The
    // provisional centreline keeps its own tier filter -- driving it from here would
    // stamp the "synthetic" marking onto measured segments.
    for (const id of ['county-halo', 'county-casing', 'county-core']) {
      if (!map.getLayer(id)) continue
      map.setFilter(id, measuredOnly ? ['==', ['get', 'tier'], 'measured'] : null)
    }
    vis('county-provisional', !measuredOnly)
  }, [mode, measuredOnly, ready])

  // Highlight whichever segment is selected or under the cursor.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const active = hoveredId ?? selectedId ?? ' '
    map.setPaintProperty('county-halo', 'line-opacity', [
      'case', ['==', ['get', 'segment_id'], active], 0.35, 0,
    ])
  }, [hoveredId, selectedId, ready])

  return (
    <>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      <MapLabels map={mapInstance} ready={ready} routes={routeLabels} dark={!!basemap.dark} />
      <NorthArrow />
    </>
  )
}

/* ------------------------------------------------------------------ styles */

const railStyle: React.CSSProperties = {
  width: 320,
  flexShrink: 0,
  borderLeft: '1px solid var(--gridline)',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
}
const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  width: '100%',
  textAlign: 'left',
  border: 'none',
  borderLeft: '3px solid transparent',
  borderBottom: '1px solid var(--gridline)',
  padding: '9px 14px',
  cursor: 'pointer',
  color: 'var(--text-primary)',
}
const legendBox: React.CSSProperties = {
  position: 'absolute',
  left: 14,
  bottom: 14,
  minWidth: 224,
  background: 'rgba(255,255,255,0.94)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '11px 13px 10px',
  fontSize: 10.5,
  lineHeight: 1.6,
  boxShadow: '0 1px 6px rgb(0 0 0 / 0.10)',
}
const legendTitle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 10,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--text-primary)',
}
const legendCell: React.CSSProperties = { padding: '1px 5px 1px 0', whiteSpace: 'nowrap' }
const basemapBox: React.CSSProperties = {
  position: 'absolute',
  right: 14,
  top: 14,
  background: 'rgba(255,255,255,0.94)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '10px 12px',
  fontSize: 10.5,
  boxShadow: '0 1px 6px rgb(0 0 0 / 0.10)',
}
const basemapRow: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 6, padding: '2px 0', cursor: 'pointer', lineHeight: 1.35,
}
const offlineNote: React.CSSProperties = {
  marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--gridline)',
  fontSize: 9.5, color: 'var(--status-warning)', maxWidth: 170, lineHeight: 1.4,
}
const modeBtn: React.CSSProperties = {
  flex: 1,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 10,
  fontWeight: 600,
  padding: '4px 6px',
  cursor: 'pointer',
}
const modeBtnActive: React.CSSProperties = {
  background: '#4F4A3E',
  borderColor: '#4F4A3E',
  color: '#fff',
}
const legendRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7 }
const legendDivider: React.CSSProperties = {
  height: 1, background: 'var(--gridline)', margin: '8px 0',
}
const legendToggle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '1px 0',
}
