/**
 * How each asset class looks: colour, display name, and a map icon drawn on a canvas (signs in their real MUTCD
 * shapes and colours, so a curve sign reads as a yellow diamond on the map just as it does at the roadside).
 */
import type { RoadAsset } from './roadTypes'

export interface ClassMeta {
  id: string
  label: string
  plural: string
  color: string
  linear?: boolean
}

export const CLASSES: ClassMeta[] = [
  { id: 'sign', label: 'Sign', plural: 'Signs', color: '#e0a800' },
  { id: 'utility_pole', label: 'Utility pole', plural: 'Utility poles', color: '#7a5230' },
  { id: 'light_pole', label: 'Light pole', plural: 'Light poles', color: '#d98e04' },
  { id: 'mailbox', label: 'Mailbox', plural: 'Mailboxes', color: '#2a78d6' },
  { id: 'driveway', label: 'Driveway / field access', plural: 'Driveways', color: '#6f7a83' },
  { id: 'guardrail', label: 'Guardrail', plural: 'Guardrail runs', color: '#9aa7b4', linear: true },
  { id: 'fence', label: 'Fence line', plural: 'Fence lines', color: '#a0784a', linear: true },
]

export const classMeta = (id: string): ClassMeta => CLASSES.find((c) => c.id === id) ?? CLASSES[0]

const WARNING = new Set(['curve', 'intersection', 'stop_ahead', 'two_direction_arrow', 'warning_other'])

/** The icon id an asset is drawn with. */
export function iconFor(a: RoadAsset): string {
  if (a.class !== 'sign') return `ic-${a.class}`
  const s = a.subclass ?? ''
  if (s === 'no_passing_zone') return 'ic-sign-pennant'
  if (s === 'stop') return 'ic-sign-stop'
  if (s === 'street_name') return 'ic-sign-guide'
  if (WARNING.has(s)) return 'ic-sign-warning'
  return 'ic-sign-regulatory'
}

type Draw = (c: CanvasRenderingContext2D, s: number) => void

const ring = (fill: string, inner?: string): Draw => (c, s) => {
  c.beginPath()
  c.arc(s / 2, s / 2, s * 0.32, 0, Math.PI * 2)
  c.fillStyle = '#ffffff'
  c.fill()
  c.beginPath()
  c.arc(s / 2, s / 2, s * 0.25, 0, Math.PI * 2)
  c.fillStyle = fill
  c.fill()
  if (inner) {
    c.beginPath()
    c.arc(s / 2, s / 2, s * 0.1, 0, Math.PI * 2)
    c.fillStyle = inner
    c.fill()
  }
}

const poly = (pts: [number, number][], fill: string, stroke = '#111', lw = 0.06): Draw => (c, s) => {
  c.beginPath()
  pts.forEach(([x, y], i) => (i ? c.lineTo(x * s, y * s) : c.moveTo(x * s, y * s)))
  c.closePath()
  c.fillStyle = fill
  c.fill()
  c.lineWidth = lw * s
  c.strokeStyle = stroke
  c.stroke()
}

const halo = (d: Draw): Draw => (c, s) => {
  c.save()
  c.shadowColor = 'rgba(0,0,0,0.45)'
  c.shadowBlur = s * 0.08
  d(c, s)
  c.restore()
}

const octagon = (): [number, number][] => {
  const r = 0.4
  return Array.from({ length: 8 }, (_, i) => {
    const t = Math.PI / 8 + (i * Math.PI) / 4
    return [0.5 + r * Math.cos(t), 0.5 + r * Math.sin(t)] as [number, number]
  })
}

const ICONS: Record<string, Draw> = {
  'ic-utility_pole': ring('#7a5230'),
  'ic-light_pole': ring('#7a5230', '#ffd23f'),
  'ic-mailbox': (c, s) => {
    poly([[0.2, 0.3], [0.8, 0.3], [0.8, 0.7], [0.2, 0.7]], '#ffffff', '#ffffff', 0.12)(c, s)
    poly([[0.25, 0.35], [0.75, 0.35], [0.75, 0.65], [0.25, 0.65]], '#2a78d6', '#2a78d6', 0.01)(c, s)
  },
  'ic-driveway': (c, s) => {
    poly([[0.3, 0.2], [0.7, 0.2], [0.7, 0.8], [0.3, 0.8]], '#ffffff', '#ffffff', 0.1)(c, s)
    poly([[0.35, 0.25], [0.65, 0.25], [0.65, 0.75], [0.35, 0.75]], '#6f7a83', '#6f7a83', 0.01)(c, s)
  },
  'ic-sign-warning': poly([[0.5, 0.08], [0.92, 0.5], [0.5, 0.92], [0.08, 0.5]], '#ffd200'),
  'ic-sign-pennant': poly([[0.08, 0.22], [0.92, 0.5], [0.08, 0.78]], '#ffd200'),
  'ic-sign-regulatory': poly([[0.22, 0.1], [0.78, 0.1], [0.78, 0.9], [0.22, 0.9]], '#ffffff'),
  'ic-sign-stop': poly(octagon(), '#c8102e', '#ffffff', 0.07),
  'ic-sign-guide': poly([[0.08, 0.3], [0.92, 0.3], [0.92, 0.7], [0.08, 0.7]], '#00653a', '#ffffff', 0.06),
}

/** Raster icons for MapLibre's addImage, drawn at 2x for sharp edges. */
export function iconImages(px = 28): { id: string; image: ImageData }[] {
  const s = px * 2
  return Object.entries(ICONS).map(([id, draw]) => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = s
    const c = cv.getContext('2d')!
    halo(draw)(c, s)
    return { id, image: c.getImageData(0, 0, s, s) }
  })
}

/** Same shapes as inline SVG, for the strip diagram and lists. */
export function IconSvg({ a, size = 14 }: { a: RoadAsset; size?: number }) {
  const id = iconFor(a)
  const common = { stroke: '#111', strokeWidth: 1 }
  let shape
  if (id === 'ic-sign-warning') shape = <polygon points="7,1 13,7 7,13 1,7" fill="#ffd200" {...common} />
  else if (id === 'ic-sign-pennant') shape = <polygon points="1,3 13,7 1,11" fill="#ffd200" {...common} />
  else if (id === 'ic-sign-stop') shape = <polygon points="4,1 10,1 13,4 13,10 10,13 4,13 1,10 1,4" fill="#c8102e" stroke="#fff" />
  else if (id === 'ic-sign-guide') shape = <rect x="1" y="4" width="12" height="6" fill="#00653a" stroke="#fff" />
  else if (id === 'ic-sign-regulatory') shape = <rect x="3" y="1" width="8" height="12" fill="#fff" {...common} />
  else if (id === 'ic-mailbox') shape = <rect x="2" y="4" width="10" height="6" rx="1" fill="#2a78d6" stroke="#fff" />
  else if (id === 'ic-driveway') shape = <rect x="4" y="2" width="6" height="10" fill="#6f7a83" stroke="#fff" />
  else if (id === 'ic-light_pole') shape = (
    <>
      <circle cx="7" cy="7" r="5" fill="#7a5230" stroke="#fff" />
      <circle cx="7" cy="7" r="2" fill="#ffd23f" />
    </>
  )
  else shape = <circle cx="7" cy="7" r="5" fill={classMeta(a.class).color} stroke="#fff" />
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" style={{ flex: 'none' }}>
      {shape}
    </svg>
  )
}

/** Plain-language names for attribute keys, in the order the record shows them. */
export const ATTR_LABELS: Record<string, string> = {
  station: 'Station',
  chainage_ft: 'Distance along road',
  side: 'Side of road',
  x_ft: 'Easting (x)',
  y_ft: 'Northing (y)',
  z_ft: 'Elevation (z)',
  offset_centre_ft: 'From centre line',
  offset_travelled_way_ft: 'From edge of travelled way',
  offset_pavement_edge_ft: 'From pavement edge',
  offset_shoulder_edge_ft: 'From outer shoulder edge',
  sign_type: 'Sign type',
  serves_traffic: 'Serves traffic',
  bottom_height_ft: 'Lower edge height',
  top_height_ft: 'Upper edge height',
  panel_width_in: 'Panel width',
  panel_height_in: 'Panel height',
  mutcd_2A15_height: 'MUTCD 2A.15 mounting height',
  mutcd_2A16_lateral: 'MUTCD 2A.16 lateral offset',
  base_vs_road_ft: 'Base relative to road',
  height_ft: 'Height above ground',
  lean_deg: 'Lean',
  lean_toward: 'Leans toward',
  top_height_in: 'Top of box height',
  usps_height: 'USPS height guidance',
  width_ft: 'Width',
  start_chainage_ft: 'Starts at',
  end_chainage_ft: 'Ends at',
  length_ft: 'Length',
  seen_from_stations: 'Seen from survey stops',
  detections: 'Image detections',
  position_residual_ft: 'Position agreement',
  detector_confidence: 'Detector confidence',
  human_reviewed: 'Checked by a person',
  sheeting: 'Sheeting',
  install_year: 'Install year',
  retroreflectivity: 'Retroreflectivity',
  post: 'Post',
  owner: 'Owner',
  material: 'Material',
  end_treatment: 'End treatment',
  rail_height: 'Rail height',
}

export const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Location', keys: ['station', 'side', 'x_ft', 'y_ft', 'z_ft', 'start_chainage_ft', 'end_chainage_ft'] },
  { title: 'Clearances from the road', keys: ['offset_centre_ft', 'offset_travelled_way_ft', 'offset_pavement_edge_ft', 'offset_shoulder_edge_ft'] },
  {
    title: 'Dimensions and condition',
    keys: ['sign_type', 'serves_traffic', 'bottom_height_ft', 'top_height_ft', 'panel_width_in', 'panel_height_in', 'base_vs_road_ft',
      'height_ft', 'lean_deg', 'lean_toward', 'top_height_in', 'width_ft', 'length_ft'],
  },
  { title: 'Detection and confidence', keys: ['seen_from_stations', 'detections', 'position_residual_ft', 'detector_confidence', 'human_reviewed'] },
  { title: 'County record', keys: ['sheeting', 'install_year', 'retroreflectivity', 'post', 'owner', 'material', 'end_treatment', 'rail_height'] },
]

export const CHECK_KEYS = ['mutcd_2A15_height', 'mutcd_2A16_lateral', 'usps_height']

export const SOURCE_LABEL: Record<string, string> = {
  measured: 'Measured',
  derived: 'Derived',
  public: 'Public record',
  illustrative: 'Synthetic example',
  coming: 'Coming up',
  estimate: 'Estimate',
  checked: 'Checked',
}
