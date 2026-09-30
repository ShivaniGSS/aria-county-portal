/**
 * The basemaps the portal can draw the county on.
 *
 * The portal previously drew its own backdrop from raw TIGER polygons, because the
 * sandboxed embed blocks outbound requests. That guaranteed the map always rendered,
 * but hand-drawn county polygons never look like a surveyed basemap, and the product
 * itself will not run in a sandbox -- it runs in the county office and on GCP.
 *
 * So real basemaps are the default and the built-in vector backdrop is the fallback,
 * selected automatically when tiles cannot be reached. Every service here is free and
 * keyless; all were verified reachable before being listed.
 */
export interface Basemap {
  id: string
  label: string
  /** What it is good for, shown under the name in the picker. */
  note: string
  tiles?: string[]
  attribution: string
  /** True where the imagery is dark and labels/casings must invert. */
  dark?: boolean
  maxzoom?: number
}

export const BASEMAPS: Basemap[] = [
  {
    id: 'light-gray',
    label: 'Light gray canvas',
    note: 'Esri · built for thematic overlay',
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
    maxzoom: 16,
  },
  {
    id: 'topo',
    label: 'Topographic',
    note: 'USGS National Map',
    tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'USGS The National Map',
    maxzoom: 16,
  },
  {
    id: 'imagery',
    label: 'Aerial imagery',
    note: 'Esri World Imagery',
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri, Maxar, Earthstar Geographics, USDA FSA, USGS',
    dark: true,
    maxzoom: 18,
  },
  {
    id: 'streets',
    label: 'Street map',
    note: 'OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors',
    maxzoom: 18,
  },
  {
    id: 'builtin',
    label: 'Built-in (offline)',
    note: 'TIGER + IDOT, ships with the portal',
    attribution: 'US Census TIGER, IDOT District 2 Roads',
  },
]

export const DEFAULT_BASEMAP = BASEMAPS[0]
export const OFFLINE_BASEMAP = BASEMAPS[BASEMAPS.length - 1]

export function basemapById(id: string): Basemap {
  return BASEMAPS.find((b) => b.id === id) ?? DEFAULT_BASEMAP
}

/**
 * Can this tile service actually be reached?
 *
 * MapLibre does not reliably surface a blocked raster tile as an `error` event -- under
 * a sandbox CSP the request simply never completes -- so asking the network directly is
 * the only dependable check. One tile over Boone at county zoom, with a timeout.
 */
export function probeTiles(basemap: Basemap, timeoutMs = 6000): Promise<boolean> {
  if (!basemap.tiles) return Promise.resolve(false)
  // Tile covering Boone County at z10, in both the {z}/{x}/{y} and Esri {z}/{y}/{x} orders.
  const url = basemap.tiles[0]
    .replace('{z}', '10')
    .replace('{x}', '259')
    .replace('{y}', '379')
  return new Promise((resolve) => {
    const img = new Image()
    const done = (ok: boolean) => {
      clearTimeout(timer)
      img.onload = img.onerror = null
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    img.onload = () => done(true)
    img.onerror = () => done(false)
    img.src = url
  })
}
