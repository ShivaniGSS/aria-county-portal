import type * as maplibregl from 'maplibre-gl'
import { CONDITION_BANDS, conditionColor, type CountySegment } from './assetTypes'
import type { Basemap } from './basemaps'

/**
 * Condition -> band colour, as a MapLibre expression, so the map colours straight off a
 * feature property instead of the build baking a colour string into every road. Built
 * from CONDITION_BANDS so the map, the rail and the charts cannot drift apart.
 */
function conditionRamp(key: 'color' | 'tint') {
  return [
    'step',
    ['coalesce', ['get', 'condition'], -1],
    '#9b9b9b', // no condition at all: never coloured as though it had one
    0, CONDITION_BANDS[3][key],
    CONDITION_BANDS[2].min, CONDITION_BANDS[2][key],
    CONDITION_BANDS[1].min, CONDITION_BANDS[1][key],
    CONDITION_BANDS[0].min, CONDITION_BANDS[0][key],
  ] as unknown as maplibregl.ExpressionSpecification
}

export const CONDITION_COLOR_EXPR = conditionRamp('color')
export const CONDITION_TINT_EXPR = conditionRamp('tint')

/**
 * The portal draws its own basemap from public GIS shipped with it, rather than pulling
 * raster tiles. Tiles gave Rockford and Beloit the same visual weight as Boone's own
 * roads, and failed silently wherever outbound requests are blocked. Here the county
 * system is the only thing drawn in colour; everything else is deliberately recessive.
 */
export function baseStyle(basemap: Basemap): maplibregl.StyleSpecification {
  const style: maplibregl.StyleSpecification = {
    version: 8,
    sources: {},
    layers: [
      // Shows through until tiles arrive, and is the whole ground for the built-in map.
      { id: 'ground', type: 'background', paint: { 'background-color': basemap.dark ? '#1C1C1A' : '#EDEBE5' } },
    ],
  }
  if (basemap.tiles) {
    style.sources.basemap = {
      type: 'raster',
      tiles: basemap.tiles,
      tileSize: 256,
      maxzoom: basemap.maxzoom ?? 18,
      attribution: basemap.attribution,
    }
    style.layers.push({ id: 'basemap', type: 'raster', source: 'basemap' })
  }
  return style
}

/**
 * A single quiet palette for the backdrop. Nothing here competes for attention: the only
 * saturated ink on the map belongs to the condition ramp.
 */
const INK = {
  county: '#FCFBF8',
  township: '#C8C2B2',
  place: '#F1EFE8',
  placeEdge: '#E2DFD5',
  placeLabel: '#7E7768',
  water: '#D6E3EA',
  waterLine: '#BFD3DD',
  minorRoad: '#DEDBD2',
  majorRoad: '#C6C1B4',
  countyOutline: '#4F4A3E',
  neighbour: '#E5E2D9',
  neighbourEdge: '#D2CDBF',
  neighbourLabel: '#B3AC9B',
  stateLine: '#8E8672',
  /** White halo that lifts a condition-coloured line off the road grid beneath it. */
  halo: '#FFFFFF',
  /** Hairline casing that keeps a pale band (Fair) legible on a pale ground. */
  casing: 'rgba(52,47,38,0.42)',
}

/** A place or township name, with the point the page should draw it at. */
export interface MapLabel {
  name: string
  kind: 'township' | 'place' | 'county'
  lon: number
  lat: number
  /** Relative footprint, so small hamlets can drop out at low zoom. */
  area: number
}

interface BasemapLayers {
  roads?: GeoJSON.FeatureCollection
  neighbours?: GeoJSON.FeatureCollection
  neighbour_lines?: GeoJSON.FeatureCollection
  mask?: GeoJSON.FeatureCollection
  county?: GeoJSON.FeatureCollection
  townships?: GeoJSON.FeatureCollection
  places?: GeoJSON.FeatureCollection
  water_area?: GeoJSON.FeatureCollection
  water_line?: GeoJSON.FeatureCollection
  labels?: MapLabel[]
}

export async function basemapLabels(): Promise<MapLabel[]> {
  return (await loadBasemap()).labels ?? []
}

let basemapCache: Promise<BasemapLayers> | null = null
function loadBasemap(): Promise<BasemapLayers> {
  if (!basemapCache) basemapCache = fetch('data/basemap.json').then((r) => r.json())
  return basemapCache
}

/**
 * Draws the backdrop: county fill, townships, municipalities, water, and every road the
 * county does NOT maintain. `detail: 'mini'` drops the fine texture and the labels, which
 * only turn to noise at the floating map's size.
 */
export async function addBasemap(
  map: maplibregl.Map,
  detail: 'full' | 'mini' = 'full',
  /** 'vector' draws the whole backdrop ourselves; 'overlay' sits on real tiles, which
   *  already supply roads, water, places and their labels -- redrawing those on top
   *  would double every feature and is what made the map look hand-made. */
  backdrop: 'vector' | 'overlay' = 'vector',
  /** Over imagery the boundary has to be light, or it vanishes into the ground. */
  dark = false,
): Promise<[[number, number], [number, number]] | null> {
  const b = await loadBasemap()
  // A republish or a fast page switch can remove the map before the fetch lands.
  if (!map.getStyle() || map.getSource('bm-county')) return null
  const full = detail === 'full' && backdrop === 'vector'

  const add = (id: string, data?: GeoJSON.FeatureCollection) => {
    if (!data) return false
    map.addSource(`bm-${id}`, { type: 'geojson', data })
    return true
  }

  // Neighbouring counties first, so Boone sits inside a region instead of floating as a
  // white cut-out on a blank mat. They carry no roads and no condition -- they are not
  // this county's to report on -- but naming the land on all four sides is what stops the
  // boundary reading as the edge of the world.
  if (full && add('neighbours', b.neighbours)) {
    map.addLayer({
      id: 'bm-neighbour-fill', type: 'fill', source: 'bm-neighbours',
      paint: { 'fill-color': INK.neighbour },
    })
    // Outlines come from the real boundaries clipped to the window, not from the
    // clipped polygons' exteriors -- see build_basemap.py. Stroking the clipped
    // exterior drew the window's own box as though it were a county line.
    if (add('neighbour_lines', b.neighbour_lines)) {
      map.addLayer({
        id: 'bm-neighbour-line', type: 'line', source: 'bm-neighbour_lines',
        paint: { 'line-color': INK.neighbourEdge, 'line-width': 0.9 },
      })
      // The Illinois-Wisconsin line is a different order of boundary from a county line.
      map.addLayer({
        id: 'bm-state-line', type: 'line', source: 'bm-neighbour_lines',
        filter: ['==', ['get', 'state'], '55'],
        paint: { 'line-color': INK.stateLine, 'line-width': 1.6, 'line-opacity': 0.55 },
      })
    }
  }

  // The county is painted light and everything beyond it is knocked back, so the
  // jurisdiction the engineer is responsible for is legible at a glance.
  if (add('county', b.county) && full) {
    map.addLayer({
      id: 'bm-county-fill', type: 'fill', source: 'bm-county',
      paint: { 'fill-color': INK.county },
    })
  }
  if (full && add('water_area', b.water_area)) {
    map.addLayer({
      id: 'bm-water-fill', type: 'fill', source: 'bm-water_area',
      paint: { 'fill-color': INK.water },
    })
  }
  if (full && add('water_line', b.water_line)) {
    map.addLayer({
      id: 'bm-water-line', type: 'line', source: 'bm-water_line',
      // Hairline, and only once you are close enough for a creek to mean anything.
      paint: {
        'line-color': INK.waterLine,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.3, 12, 0.7, 15, 1.3],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1],
      },
    })
  }
  if (full && add('places', b.places)) {
    map.addLayer({
      id: 'bm-place-fill', type: 'fill', source: 'bm-places',
      paint: { 'fill-color': INK.place },
    })
    map.addLayer({
      id: 'bm-place-line', type: 'line', source: 'bm-places',
      paint: { 'line-color': INK.placeEdge, 'line-width': 0.8 },
    })
  }
  if (add('roads', b.roads)) {
    if (backdrop === 'overlay') {
      // Only the thematic register. The tiles underneath already drew the streets.
      const w = (a: number, b2: number, c: number) =>
        ['interpolate', ['linear'], ['zoom'], 9, a, 12, b2, 15, c] as unknown as maplibregl.ExpressionSpecification
      map.addLayer({
        id: 'bm-cond-synthetic', type: 'line', source: 'bm-roads',
        filter: ['==', ['get', 'tier'], 'synthetic'],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': CONDITION_TINT_EXPR, 'line-width': w(0.6, 1.3, 2.3) },
      })
      map.addLayer({
        id: 'bm-cond-measured', type: 'line', source: 'bm-roads',
        filter: ['==', ['get', 'tier'], 'measured'],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': CONDITION_TINT_EXPR, 'line-width': w(1.1, 2.3, 3.8) },
      })
    } else if (detail === 'mini') {
      // The locator keeps a plain grey network: colour there would compete with the one
      // segment it exists to point at.
      map.addLayer({
        id: 'bm-road-grey', type: 'line', source: 'bm-roads',
        paint: {
          'line-color': INK.minorRoad,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.3, 12, 0.9],
        },
      })
    } else {
      // Roads outside the county's jurisdiction, in three stacked registers:
      //   grey      -- the plain street network, always drawn, so the county's own
      //                segments sit on a legible ground rather than in a void;
      //   tinted    -- the same roads carrying condition, subordinate by LIGHTNESS.
      //                Transparency was tried first and muddied every colour it
      //                crossed; a lighter step of the same band keeps hues honest.
      // Tier splits the tinted register: a real IDOT reading draws at full weight, a
      // synthetic stand-in draws hairline, so 366 miles of unsurveyed township road
      // can never be mistaken for surveyed.
      const w = (a: number, b: number, c: number) =>
        ['interpolate', ['linear'], ['zoom'], 9, a, 12, b, 15, c] as unknown as maplibregl.ExpressionSpecification
      map.addLayer({
        id: 'bm-road-minor', type: 'line', source: 'bm-roads',
        filter: ['!', ['get', 'major']],
        paint: { 'line-color': INK.minorRoad, 'line-width': w(0.4, 0.9, 1.7) },
      })
      map.addLayer({
        id: 'bm-road-major', type: 'line', source: 'bm-roads',
        filter: ['get', 'major'],
        paint: { 'line-color': INK.majorRoad, 'line-width': w(0.9, 1.9, 3.2) },
      })
      map.addLayer({
        id: 'bm-cond-synthetic', type: 'line', source: 'bm-roads',
        filter: ['==', ['get', 'tier'], 'synthetic'],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': CONDITION_TINT_EXPR, 'line-width': w(0.5, 1.1, 2.0) },
      })
      map.addLayer({
        id: 'bm-cond-measured', type: 'line', source: 'bm-roads',
        filter: ['==', ['get', 'tier'], 'measured'],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': CONDITION_TINT_EXPR, 'line-width': w(1.0, 2.1, 3.6) },
      })
    }
  }
  if (full && add('townships', b.townships)) {
    map.addLayer({
      id: 'bm-township-line', type: 'line', source: 'bm-townships',
      paint: { 'line-color': INK.township, 'line-width': 1, 'line-dasharray': [4, 3] },
    })
  }
  // Everything OUTSIDE Boone is knocked back, and the boundary is a hairline sitting on
  // the edge of that mask. Boone is genuinely rectangular, so a heavy outline around it
  // reads as a frame drawn on the map rather than as a jurisdiction; dimming the
  // surroundings says "this is the study area" without drawing a box at all.
  if (add('mask', b.mask)) {
    map.addLayer({
      id: 'bm-mask', type: 'fill', source: 'bm-mask',
      paint: {
        'fill-color': dark ? '#14140F' : '#FBFAF7',
        'fill-opacity': dark ? 0.52 : 0.62,
      },
    })
  }
  if (b.county) {
    map.addLayer({
      id: 'bm-county-line', type: 'line', source: 'bm-county',
      paint: {
        'line-color': dark ? '#E8E4D8' : '#6B6455',
        'line-width': 1,
        'line-opacity': 0.55,
      },
    })
  }
  // The county line, not the road network, is what the map should frame: the road
  // extent leaves dead space wherever the county system doesn't reach the border.
  return b.county ? boundsOf(b.county) : null
}

function boundsOf(fc: GeoJSON.FeatureCollection): [[number, number], [number, number]] {
  let minX = 180, minY = 90, maxX = -180, maxY = -90
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0])
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1])
    } else if (Array.isArray(c)) c.forEach(visit)
  }
  for (const f of fc.features) visit((f.geometry as { coordinates?: unknown }).coordinates)
  return [[minX, minY], [maxX, maxY]]
}

/**
 * The geometry file carries inventory attributes; condition lives in the asset model.
 * Join them so the map can style straight off feature properties, and resolve the band
 * colour here so the map and the rail can never disagree about what colour a road is.
 */
export function mergeConditionOntoGeometry(
  geometry: GeoJSON.FeatureCollection,
  bySegment: Map<string, CountySegment>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geometry.features.map((f) => {
      const seg = bySegment.get(String(f.properties?.segment_id))
      return {
        ...f,
        properties: {
          ...f.properties,
          condition_now: seg?.condition_now ?? null,
          tier: seg?.tier ?? 'synthetic',
          color: seg ? conditionColor(seg.condition_now) : '#898781',
        },
      }
    }),
  }
}

/** Every coordinate of a segment, for fitting a map to it. */
export function segmentCoordinates(feature: GeoJSON.Feature): [number, number][] {
  const g = feature.geometry
  if (g.type === 'MultiLineString') return g.coordinates.flat() as [number, number][]
  if (g.type === 'LineString') return g.coordinates as [number, number][]
  return []
}

export { INK as BASEMAP_INK }
