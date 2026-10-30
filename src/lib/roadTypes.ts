/**
 * Surveyed-road data as written by scripts/survey/build_road.py.
 *
 * Every asset attribute carries its provenance: `measured` (computed from this survey's detections and geometry),
 * `derived` (computed from measured values), `public` (IDOT records) or `illustrative` (a placeholder showing what the
 * record holds once the county's own data is attached -- never a measurement).
 */
export type AttrSource = 'measured' | 'derived' | 'public' | 'illustrative' | 'coming' | 'estimate'

export interface Attr {
  value: string | number | boolean | null
  /** an estimate is a range [low, high]; value is its midpoint */
  range?: [number, number]
  unit: string | null
  source: AttrSource
  method: string
  spread?: number
  views?: number
  margin_ft?: number
}

export interface Evidence {
  image: string
  bbox: [number, number, number, number]
  station: string
  face: number
  distance_ft: number
  reviewed: boolean
}

export interface RoadAsset {
  id: string
  class: string
  subclass: string | null
  label: string
  lon: number
  lat: number
  line?: [number, number][]
  attrs: Record<string, Attr>
  evidence: Evidence[]
}

export interface ProfileRow {
  chainage_ft: number
  station: string
  x_ft: number
  y_ft: number
  lon: number
  lat: number
  z_ft: number
  grade_pct: number
  heading_deg: number
  curve_radius_ft: number | null
  curve_dir: 'left' | 'right' | null
  centre_offset_ft: number | null
  centre_type: string | null
  edge_line_L_ft: number | null
  edge_line_R_ft: number | null
  pavement_edge_L_ft: number | null
  pavement_edge_R_ft: number | null
  shoulder_edge_L_ft: number | null
  shoulder_edge_R_ft: number | null
  lane_width_L_ft: number | null
  lane_width_R_ft: number | null
  paved_width_ft: number | null
  shoulder_width_L_ft: number | null
  shoulder_width_R_ft: number | null
  idot_surface_width_ft?: number | null
  idot_lane_width_ft?: number | null
  idot_shoulder_width_ft?: number | null
  idot_seg: number | null
  road_name: string | null
  aadt: number | null
  aadt_year: string | null
  functional_class: string | null
  surface_type_code: number | null
  surface_year: string | null
  speed_limit_idot: number | null
  jurisdiction_code: string | null
  township: string | null
  lanes: number | null
}

export interface Crash {
  chainage_ft: number
  lon: number
  lat: number
  date: string | null
  year: number
  hour: number | null
  type: string
  severity: string
  light: string
  surface: string
  weather: string
  alignment: string
  cause: string
  vehicles: number
  intersection: string
}

export interface Pano {
  title: string
  ch: number
  x: number
  y: number
  lon: number
  lat: number
  z: number
  heading: number
  /** folder under data/roads/ holding faces 0-5 */
  pano: string
}

export interface Road {
  slug: string
  name: string
  track: string
  length_ft: number
  stations: number
  line: [number, number][]
  profile: ProfileRow[]
  crashes: Crash[]
  panos: Pano[]
  /** representative = the panoramas come from another surveyed road and only stand in for this one's */
  imagery: { representative: boolean; from: string }
  corrections?: { class: string; removed: number; reason: string }[]
  cross_streets?: { name: string; chainage_ft: number }[]
  quality?: { checked_on: string; checks: { what: string; how: string; result: string; status: 'shown' | 'coming' | 'synthetic' }[] } | null
  survey: { source: string; faces: number; faces_reviewed: number; camera_height_ft: number; crs: string }
  summary: { paved_width_ft_median: number; lane_width_ft_median: number }
}

export interface RoadIndexEntry {
  slug: string
  name: string
  length_ft: number
  assets: number
}

/** 2381.8 -> "23+82", the station notation on county plans. */
export function station(ft: number): string {
  const f = Math.round(ft)
  return `${Math.floor(f / 100)}+${String(f % 100).padStart(2, '0')}`
}

export function num(a: Attr | undefined): number | null {
  return a && typeof a.value === 'number' ? a.value : null
}

export const panoUrl = (p: Pano, face: number) => `data/roads/${p.pano}/${face}.jpg`

/** The panorama an evidence record refers to, by survey-stop title. */
export function panoFor(road: Road, title: string): Pano | undefined {
  return road.panos.find((p) => p.title === title)
}
