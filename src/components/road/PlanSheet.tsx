import { useEffect, useMemo, useRef, useState } from 'react'
import { CLASSES, IconSvg } from '../../lib/assetStyle'
import { num, station, type ProfileRow, type Road, type RoadAsset } from '../../lib/roadTypes'
import { fillGaps, markingsSeen } from '../../lib/roadChecks'
import { MARKING_STYLE } from './StreetView'

/**
 * Plan sheet: the road seen from above and straightened out, read left to right in the survey direction.
 * The left side of the road (relative to travel) is drawn on top, the right side underneath — the way the road would
 * look on a plan if you turned it so you drive to the right. Everything below the drawing (elevation, IDOT record)
 * shares the same station scale, so a vertical line through the sheet is one place on the road.
 */
interface Props {
  road: Road
  assets: RoadAsset[]
  flagged: Map<string, 'fail' | 'borderline' | 'note'>
  selectedId: string | null
  onSelect: (id: string) => void
  panoIndex: number
  setPanoIndex: (i: number) => void
  compact?: boolean
}

const GUTTER = 92
const LAT_FT = 42 // half-width of the drawn corridor, ft either side of the centre line
const SPANS = [500, 1000, 2500] as const
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
const compass = (d: number) => COMPASS[Math.round((((d % 360) + 360) % 360) / 45) % 8]
const COL = {
  grass: '#e9efe1', pavement: '#9aa0a6', shoulder: '#d8c39a', edge: '#ffffff', centre: '#f2b705', cross: '#b9bec3',
  text: 'var(--text-primary)', muted: 'var(--text-muted)', grid: 'rgba(0,0,0,0.08)',
}

export function PlanSheet(p: Props) {
  const L = p.road.length_ft
  const prof = p.road.profile
  const xs = p.road.cross_streets ?? []
  const pano = p.road.panos[p.panoIndex]
  const [view, setView] = useState({ start: Math.max(0, (pano?.ch ?? 0) - 400), span: 1000 })
  const [size, setSize] = useState({ w: 900, h: 300 })
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null)
  const [look, setLook] = useState<number | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const h = (e: Event) => setLook((e as CustomEvent).detail as number)
    window.addEventListener('road:heading', h)
    return () => window.removeEventListener('road:heading', h)
  }, [])

  const clampView = (start: number, span: number) => {
    const s = Math.max(200, Math.min(L, span))
    return { start: Math.max(0, Math.min(L - s, start)), span: s }
  }
  const centreOn = (ft: number, span = view.span) => setView(clampView(ft - span / 2, span))

  // keep the street-view position and the selected asset in sight
  useEffect(() => {
    if (pano && (pano.ch < view.start + view.span * 0.05 || pano.ch > view.start + view.span * 0.95)) centreOn(pano.ch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pano?.ch])
  useEffect(() => {
    const a = p.assets.find((x) => x.id === p.selectedId)
    const ch = a ? num(a.attrs.chainage_ft) : null
    if (ch !== null && (ch < view.start || ch > view.start + view.span)) centreOn(ch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selectedId])

  const W = Math.max(100, size.w - GUTTER)
  const X = (ft: number) => GUTTER + ((ft - view.start) / view.span) * W
  const FT = (px: number) => view.start + ((px - GUTTER) / W) * view.span
  const H = size.h
  const Y = (lat: number) => H / 2 + (lat / LAT_FT) * (H / 2 - 14)
  const exaggeration = ((H / 2 - 14) / LAT_FT) / (W / view.span)

  // survey direction and which compass side is "left"
  const heading = useMemo(() => {
    const a = p.road.line[0]
    const b = p.road.line[p.road.line.length - 1]
    return (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI
  }, [p.road])
  const leftSide = compass(heading - 90)
  const rightSide = compass(heading + 90)

  const rows = useMemo(() => prof.filter((r) => r.chainage_ft >= view.start - 50 && r.chainage_ft <= view.start + view.span + 50), [prof, view])
  const seenAll = useMemo(() => markingsSeen(prof), [prof])
  const seenAt = (r: ProfileRow) => seenAll[Math.floor(r.chainage_ft / 25)] ?? false
  const med = (k: keyof ProfileRow, d: number) => {
    const v = prof.map((r) => r[k] as number | null).filter((x): x is number => x !== null).sort((a, b) => a - b)
    return v.length ? v[Math.floor(v.length / 2)] : d
  }
  const geom = useMemo(() => {
    const g = (k: keyof ProfileRow, d: number) => fillGaps(rows.map((r) => r[k] as number | null), med(k, d))
    return { peL: g('pavement_edge_L_ft', -10.3), peR: g('pavement_edge_R_ft', 10.3) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  // measured-only lines: break wherever the value is missing (so gaps read as "not measured", not as road)
  const runs = (k: keyof ProfileRow) => {
    const out: string[] = []
    let cur: [number, number][] = []
    for (const r of rows) {
      const v = seenAt(r) ? (r[k] as number | null) : null
      if (v === null) {
        if (cur.length > 1) out.push(path(cur))
        cur = []
      } else cur.push([X(r.chainage_ft), Y(v)])
    }
    if (cur.length > 1) out.push(path(cur))
    return out
  }
  const shoulderAreas = (side: 'L' | 'R') => {
    const out: string[] = []
    let seg: ProfileRow[] = []
    const flush = () => {
      if (seg.length > 1) {
        const top = seg.map((r) => [X(r.chainage_ft), Y(r[`shoulder_edge_${side}_ft`] as number)] as [number, number])
        const bot = seg.map((r) => [X(r.chainage_ft), Y(r[`pavement_edge_${side}_ft`] as number)] as [number, number]).reverse()
        out.push(path([...top, ...bot]) + 'Z')
      }
      seg = []
    }
    for (const r of rows) {
      if (seenAt(r) && r[`shoulder_edge_${side}_ft`] !== null && r[`pavement_edge_${side}_ft`] !== null) seg.push(r)
      else flush()
    }
    flush()
    return out
  }
  // stretches where the lane lines were seen; elsewhere the road is drawn hatched as "not detected"
  const seenRuns = useMemo(() => {
    const seen = rows.map(seenAt)
    const out: { seen: boolean; i0: number; i1: number; gravel: boolean }[] = []
    rows.forEach((r, i) => {
      const last = out[out.length - 1]
      if (last && last.seen === seen[i]) last.i1 = i
      else out.push({ seen: seen[i], i0: i, i1: i, gravel: false })
    })
    // IDOT surface type 200 on Beaverton's north end is an unmarked gravel surface (checked in the photos)
    for (const r of out) if (!r.seen) r.gravel = rows.slice(r.i0, r.i1 + 1).filter((x) => x.surface_type_code === 200).length > (r.i1 - r.i0 + 1) / 2
    return out
  }, [rows])
  const areaOf = (i0: number, i1: number) => {
    const ix = rows.map((_, i) => i).filter((i) => i >= Math.max(0, i0 - 1) && i <= Math.min(rows.length - 1, i1 + 1))
    return path([...ix.map((i) => [X(rows[i].chainage_ft), Y(geom.peL[i])] as [number, number]), ...ix.map((i) => [X(rows[i].chainage_ft), Y(geom.peR[i])] as [number, number]).reverse()]) + 'Z'
  }
  const centreRuns = useMemo(() => {
    const out: { type: string | null; x0: number; x1: number }[] = []
    const seen = rows.map(seenAt)
    for (const [i, r0] of rows.entries()) {
      const r = { ...r0, centre_type: seen[i] ? r0.centre_type : 'none' }
      const last = out[out.length - 1]
      const x0 = X(r.chainage_ft - 12.5)
      const x1 = X(r.chainage_ft + 12.5)
      if (last && last.type === r.centre_type) last.x1 = x1
      else out.push({ type: r.centre_type, x0, x1 })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, size, view])

  const ticks = useMemo(() => {
    const step = view.span <= 600 ? 50 : view.span <= 1500 ? 100 : 250
    const major = step * (view.span <= 600 ? 2 : 5)
    const out: { ft: number; major: boolean }[] = []
    for (let f = Math.ceil(view.start / step) * step; f <= view.start + view.span; f += step) out.push({ ft: f, major: f % major === 0 })
    return out
  }, [view])

  const inView = p.assets.filter((a) => {
    const ch = num(a.attrs.chainage_ft)
    return ch !== null && ch >= view.start - 20 && ch <= view.start + view.span + 20
  })
  const latOf = (a: RoadAsset) => {
    const off = num(a.attrs.offset_centre_ft) ?? 20
    const s = (a.attrs.side?.value === 'left' ? -1 : 1) * off
    return Math.max(-LAT_FT + 3, Math.min(LAT_FT - 3, s))
  }

  // interaction: drag to pan, wheel to zoom about the cursor, click to stand there in street view
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-asset]')) return
    drag.current = { x: e.clientX, start: view.start, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    if (drag.current) {
      const dx = e.clientX - drag.current.x
      if (Math.abs(dx) > 3) drag.current.moved = true
      setView(clampView(drag.current.start - (dx / W) * view.span, view.span))
      return
    }
    if (px < GUTTER) return setHover(null)
    const ft = FT(px)
    const lat = ((py - H / 2) / (H / 2 - 14)) * LAT_FT
    const x = xs.find((c) => Math.abs(c.chainage_ft - ft) < 40)
    setHover({ x: px, y: py, text: `Sta. ${station(ft)} · ${Math.abs(lat).toFixed(0)} ft ${lat < 0 ? 'left' : 'right'} of centre${x ? ` · ${x.name}` : ''}` })
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const ft = FT(e.clientX - rect.left)
      let best = 0
      p.road.panos.forEach((q, i) => { if (Math.abs(q.ch - ft) < Math.abs(p.road.panos[best].ch - ft)) best = i })
      p.setPanoIndex(best)
    }
  }
  const onWheel = (e: React.WheelEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return setView(clampView(view.start + (e.deltaX / W) * view.span, view.span))
    const at = FT(e.clientX - rect.left)
    const span = view.span * Math.exp(e.deltaY * 0.002)
    const s = clampView(at - ((at - view.start) / view.span) * span, span)
    setView(s)
  }

  // overview: the whole road, with the drawn window
  const OW = Math.max(100, size.w - GUTTER)
  const OX = (ft: number) => GUTTER + (ft / L) * OW
  const density = useMemo(() => {
    const bins = new Array(Math.ceil(L / 250)).fill(0)
    for (const a of p.assets) {
      const ch = num(a.attrs.chainage_ft)
      if (ch !== null) bins[Math.min(bins.length - 1, Math.floor(ch / 250))]++
    }
    return bins
  }, [p.assets, L])
  const maxD = Math.max(1, ...density)
  const ovDrag = useRef<number | null>(null)
  const ovFt = (e: React.PointerEvent) => ((e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left - GUTTER) / OW) * L

  // elevation and IDOT record, aligned to the same window
  const zs = rows.map((r) => r.z_ft)
  const zMin = Math.min(...zs) - 1
  const zMax = Math.max(...zs) + 1
  const records = useMemo(() => {
    const out: { x0: number; x1: number; text: string }[] = []
    for (const r of rows) {
      const t = [r.aadt ? `${r.aadt.toLocaleString()} veh/day` : null, r.speed_limit_idot && Number(r.speed_limit_idot) > 0 ? `${r.speed_limit_idot} mph` : null,
        r.idot_surface_width_ft ? `${r.idot_surface_width_ft} ft surface` : null, r.idot_shoulder_width_ft ? `${r.idot_shoulder_width_ft} ft shoulders` : null]
        .filter(Boolean).join(' · ') || 'no IDOT record'
      const last = out[out.length - 1]
      if (last && last.text === t) last.x1 = X(r.chainage_ft + 12.5)
      else out.push({ x0: X(r.chainage_ft - 12.5), x1: X(r.chainage_ft + 12.5), text: t })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, size, view])

  const lookRel = look !== null && pano ? look - pano.heading : 0
  const carX = pano ? X(pano.ch) : -99
  const carY = Y((rows.find((r) => Math.abs(r.chainage_ft - (pano?.ch ?? 0)) < 13)?.centre_offset_ft ?? -1.7) * -1)
  const sel = p.assets.find((a) => a.id === p.selectedId)

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-1)', fontSize: 12 }}>
      {/* title + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: p.compact ? '6px 12px' : '10px 14px', borderBottom: '1px solid var(--gridline)', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: p.compact ? 13 : 15 }}>Plan sheet</b>
          <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>
            {p.road.name} seen from above and straightened out. You drive left → right ({compass(heading)}bound); the {leftSide} side of the road is on top.
            {!p.compact && ' Click anywhere to stand there in street view; drag to slide along, scroll to zoom.'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button style={btn} onClick={() => setView(clampView(view.start - view.span * 0.8, view.span))} aria-label="Slide back along the road">◀</button>
          {SPANS.map((s) => (
            <button key={s} style={{ ...btn, ...(Math.abs(view.span - s) < 1 ? btnOn : {}) }} onClick={() => centreOn(view.start + view.span / 2, s)}>{s.toLocaleString()} ft</button>
          ))}
          <button style={{ ...btn, ...(view.span >= L - 1 ? btnOn : {}) }} onClick={() => setView({ start: 0, span: L })}>Whole road</button>
          <button style={btn} onClick={() => setView(clampView(view.start + view.span * 0.8, view.span))} aria-label="Slide forward along the road">▶</button>
        </div>
      </div>

      {/* overview */}
      <div style={{ position: 'relative', height: 40, flex: 'none', borderBottom: '1px solid var(--gridline)', cursor: 'pointer', touchAction: 'none' }}
        onPointerDown={(e) => { ovDrag.current = ovFt(e) - view.start; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); if (ovFt(e) < view.start || ovFt(e) > view.start + view.span) { centreOn(ovFt(e)); ovDrag.current = view.span / 2 } }}
        onPointerMove={(e) => { if (ovDrag.current !== null) setView(clampView(ovFt(e) - ovDrag.current, view.span)) }}
        onPointerUp={() => { ovDrag.current = null }}>
        <div style={gutterLabel}>Whole road<br /><span style={{ color: COL.muted }}>{(L / 5280).toFixed(1)} mi</span></div>
        <svg width="100%" height="40" style={{ display: 'block' }}>
          <rect x={GUTTER} y={22} width={OW} height={6} rx={3} fill={COL.pavement} />
          {density.map((d, i) => d > 0 && <rect key={i} x={OX(i * 250)} y={20 - (d / maxD) * 12} width={Math.max(1, OW / density.length - 1)} height={(d / maxD) * 12} fill="#7a8794" opacity={0.6} />)}
          {xs.map((c) => (
            <g key={c.name + c.chainage_ft}>
              <line x1={OX(c.chainage_ft)} x2={OX(c.chainage_ft)} y1={18} y2={32} stroke="#555" strokeWidth={1.5} />
              <text x={OX(c.chainage_ft) + 3} y={39} fontSize={9.5} fill="#555">{c.name}</text>
            </g>
          ))}
          <rect x={OX(view.start)} y={2} width={Math.max(4, (view.span / L) * OW)} height={34} fill="rgba(42,120,214,0.12)" stroke="#2a78d6" strokeWidth={1.5} rx={3} />
          {pano && <circle cx={OX(pano.ch)} cy={25} r={4} fill="#ffd23f" stroke="#111" strokeWidth={1.5} />}
        </svg>
      </div>

      {/* station ruler */}
      <svg width="100%" height={22} style={{ display: 'block', flex: 'none' }}>
        <text x={8} y={15} fontSize={10.5} fill="currentColor" opacity={0.6}>Station</text>
        {ticks.map((t) => (
          <g key={t.ft}>
            <line x1={X(t.ft)} x2={X(t.ft)} y1={t.major ? 12 : 16} y2={22} stroke="#888" />
            {t.major && <text x={X(t.ft) + 3} y={11} fontSize={10.5} fill="currentColor">{station(t.ft)}</text>}
          </g>
        ))}
      </svg>

      {/* the plan */}
      <div ref={plotRef} style={{ position: 'relative', flex: 1, minHeight: p.compact ? 110 : 200, overflow: 'hidden', cursor: drag.current ? 'grabbing' : 'crosshair', touchAction: 'none' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)} onWheel={onWheel}>
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          <rect x={GUTTER} y={0} width={W} height={H} fill={COL.grass} />
          {ticks.filter((t) => t.major).map((t) => <line key={t.ft} x1={X(t.ft)} x2={X(t.ft)} y1={0} y2={H} stroke={COL.grid} />)}
          {/* cross streets */}
          {xs.filter((c) => c.chainage_ft > view.start - 50 && c.chainage_ft < view.start + view.span + 50).map((c) => (
            <g key={c.name + c.chainage_ft}>
              <rect x={X(c.chainage_ft - 11)} y={0} width={Math.max(3, X(c.chainage_ft + 11) - X(c.chainage_ft - 11))} height={H} fill={COL.cross} />
              <text x={X(c.chainage_ft) + 4} y={13} fontSize={11} fontWeight={700} fill="#3c4146">{c.name}</text>
            </g>
          ))}
          {/* road surface */}
          <defs>
            <clipPath id="plan-clip"><rect x={GUTTER} y={0} width={W} height={H} /></clipPath>
            <pattern id="plan-gravel" width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="#cdbb98" /><circle cx="1.5" cy="1.5" r="0.9" fill="#a8946d" /><circle cx="4.5" cy="4" r="0.7" fill="#b9a67f" />
            </pattern>
            <pattern id="plan-nodata" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="8" height="8" fill="#c9cdd1" /><line x1="0" y1="0" x2="0" y2="8" stroke="#aeb3b8" strokeWidth="3" />
            </pattern>
          </defs>
          <g clipPath="url(#plan-clip)">
          {rows.length > 1 && seenRuns.map((r, i) => <path key={'a' + i} d={areaOf(r.i0, r.i1)} fill={r.seen ? COL.pavement : r.gravel ? 'url(#plan-gravel)' : 'url(#plan-nodata)'} />)}
          {seenRuns.filter((r) => !r.seen && X(rows[r.i1].chainage_ft) - X(rows[r.i0].chainage_ft) > 170).map((r) => {
            const x = (Math.max(GUTTER, X(rows[r.i0].chainage_ft)) + Math.min(GUTTER + W, X(rows[r.i1].chainage_ft))) / 2
            return <text key={'t' + r.i0} x={x} y={H / 2 + 4} textAnchor="middle" fontSize={11} fill="#4b5560" fontWeight={600}>{r.gravel ? 'Gravel surface · no lane markings' : 'Lane lines not detected here'}</text>
          })}
          {(['L', 'R'] as const).flatMap((s) => shoulderAreas(s)).map((d, i) => <path key={'s' + i} d={d} fill={COL.shoulder} />)}
          {(['pavement_edge_L_ft', 'pavement_edge_R_ft'] as const).flatMap((k) => runs(k)).map((d, i) => <path key={'p' + i} d={d} fill="none" stroke={MARKING_STYLE.pavement.color} strokeWidth={2} />)}
          {(['edge_line_L_ft', 'edge_line_R_ft'] as const).flatMap((k) => runs(k)).map((d, i) => <path key={'e' + i} d={d} fill="none" stroke={COL.edge} strokeWidth={1.6} />)}
          {/* centre line, drawn the way it is painted */}
          {centreRuns.map((r, i) => {
            const y = H / 2
            const solid = { stroke: COL.centre, strokeWidth: 2 }
            const dashed = { ...solid, strokeDasharray: '7 9' }
            if (r.type === 'none') return null
            if (!r.type) return <line key={i} x1={r.x0} x2={r.x1} y1={y} y2={y} stroke="#6b7177" strokeDasharray="2 4" strokeWidth={1.2} />
            if (r.type.startsWith('double')) return <g key={i}><line x1={r.x0} x2={r.x1} y1={y - 2.2} y2={y - 2.2} {...solid} /><line x1={r.x0} x2={r.x1} y1={y + 2.2} y2={y + 2.2} {...solid} /></g>
            if (r.type.startsWith('solid')) return <g key={i}><line x1={r.x0} x2={r.x1} y1={y - 2.2} y2={y - 2.2} {...solid} /><line x1={r.x0} x2={r.x1} y1={y + 2.2} y2={y + 2.2} {...dashed} /></g>
            return <line key={i} x1={r.x0} x2={r.x1} y1={y} y2={y} {...dashed} />
          })}
          </g>
          {/* you are here: street-view position and look direction */}
          {pano && carX > GUTTER && carX < GUTTER + W && (
            <g transform={`translate(${carX},${carY})`}>
              <path d="M0,0 L46,-17 A49,49 0 0 1 46,17 Z" fill="rgba(42,120,214,0.28)" transform={`rotate(${lookRel})`} />
              <rect x={-8} y={-5} width={16} height={10} rx={3} fill="#ffd23f" stroke="#111" strokeWidth={1.5} />
            </g>
          )}
          {/* side labels */}
          <text x={GUTTER + 6} y={22} fontSize={10.5} fill="#4b5560" fontWeight={700} letterSpacing="0.05em">LEFT · {leftSide.toUpperCase()} SIDE</text>
          <text x={GUTTER + 6} y={H - 8} fontSize={10.5} fill="#4b5560" fontWeight={700} letterSpacing="0.05em">RIGHT · {rightSide.toUpperCase()} SIDE</text>
        </svg>

        {/* gutter labels */}
        <div style={{ ...gutterLabel, top: 0, bottom: 0, height: 'auto', display: 'grid', alignContent: 'center' }}>
          Plan view<br /><span style={{ color: COL.muted, fontWeight: 400 }}>from above</span>
        </div>

        {/* assets: drawn at their measured station and distance from the centre line */}
        {inView.map((a) => {
          const ch = num(a.attrs.chainage_ft)!
          const x = X(ch)
          if (x < GUTTER + 4 || x > GUTTER + W - 4) return null
          const y = Y(latOf(a))
          const f = p.flagged.get(a.id)
          const isSel = a.id === p.selectedId
          const label = a.class === 'sign' ? a.label.split(' (')[0] : null
          return (
            <button key={a.id} data-asset onClick={() => p.onSelect(a.id)} title={`${a.label} · Sta. ${station(ch)} · ${num(a.attrs.offset_centre_ft)?.toFixed(0)} ft ${a.attrs.side?.value} of centre`}
              style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%,-50%)', border: 0, padding: 0, background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ display: 'grid', placeItems: 'center', width: isSel ? 24 : 18, height: isSel ? 24 : 18, borderRadius: 999, background: '#fff',
                boxShadow: isSel ? '0 0 0 3px #2a78d6' : f === 'fail' ? '0 0 0 2.5px #e5383b' : f === 'borderline' ? '0 0 0 2.5px #f0a020' : '0 1px 3px rgba(0,0,0,0.35)' }}>
                <IconSvg a={a} size={isSel ? 15 : 12} />
              </span>
              {label && view.span <= 1500 && <span style={{ fontSize: 10.5, fontWeight: 600, background: 'rgba(255,255,255,0.85)', padding: '0 3px', borderRadius: 3, whiteSpace: 'nowrap' }}>{label}</span>}
            </button>
          )
        })}

        {hover && !drag.current && (
          <div style={{ position: 'absolute', left: Math.min(hover.x + 12, size.w - 260), top: Math.max(4, hover.y - 30), pointerEvents: 'none', background: 'rgba(17,20,24,0.85)', color: '#fff', padding: '3px 8px', borderRadius: 5, fontSize: 11.5, whiteSpace: 'nowrap' }}>
            {hover.text}
          </div>
        )}
      </div>

      {!p.compact && (
        <>
          {/* elevation */}
          <div style={{ position: 'relative', height: 64, flex: 'none', borderTop: '1px solid var(--gridline)' }}>
            <div style={gutterLabel}>Elevation<br /><span style={{ color: COL.muted, fontWeight: 400 }}>{Math.round(zMin + 1)}–{Math.round(zMax - 1)} ft</span></div>
            <svg width="100%" height="64" style={{ display: 'block' }}>
              {rows.length > 1 && (() => {
                const yz = (z: number) => 6 + (1 - (z - zMin) / Math.max(1, zMax - zMin)) * 50
                const line = path(rows.map((r) => [X(r.chainage_ft), yz(r.z_ft)] as [number, number]))
                return (
                  <>
                    <path d={`${line}L${X(rows[rows.length - 1].chainage_ft)},60L${X(rows[0].chainage_ft)},60Z`} fill="rgba(42,120,214,0.1)" />
                    <path d={line} fill="none" stroke="#2a78d6" strokeWidth={1.6} />
                    {rows.filter((_, i) => i % Math.max(1, Math.round(rows.length / 8)) === 4 && Math.abs(_.grade_pct) >= 1).map((r) => (
                      <text key={r.chainage_ft} x={X(r.chainage_ft)} y={yz(r.z_ft) - 4} fontSize={10} fill="#2a5f9e" textAnchor="middle">{r.grade_pct > 0 ? '↗' : '↘'} {Math.abs(r.grade_pct).toFixed(1)}%</text>
                    ))}
                  </>
                )
              })()}
            </svg>
          </div>
          {/* IDOT record */}
          <div style={{ position: 'relative', height: 30, flex: 'none', borderTop: '1px solid var(--gridline)' }}>
            <div style={gutterLabel}>IDOT record</div>
            <svg width="100%" height="30" style={{ display: 'block' }}>
              {records.map((r, i) => {
                const x0 = Math.max(GUTTER, r.x0)
                const x1 = Math.min(GUTTER + W, r.x1)
                if (x1 - x0 < 2) return null
                return (
                  <g key={i}>
                    <rect x={x0} y={5} width={x1 - x0 - 1} height={20} fill={r.text === 'no IDOT record' ? 'transparent' : 'rgba(109,83,0,0.08)'} stroke="rgba(109,83,0,0.25)" />
                    {x1 - x0 > r.text.length * 5.6 && <text x={x0 + 6} y={19} fontSize={10.5} fill="#6d5300">{r.text}</text>}
                  </g>
                )
              })}
            </svg>
          </div>
        </>
      )}

      {/* legend */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', padding: '6px 14px', borderTop: '1px solid var(--gridline)', fontSize: 11.5, color: 'var(--text-secondary)' }}>
        <Sw c={COL.pavement} t="Pavement" />
        <Sw c={COL.shoulder} t="Shoulder (where detected)" />
        <Sw c="#cdbb98" t="Gravel, unmarked" />
        <span style={leg}><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={MARKING_STYLE.pavement.color} strokeWidth="2" /></svg>Pavement edge</span>
        <span style={leg}><svg width="22" height="10"><line x1="0" x2="22" y1="2.5" y2="2.5" stroke={COL.centre} strokeWidth="2" /><line x1="0" x2="22" y1="7.5" y2="7.5" stroke={COL.centre} strokeWidth="2" /></svg>No passing</span>
        <span style={leg}><svg width="22" height="10"><line x1="0" x2="22" y1="2.5" y2="2.5" stroke={COL.centre} strokeWidth="2" /><line x1="0" x2="22" y1="7.5" y2="7.5" stroke={COL.centre} strokeWidth="2" strokeDasharray="5 4" /></svg>Passing one way</span>
        <span style={leg}><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={COL.centre} strokeWidth="2" strokeDasharray="5 4" /></svg>Passing allowed</span>
        <Sw c={COL.cross} t="Cross street" />
        {CLASSES.filter((c) => p.assets.some((a) => a.class === c.id)).map((c) => (
          <span key={c.id} style={leg}><span style={{ width: 9, height: 9, borderRadius: 999, background: c.color }} />{c.plural}</span>
        ))}
        <span style={leg}><span style={{ width: 14, height: 9, borderRadius: 2, background: '#ffd23f', border: '1.5px solid #111' }} />You are here</span>
        {!p.compact && <span style={{ marginLeft: 'auto', color: COL.muted }}>Across-road distances drawn {exaggeration >= 1.5 ? `${exaggeration.toFixed(0)}× wider` : 'to scale'} than along-road, so the assets are readable.</span>}
        {sel && <span style={{ color: COL.muted }}>Selected: <b style={{ color: 'var(--text-primary)' }}>{sel.label}</b></span>}
      </div>
    </div>
  )
}

function Sw({ c, t }: { c: string; t: string }) {
  return <span style={leg}><span style={{ width: 16, height: 9, borderRadius: 2, background: c }} />{t}</span>
}

const leg: React.CSSProperties = { display: 'inline-flex', gap: 5, alignItems: 'center', whiteSpace: 'nowrap' }
const gutterLabel: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: GUTTER - 8, height: '100%', padding: '4px 0 0 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.25, pointerEvents: 'none', display: 'grid', alignContent: 'center' }
const btn: React.CSSProperties = { fontSize: 12, padding: '4px 9px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap' }
const btnOn: React.CSSProperties = { background: 'var(--series-blue)', borderColor: 'var(--series-blue)', color: '#fff' }
