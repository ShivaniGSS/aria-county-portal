import { useEffect, useMemo, useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import { basemapLabels, BASEMAP_INK, type MapLabel } from '../lib/countyMapSource'

/**
 * Names on the map: townships, municipalities, and the county routes themselves.
 *
 * MapLibre renders text from a glyph server, which is the one outbound dependency this
 * basemap exists to avoid, so the labels are HTML positioned over the canvas. That also
 * makes collision handling explicit, which matters here: an unlabelled condition map is
 * unusable to an engineer, and a map whose labels pile on top of each other is worse.
 */
export interface RouteLabel {
  id: string
  name: string
  lon: number
  lat: number
  lengthMi: number
}

type Placed = { key: string; text: string; x: number; y: number; kind: 'township' | 'place' | 'route' | 'county' }

export function MapLabels({
  map, ready, routes, dark = false,
}: {
  map: maplibregl.Map | null
  ready: boolean
  routes: RouteLabel[]
  /** Over aerial imagery the labels must invert, or they disappear into the ground. */
  dark?: boolean
}) {
  const [base, setBase] = useState<MapLabel[]>([])
  const [placed, setPlaced] = useState<Placed[]>([])

  useEffect(() => { basemapLabels().then(setBase) }, [])

  // Routes are the subject of the map, so they claim their space first; place names
  // orient the reader next; township names are the ground and yield to both.
  const ordered = useMemo(() => [
    ...routes.map((r) => ({ key: `r-${r.id}`, text: r.name, lon: r.lon, lat: r.lat,
                            kind: 'route' as const, weight: r.lengthMi })),
    ...base.filter((l) => l.kind === 'place')
      .map((l) => ({ key: `p-${l.name}`, text: l.name, lon: l.lon, lat: l.lat,
                     kind: 'place' as const, weight: l.area })),
    ...base.filter((l) => l.kind === 'township')
      .map((l) => ({ key: `t-${l.name}`, text: l.name, lon: l.lon, lat: l.lat,
                     kind: 'township' as const, weight: l.area })),
    // Neighbouring counties last: they are the outermost ring of context and yield to
    // everything inside Boone.
    ...base.filter((l) => l.kind === 'county')
      .map((l) => ({ key: `c-${l.name}`, text: l.name, lon: l.lon, lat: l.lat,
                     kind: 'county' as const, weight: l.area })),
  ], [routes, base])

  useEffect(() => {
    if (!map || !ready) return

    const reposition = () => {
      const zoom = map.getZoom()
      const { width, height } = map.getCanvas().getBoundingClientRect()
      const out: (Placed & { w: number; h: number })[] = []

      for (const l of ordered) {
        // Detail earns its place by zoom: at county view only the longer routes and the
        // larger settlements are legible at all.
        if (l.kind === 'route' && zoom < 10.4 && l.weight < 4) continue
        if (l.kind === 'place' && l.weight < 8 && zoom < 11) continue
        if (l.kind === 'township' && zoom > 12.5) continue
        if (l.kind === 'county' && zoom > 11.5) continue

        const p = map.project([l.lon, l.lat])
        const w = l.text.length * (l.kind === 'township' ? 7.6 : 6.2) + 10
        const h = 14
        if (p.x < w / 2 || p.y < h || p.x > width - w / 2 || p.y > height - h) continue
        const hit = out.some((o) =>
          Math.abs(o.x - p.x) < (o.w + w) / 2 && Math.abs(o.y - p.y) < (o.h + h) / 2)
        if (hit) continue
        out.push({ key: l.key, text: l.text, x: p.x, y: p.y, kind: l.kind, w, h })
      }
      setPlaced(out.map(({ w: _w, h: _h, ...rest }) => rest))
    }

    reposition()
    map.on('move', reposition)
    map.on('resize', reposition)
    return () => {
      map.off('move', reposition)
      map.off('resize', reposition)
    }
  }, [map, ready, ordered])

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {placed.map((l) => (
        <span key={l.key} style={{ ...labelBase, left: l.x, top: l.y, ...(dark ? DARK_STYLES : STYLES)[l.kind] }}>
          {l.text}
        </span>
      ))}
    </div>
  )
}

/**
 * North arrow. The scale bar itself is MapLibre's own ScaleControl -- hand-rolling the
 * metres-per-pixel maths got it wrong twice, and the library already does it correctly
 * for the current projection, latitude and pixel ratio.
 */
export function NorthArrow() {
  return (
    <div style={northWrap} aria-hidden>
      <svg width={13} height={17} viewBox="0 0 13 17">
        <path d="M6.5 0 L11 12 L6.5 9 L2 12 Z" fill="#4F4A3E" />
      </svg>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#4F4A3E' }}>N</span>
    </div>
  )
}

const northWrap: React.CSSProperties = {
  position: 'absolute',
  right: 14,
  bottom: 72,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 1,
  padding: '5px 7px',
  background: 'rgba(255,255,255,0.9)',
  border: '1px solid var(--border)',
  borderRadius: 5,
  pointerEvents: 'none',
}

const labelBase: React.CSSProperties = {
  position: 'absolute',
  transform: 'translate(-50%, -50%)',
  whiteSpace: 'nowrap',
}

const STYLES: Record<Placed['kind'], React.CSSProperties> = {
  township: {
    fontSize: 9.5,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: '#A69F8D',
    fontWeight: 600,
  },
  place: {
    fontSize: 11,
    color: BASEMAP_INK.placeLabel,
    fontWeight: 700,
    textShadow: '0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff',
  },
  county: {
    fontSize: 10,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: BASEMAP_INK.neighbourLabel,
    fontWeight: 600,
  },
  // Halo, not a box: a boxed label reads as a tooltip sitting on top of the map, where
  // a haloed one reads as part of the drawing.
  route: {
    fontSize: 10.5,
    color: '#26221C',
    fontWeight: 700,
    textShadow: '0 0 3px #fff, 0 0 3px #fff, 0 0 2px #fff, 0 0 2px #fff',
  },
}

/**
 * Over imagery there is no pale ground to halo against, so the labels invert: light ink
 * with a dark halo. Same sizes and same hierarchy -- only the ink changes.
 */
const DARK_STYLES: Record<Placed['kind'], React.CSSProperties> = {
  township: { ...STYLES.township, color: '#D8D3C4', textShadow: '0 0 4px #000, 0 0 3px #000' },
  place: { ...STYLES.place, color: '#FFFFFF', textShadow: '0 0 4px #000, 0 0 3px #000, 0 0 2px #000' },
  county: { ...STYLES.county, color: '#C9C3B2', textShadow: '0 0 4px #000, 0 0 3px #000' },
  route: { ...STYLES.route, color: '#FFFFFF', textShadow: '0 0 4px #000, 0 0 3px #000, 0 0 2px #000' },
}
