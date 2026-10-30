/**
 * Work lists: the questions an engineer asks of a surveyed road, answered from its assets and profile.
 * Thresholds that are the county's call (clear zone, lean) are parameters, set in the UI.
 */
import { num, station, type ProfileRow, type Road, type RoadAsset } from './roadTypes'

export type Severity = 'fail' | 'borderline' | 'note'

export interface Finding {
  severity: Severity
  text: string
}

/** Everything about one asset that deserves a second look. */
export function findings(a: RoadAsset, opts: { clearZoneFt: number; leanDeg: number }): Finding[] {
  const out: Finding[] = []
  const v = (k: string) => a.attrs[k]?.value
  const h = v('mutcd_2A15_height')
  if (typeof h === 'string' && h.startsWith('below')) out.push({ severity: 'fail', text: 'Sign lower edge below the 5 ft rural minimum (MUTCD 2A.15)' })
  else if (typeof h === 'string' && h.startsWith('borderline')) out.push({ severity: 'borderline', text: 'Sign height within measurement spread of the 5 ft minimum' })
  const l = v('mutcd_2A16_lateral')
  if (typeof l === 'string' && l.startsWith('less')) out.push({ severity: 'fail', text: 'Sign closer than the recommended 12 ft from the travelled way (MUTCD 2A.16)' })
  else if (typeof l === 'string' && l.startsWith('borderline')) out.push({ severity: 'borderline', text: 'Sign offset within measurement spread of 12 ft' })
  const tw = num(a.attrs.offset_travelled_way_ft)
  if ((a.class === 'utility_pole' || a.class === 'light_pole') && tw !== null && tw < opts.clearZoneFt)
    out.push({ severity: 'fail', text: `Fixed object ${tw.toFixed(1)} ft from the travelled way, inside the ${opts.clearZoneFt} ft clear zone` })
  const lean = num(a.attrs.lean_deg)
  if (lean !== null && lean >= opts.leanDeg) out.push({ severity: 'note', text: `Pole leans ${lean.toFixed(1)}° (screening threshold ${opts.leanDeg}°)` })
  return out
}

export interface Curve {
  start_ft: number
  end_ft: number
  min_radius_ft: number
  dir: 'left' | 'right'
  signed: boolean
  nearestSign: RoadAsset | null
}

const CURVE_SIGNS = new Set(['curve', 'two_direction_arrow', 'warning_other'])

/** Horizontal curves tighter than `maxRadius`, and whether a curve warning sign stands within `reachFt` of each. */
export function curves(p: ProfileRow[], assets: RoadAsset[], maxRadius = 1000, reachFt = 750): Curve[] {
  const out: Curve[] = []
  let cur: Curve | null = null
  for (const r of p) {
    const tight = r.curve_radius_ft !== null && r.curve_radius_ft < maxRadius
    if (tight && !cur) cur = { start_ft: r.chainage_ft, end_ft: r.chainage_ft, min_radius_ft: r.curve_radius_ft!, dir: r.curve_dir ?? 'left', signed: false, nearestSign: null }
    else if (tight && cur) {
      cur.end_ft = r.chainage_ft
      if (r.curve_radius_ft! < cur.min_radius_ft) {
        cur.min_radius_ft = r.curve_radius_ft!
        cur.dir = r.curve_dir ?? cur.dir
      }
    } else if (!tight && cur) {
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  const signs = assets.filter((a) => a.class === 'sign' && CURVE_SIGNS.has(a.subclass ?? ''))
  // the first and last few hundred feet are turns onto and off the surveyed road, not curves on it
  const len = p.length ? p[p.length - 1].chainage_ft : 0
  return out
    .filter((c) => c.end_ft - c.start_ft >= 50 && c.start_ft > 300 && c.end_ft < len - 300)
    .map((c) => {
      let best: RoadAsset | null = null
      let bd = Infinity
      for (const s of signs) {
        const ch = num(s.attrs.chainage_ft) ?? 0
        const d = ch < c.start_ft ? c.start_ft - ch : ch > c.end_ft ? ch - c.end_ft : 0
        if (d < bd) {
          bd = d
          best = s
        }
      }
      return { ...c, signed: bd <= reachFt, nearestSign: best }
    })
}

/** Stretches where a profile value falls below a threshold (e.g. narrow pavement). */
export function stretches(p: ProfileRow[], pick: (r: ProfileRow) => number | null, below: number, minLenFt = 100) {
  const out: { start_ft: number; end_ft: number; min: number }[] = []
  let cur: { start_ft: number; end_ft: number; min: number } | null = null
  for (const r of p) {
    const v = pick(r)
    if (v !== null && v < below) {
      if (!cur) cur = { start_ft: r.chainage_ft, end_ft: r.chainage_ft, min: v }
      else {
        cur.end_ft = r.chainage_ft
        cur.min = Math.min(cur.min, v)
      }
    } else if (cur) {
      if (cur.end_ft - cur.start_ft >= minLenFt) out.push(cur)
      cur = null
    }
  }
  if (cur && cur.end_ft - cur.start_ft >= minLenFt) out.push(cur)
  return out
}

/** Profile row nearest a chainage. */
export function rowAt(road: Road, ft: number): ProfileRow {
  const p = road.profile
  const i = Math.max(0, Math.min(p.length - 1, Math.round(ft / 25 - 0.5)))
  return p[i]
}

// ---------- exports ----------

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function assetsToCsv(assets: RoadAsset[]): string {
  const keys = Array.from(new Set(assets.flatMap((a) => Object.keys(a.attrs))))
  const unit = (k: string) => assets.find((a) => a.attrs[k])?.attrs[k].unit
  const head = ['id', 'class', 'type', 'lon', 'lat', ...keys.map((k) => (unit(k) ? `${k} (${unit(k)})` : k)), ...keys.map((k) => `${k} source`)]
  const rows = assets.map((a) => [a.id, a.class, a.label, a.lon, a.lat, ...keys.map((k) => a.attrs[k]?.value), ...keys.map((k) => a.attrs[k]?.source)])
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

export function assetsToGeoJson(assets: RoadAsset[]): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: assets.map((a) => ({
      type: 'Feature',
      geometry: a.line ? { type: 'LineString', coordinates: a.line } : { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        id: a.id,
        class: a.class,
        type: a.label,
        ...Object.fromEntries(Object.entries(a.attrs).map(([k, v]) => [k, v.value])),
        sources: Object.fromEntries(Object.entries(a.attrs).map(([k, v]) => [k, v.source])),
      },
    })),
  })
}

export function rowsToCsv(head: string[], rows: unknown[][]): string {
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

export function download(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export { station }

/** Linear interpolation across missing values; ends take the nearest known value, all-missing takes the fallback. */
export function fillGaps(v: (number | null)[], fallback: number): number[] {
  const known = v.map((x, i) => [i, x] as const).filter(([, x]) => x !== null) as [number, number][]
  if (!known.length) return v.map(() => fallback)
  return v.map((x, i) => {
    if (x !== null) return x
    const prev = [...known].reverse().find(([j]) => j < i)
    const next = known.find(([j]) => j > i)
    if (prev && next) return prev[1] + ((next[1] - prev[1]) * (i - prev[0])) / (next[0] - prev[0])
    return (prev ?? next)![1]
  })
}

/** Per profile row: were this road's lane lines seen here? Short gaps (an intersection, a dropped frame) count as seen; runs under ~150 ft don't. */
export function markingsSeen(rows: { pavement_edge_L_ft: number | null; pavement_edge_R_ft: number | null; centre_offset_ft: number | null }[], maxGap = 6, minRun = 6): boolean[] {
  const raw = rows.map((r) => r.pavement_edge_L_ft !== null || r.pavement_edge_R_ft !== null || r.centre_offset_ft !== null)
  const out = [...raw]
  let i = 0
  while (i < raw.length) {
    if (raw[i]) { i++; continue }
    let j = i
    while (j < raw.length && !raw[j]) j++
    if (j - i < maxGap && i > 0 && j < raw.length) for (let k = i; k < j; k++) out[k] = true
    i = j
  }
  // and isolated islands (a few stray detections on an unmarked road) don't count as marked road
  i = 0
  while (i < out.length) {
    if (!out[i]) { i++; continue }
    let j = i
    while (j < out.length && out[j]) j++
    if (j - i < minRun) for (let k = i; k < j; k++) out[k] = false
    i = j
  }
  // and a marked stretch has to be the usual state of its surroundings (±500 ft), not a burst of false detections
  const W = 20
  return out.map((v, k) => {
    if (!v) return false
    const win = out.slice(Math.max(0, k - W), k + W + 1)
    return win.filter(Boolean).length >= win.length * 0.5
  })
}
