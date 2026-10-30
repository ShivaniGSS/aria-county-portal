import { useMemo, useState } from 'react'
import { CLASSES, IconSvg } from '../../lib/assetStyle'
import { num, type Road, type RoadAsset } from '../../lib/roadTypes'
import { assetsToCsv, assetsToGeoJson, download, type Finding } from '../../lib/roadChecks'

interface Props {
  road: Road
  assets: RoadAsset[]
  findingsOf: (a: RoadAsset) => Finding[]
  onSelect: (id: string) => void
}

type Col = { id: string; label: string; get: (a: RoadAsset) => string | number | null; mono?: boolean }

const keyMeasure = (a: RoadAsset): string => {
  const f = (k: string, u: string, d = 1) => {
    const at = a.attrs[k]
    if (at?.range) return `${at.range[0]}–${at.range[1]}${u}`
    return num(at) === null ? null : `${num(at)!.toFixed(d)}${u}`
  }
  switch (a.class) {
    case 'sign': return [f('bottom_height_ft', ' ft high'), f('panel_width_in', ' in wide', 0)].filter(Boolean).join(', ')
    case 'utility_pole':
    case 'light_pole': return [f('height_ft', ' ft'), f('lean_deg', '° lean')].filter(Boolean).join(', ')
    case 'mailbox': return f('top_height_in', ' in to top', 0) ?? ''
    case 'driveway': return f('width_ft', ' ft wide') ?? ''
    default: return f('length_ft', ' ft long', 0) ?? ''
  }
}

export function InventoryTable(p: Props) {
  const [cls, setCls] = useState<string>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 }>({ id: 'station', dir: 1 })

  const cols: Col[] = [
    { id: 'station', label: 'Station', get: (a) => num(a.attrs.chainage_ft) ?? num(a.attrs.start_chainage_ft), mono: true },
    { id: 'type', label: 'Asset', get: (a) => a.label },
    { id: 'side', label: 'Side', get: (a) => String(a.attrs.side?.value ?? '') },
    { id: 'offset', label: 'From travelled way (ft)', get: (a) => num(a.attrs.offset_travelled_way_ft) },
    { id: 'measure', label: 'Key measurement', get: keyMeasure },
    { id: 'x', label: 'x (ft)', get: (a) => num(a.attrs.x_ft), mono: true },
    { id: 'y', label: 'y (ft)', get: (a) => num(a.attrs.y_ft), mono: true },
    { id: 'z', label: 'z (ft)', get: (a) => num(a.attrs.z_ft), mono: true },
    { id: 'conf', label: 'Seen from', get: (a) => num(a.attrs.seen_from_stations) },
    { id: 'flags', label: 'Needs attention', get: (a) => p.findingsOf(a).map((f) => f.text).join('; ') },
  ]

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const r = p.assets.filter((a) => (cls === 'all' || a.class === cls) && (!ql || a.label.toLowerCase().includes(ql) || a.id.includes(ql) || String(a.attrs.station?.value ?? '').includes(ql)))
    const c = cols.find((x) => x.id === sort.id)!
    return r.sort((a, b) => {
      const va = c.get(a)
      const vb = c.get(b)
      if (va === null || va === '') return 1
      if (vb === null || vb === '') return -1
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.assets, cls, q, sort])

  const counts = useMemo(() => Object.fromEntries(CLASSES.map((c) => [c.id, p.assets.filter((a) => a.class === c.id).length])), [p.assets])

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--page)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--gridline)', background: 'var(--surface-1)' }}>
        <button style={chip(cls === 'all')} onClick={() => setCls('all')}>All {p.assets.length}</button>
        {CLASSES.filter((c) => counts[c.id]).map((c) => (
          <button key={c.id} style={chip(cls === c.id)} onClick={() => setCls(c.id)}>{c.plural} {counts[c.id]}</button>
        ))}
        <input id="inv-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search type, id or station" style={{ marginLeft: 'auto', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--page)', color: 'var(--text-primary)', minWidth: 220 }} />
        <button style={btn} onClick={() => download(`${p.road.slug}-assets.csv`, assetsToCsv(rows))}>Export CSV</button>
        <button style={btn} onClick={() => download(`${p.road.slug}-assets.geojson`, assetsToGeoJson(rows), 'application/geo+json')}>Export GeoJSON</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: 'var(--surface-1)' }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.id} style={th} onClick={() => setSort((s) => ({ id: c.id, dir: s.id === c.id ? (-s.dir as 1 | -1) : 1 }))} aria-sort={sort.id === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                  {c.label}{sort.id === c.id ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} onClick={() => p.onSelect(a.id)} style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--page)')} onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
                {cols.map((c) => {
                  const v = c.get(a)
                  let s: React.ReactNode = v === null || v === '' ? '—' : typeof v === 'number' ? (c.id === 'station' ? String(a.attrs.station?.value ?? Math.round(v)) : Math.abs(v) > 10000 ? v.toLocaleString(undefined, { minimumFractionDigits: 2 }) : Number.isInteger(v) ? v : v.toFixed(1)) : v
                  if (c.id === 'type') s = <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><IconSvg a={a} size={13} />{a.label}</span>
                  if (c.id === 'flags' && v) s = <span style={{ color: '#b3261e' }}>{v}</span>
                  return <td key={c.id} style={{ ...td, fontFamily: c.mono ? 'ui-monospace, Menlo, monospace' : undefined, whiteSpace: c.id === 'flags' ? 'normal' : 'nowrap', minWidth: c.id === 'flags' ? 260 : undefined }}>{s}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const chip = (on: boolean): React.CSSProperties => ({ fontSize: 12.5, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--series-blue)' : 'var(--border)'), background: on ? 'var(--series-blue)' : 'var(--surface-1)', color: on ? '#fff' : 'var(--text-primary)', fontWeight: 600 })
const btn: React.CSSProperties = { fontSize: 12.5, padding: '6px 11px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer' }
const th: React.CSSProperties = { position: 'sticky', top: 0, background: 'var(--surface-1)', textAlign: 'left', padding: '9px 12px', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--gridline)', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }
const td: React.CSSProperties = { padding: '7px 12px', borderBottom: '1px solid var(--gridline)', fontVariantNumeric: 'tabular-nums' }
