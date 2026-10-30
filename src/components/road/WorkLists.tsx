import { useMemo, type ReactNode } from 'react'
import { IconSvg } from '../../lib/assetStyle'
import { num, station, type Road, type RoadAsset } from '../../lib/roadTypes'
import { curves, download, rowsToCsv, stretches } from '../../lib/roadChecks'

interface Props {
  road: Road
  assets: RoadAsset[]
  clearZoneFt: number
  setClearZoneFt: (v: number) => void
  leanDeg: number
  setLeanDeg: (v: number) => void
  narrowFt: number
  setNarrowFt: (v: number) => void
  onSelect: (id: string) => void
  onPick: (ft: number) => void
}

const v = (a: RoadAsset, k: string) => a.attrs[k]?.value
const n1 = (x: number | null, unit = '') => (x === null ? '—' : `${x.toFixed(1)}${unit}`)
const sta = (a: RoadAsset) => String(v(a, 'station') ?? '')
const byCh = (a: RoadAsset, b: RoadAsset) => (num(a.attrs.chainage_ft) ?? 0) - (num(b.attrs.chainage_ft) ?? 0)

export function WorkLists(p: Props) {
  const signs = useMemo(() => p.assets.filter((a) => a.class === 'sign').sort(byCh), [p.assets])
  const signIssues = signs.filter((a) => !String(v(a, 'mutcd_2A15_height') ?? 'meets').startsWith('meets') || !String(v(a, 'mutcd_2A16_lateral') ?? 'meets').startsWith('meets'))
  const poles = p.assets.filter((a) => a.class === 'utility_pole' || a.class === 'light_pole')
  const inZone = poles.filter((a) => (num(a.attrs.offset_travelled_way_ft) ?? 99) < p.clearZoneFt).sort(byCh)
  const leaning = poles.filter((a) => (num(a.attrs.lean_deg) ?? 0) >= p.leanDeg).sort((a, b) => (num(b.attrs.lean_deg) ?? 0) - (num(a.attrs.lean_deg) ?? 0))
  const leanReady = poles.some((a) => num(a.attrs.lean_deg) !== null)
  const cv = useMemo(() => curves(p.road.profile, p.assets), [p.road, p.assets])
  const narrow = useMemo(() => stretches(p.road.profile, (r) => r.paved_width_ft, p.narrowFt), [p.road, p.narrowFt])
  const crashesNear = (a: number, b: number) => p.road.crashes.filter((c) => c.chainage_ft >= a - 200 && c.chainage_ft <= b + 200).length

  const zones = useMemo(() => {
    const t: Record<string, number> = {}
    for (const r of p.road.profile) if (r.centre_type) t[r.centre_type] = (t[r.centre_type] ?? 0) + 25
    return Object.entries(t).sort((a, b) => b[1] - a[1])
  }, [p.road])

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: 'var(--page)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 20px 48px', display: 'grid', gap: 18 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'end', padding: 14, background: 'var(--surface-1)', border: '1px solid var(--gridline)', borderRadius: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 360 }}>
            Thresholds are the county's decision. Change them and every list and map flag updates.
          </div>
          <Slider id="cz" label="Clear zone from travelled way" value={p.clearZoneFt} min={4} max={30} step={1} unit="ft" onChange={p.setClearZoneFt} />
          {leanReady && <Slider id="lean" label="Pole lean screening" value={p.leanDeg} min={2} max={15} step={0.5} unit="°" onChange={p.setLeanDeg} />}
          <Slider id="narrow" label="Narrow pavement below" value={p.narrowFt} min={18} max={26} step={0.5} unit="ft" onChange={p.setNarrowFt} />
        </div>

        <Card title="Sign placement against MUTCD" count={signIssues.length} of={signs.length}
          rule="Rural roadside signs: lower edge ≥ 5 ft above the near pavement edge (2A.15); post ≥ 12 ft from the edge of the travelled way (2A.16) is coming up: it is measured from the road the sign serves, which needs sign orientation. Borderline means the margin is inside the measurement spread: a tape measure settles it."
          onExport={() => download(`${p.road.slug}-sign-placement.csv`, rowsToCsv(['station', 'sign', 'serves', 'lower_edge_ft', 'offset_travelled_way_ft', 'height_check', 'lateral_check', 'lon', 'lat'],
            signIssues.map((a) => [sta(a), a.label, v(a, 'serves_traffic'), v(a, 'bottom_height_ft'), v(a, 'offset_travelled_way_ft'), v(a, 'mutcd_2A15_height'), v(a, 'mutcd_2A16_lateral'), a.lon, a.lat])))}>
          <Table head={['Sta.', 'Sign', 'Serves', 'Lower edge', 'From travelled way', 'Height (2A.15)', 'Offset (2A.16)']}
            rows={signIssues.map((a) => ({ id: a.id, cells: [sta(a), <Lbl a={a} />, String(v(a, 'serves_traffic') ?? ''), n1(num(a.attrs.bottom_height_ft), ' ft'), n1(num(a.attrs.offset_travelled_way_ft), ' ft'),
              <Verdict s={String(v(a, 'mutcd_2A15_height') ?? '—')} />, <Verdict s={String(v(a, 'mutcd_2A16_lateral') ?? '—')} />] }))} onRow={p.onSelect} />
        </Card>

        <Card title="Fixed objects inside the clear zone" count={inZone.length} of={poles.length}
          rule={`Utility and light poles closer than ${p.clearZoneFt} ft to the edge of the travelled way. Candidates for relocation, shielding or delineation.`}
          onExport={() => download(`${p.road.slug}-clear-zone.csv`, rowsToCsv(['station', 'object', 'side', 'offset_travelled_way_ft', 'lean_deg', 'x_ft', 'y_ft', 'lon', 'lat'],
            inZone.map((a) => [sta(a), a.label, v(a, 'side'), v(a, 'offset_travelled_way_ft'), v(a, 'lean_deg'), v(a, 'x_ft'), v(a, 'y_ft'), a.lon, a.lat])))}>
          <Table head={['Sta.', 'Object', 'Side', 'From travelled way', 'Lean', 'Crashes ±200 ft']}
            rows={inZone.map((a) => {
              const ch = num(a.attrs.chainage_ft) ?? 0
              return { id: a.id, cells: [sta(a), <Lbl a={a} />, String(v(a, 'side')), n1(num(a.attrs.offset_travelled_way_ft), ' ft'), n1(num(a.attrs.lean_deg), '°'), String(crashesNear(ch, ch))] }
            })} onRow={p.onSelect} />
        </Card>

        <Card title="Horizontal curves" count={cv.filter((c) => !c.signed).length} of={cv.length} countLabel="without a curve sign nearby"
          rule="Curves tighter than 1,000 ft radius from the survey path, the nearest curve or arrow warning sign, and crashes within 200 ft. Advisory speed needs a ball-bank or superelevation reading."
          onExport={() => download(`${p.road.slug}-curves.csv`, rowsToCsv(['start_station', 'end_station', 'length_ft', 'min_radius_ft', 'direction', 'warning_sign_within_750ft', 'crashes_within_200ft'],
            cv.map((c) => [station(c.start_ft), station(c.end_ft), Math.round(c.end_ft - c.start_ft), Math.round(c.min_radius_ft), c.dir, c.signed ? 'yes' : 'no', crashesNear(c.start_ft, c.end_ft)])))}>
          <Table head={['From', 'To', 'Length', 'Tightest radius', 'Direction', 'Curve sign within 750 ft', 'Crashes']}
            rows={cv.map((c, i) => ({ id: `curve-${i}`, ft: c.start_ft, cells: [station(c.start_ft), station(c.end_ft), `${Math.round(c.end_ft - c.start_ft)} ft`, `${Math.round(c.min_radius_ft).toLocaleString()} ft`, c.dir,
              c.signed ? <Verdict s={`yes · Sta. ${c.nearestSign?.attrs.station?.value}`} /> : <Verdict s="none found" />, String(crashesNear(c.start_ft, c.end_ft))] }))}
            onRowFt={p.onPick} />
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18 }}>
          <Card title="Narrow pavement" count={narrow.length} countLabel="stretches"
            rule={`Paved width below ${p.narrowFt} ft for at least 100 ft, from the detected pavement edges.`}
            onExport={() => download(`${p.road.slug}-narrow.csv`, rowsToCsv(['from', 'to', 'length_ft', 'min_width_ft'], narrow.map((s) => [station(s.start_ft), station(s.end_ft), Math.round(s.end_ft - s.start_ft), s.min.toFixed(1)])))}>
            <Table head={['From', 'To', 'Length', 'Narrowest']} rows={narrow.map((s, i) => ({ id: `n${i}`, ft: s.start_ft, cells: [station(s.start_ft), station(s.end_ft), `${Math.round(s.end_ft - s.start_ft)} ft`, `${s.min.toFixed(1)} ft`] }))} onRowFt={p.onPick} />
          </Card>
          {leanReady ? (
            <Card title="Leaning poles" count={leaning.length} of={poles.length} rule={`Lean of ${p.leanDeg}° or more, from the pole's outline in views from different directions. A screening flag for the utility.`}
              onExport={() => download(`${p.road.slug}-leaning-poles.csv`, rowsToCsv(['station', 'object', 'lean_deg', 'leans_toward', 'lon', 'lat'], leaning.map((a) => [sta(a), a.label, v(a, 'lean_deg'), v(a, 'lean_toward'), a.lon, a.lat])))}>
              <Table head={['Sta.', 'Object', 'Lean', 'Toward']} rows={leaning.map((a) => ({ id: a.id, cells: [sta(a), <Lbl a={a} />, n1(num(a.attrs.lean_deg), '°'), String(v(a, 'lean_toward') ?? '—')] }))} onRow={p.onSelect} />
            </Card>
          ) : <ComingUp title="Leaning poles" why="Needs full-length pole outlines: the current detector often stops below the pole top, too short to trust a lean angle." />}
          <Card title="Passing zones" count={zones.length} countLabel="centre-line types" rule="Length of road under each centre-line marking, from the detected centre line (majority over ~225 ft). Checked against the photos at 21 places: 19 agree; the 2 misses were at marking changes near intersections.">
            <Table head={['Marking', 'Length', 'Share']} rows={zones.map(([k, ft]) => ({ id: k, cells: [k, `${(ft / 5280).toFixed(2)} mi`, `${Math.round((ft / zones.reduce((s, z) => s + z[1], 0)) * 100)}%`] }))} />
          </Card>
        </div>

        <Card title="Crashes on this road, 2014–2020" count={p.road.crashes.length} rule="IDOT crash records within 75 ft of the surveyed path. Fixed-object and animal crashes are the ones roadside conditions most affect."
          onExport={() => download(`${p.road.slug}-crashes.csv`, rowsToCsv(['station', 'date', 'type', 'severity', 'light', 'surface', 'weather', 'alignment', 'cause', 'lon', 'lat'],
            p.road.crashes.map((c) => [station(c.chainage_ft), c.date, c.type, c.severity, c.light, c.surface, c.weather, c.alignment, c.cause, c.lon, c.lat])))}>
          <Table head={['Sta.', 'Date', 'Type', 'Severity', 'Light', 'Surface', 'Alignment']}
            rows={p.road.crashes.map((c, i) => ({ id: `c${i}`, ft: c.chainage_ft, cells: [station(c.chainage_ft), c.date ?? String(c.year), c.type, c.severity, c.light, c.surface, c.alignment] }))} onRowFt={p.onPick} />
        </Card>
      </div>
    </div>
  )
}

function Slider(p: { id: string; label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label htmlFor={p.id} style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-secondary)', minWidth: 200 }}>
      <span>{p.label}: <b style={{ color: 'var(--text-primary)' }}>{p.value} {p.unit}</b></span>
      <input id={p.id} type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  )
}

function ComingUp(p: { title: string; why: string }) {
  return (
    <section style={{ background: 'var(--surface-1)', border: '1px dashed var(--border)', borderRadius: 10, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <b style={{ fontSize: 15 }}>{p.title}</b>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#5b6670', background: 'rgba(91,102,112,0.12)', padding: '2px 6px', borderRadius: 4 }}>Coming up</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6 }}>{p.why}</div>
    </section>
  )
}

function Card(p: { title: string; count: number; of?: number; countLabel?: string; rule: string; onExport?: () => void; children: ReactNode }) {
  return (
    <section style={{ background: 'var(--surface-1)', border: '1px solid var(--gridline)', borderRadius: 10, overflow: 'hidden', minWidth: 0 }}>
      <div style={{ padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', borderBottom: '1px solid var(--gridline)' }}>
        <b style={{ fontSize: 15 }}>{p.title}</b>
        <span style={{ fontSize: 13, color: p.count ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          <b style={{ fontSize: 18 }}>{p.count}</b>{p.of !== undefined ? ` of ${p.of}` : ''} {p.countLabel ?? ''}
        </span>
        {p.onExport && <button onClick={p.onExport} style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer' }}>Export CSV</button>}
        <div style={{ flexBasis: '100%', fontSize: 12.5, color: 'var(--text-secondary)' }}>{p.rule}</div>
      </div>
      <div style={{ maxHeight: 340, overflow: 'auto' }}>{p.children}</div>
    </section>
  )
}

function Table(p: { head: string[]; rows: { id: string; ft?: number; cells: ReactNode[] }[]; onRow?: (id: string) => void; onRowFt?: (ft: number) => void }) {
  if (!p.rows.length) return <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>Nothing on this road meets the condition.</div>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead><tr>{p.head.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>
        {p.rows.map((r) => (
          <tr key={r.id} onClick={() => (p.onRow ? p.onRow(r.id) : r.ft !== undefined && p.onRowFt?.(r.ft))} style={{ cursor: p.onRow || p.onRowFt ? 'pointer' : 'default' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--page)')} onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
            {r.cells.map((c, i) => <td key={i} style={{ ...td, fontFamily: i === 0 ? 'ui-monospace, Menlo, monospace' : undefined }}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Lbl({ a }: { a: RoadAsset }) {
  return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><IconSvg a={a} size={13} />{a.label}</span>
}

export function Verdict({ s }: { s: string }) {
  const tone = s.startsWith('meets') || s.startsWith('yes') ? '#1f6b3d' : s.startsWith('borderline') ? '#8a5a00' : s === '—' ? 'var(--text-muted)' : '#b3261e'
  return <span style={{ color: tone, fontWeight: 600 }}>{s.replace(' (within measurement spread)', '')}</span>
}

const th: React.CSSProperties = { position: 'sticky', top: 0, background: 'var(--surface-1)', textAlign: 'left', padding: '8px 12px', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--gridline)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '7px 12px', borderBottom: '1px solid var(--gridline)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
