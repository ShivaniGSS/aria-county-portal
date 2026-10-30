import { useEffect, useState } from 'react'
import { ATTR_LABELS, CHECK_KEYS, GROUPS, IconSvg, SOURCE_LABEL } from '../../lib/assetStyle'
import { num, panoFor, panoUrl, type Attr, type Evidence, type Road, type RoadAsset } from '../../lib/roadTypes'
import { rowAt, type Finding } from '../../lib/roadChecks'
import { useFeedback } from '../../lib/feedback'

interface Props {
  road: Road
  asset: RoadAsset
  findings: Finding[]
  onClose: () => void
  onStep: (dir: -1 | 1) => void
}

const FACE = ['West', 'North', 'East', 'South']

export function fmt(a: Attr, key?: string): string {
  const v = a.value
  if (v === null || v === undefined) return 'Coming up'
  if (a.range) return `${a.range[0]}–${a.range[1]}${a.unit ? ` ${a.unit}` : ''}`
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') {
    const big = Math.abs(v) >= 10000
    const s = big ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : key === 'detector_confidence' ? v.toFixed(2)
      : Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 2 : 1)
    const u = a.unit === 'deg' ? '°' : a.unit ? ` ${a.unit}` : ''
    return `${s}${u}`
  }
  return String(v)
}

export function SourceBadge({ s }: { s: string }) {
  const c = { measured: ['#1f6b3d', 'rgba(31,107,61,0.12)'], derived: ['#2a5f9e', 'rgba(42,95,158,0.12)'], public: ['#6d5300', 'rgba(240,160,32,0.16)'], illustrative: ['#7a3d74', 'rgba(122,61,116,0.13)'], coming: ['#5b6670', 'rgba(91,102,112,0.12)'], checked: ['#1f6b3d', 'rgba(31,107,61,0.12)'], estimate: ['#0b6e75', 'rgba(11,110,117,0.12)'] }[s] ?? ['#555', '#eee']
  return <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: c[0], background: c[1], padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>{SOURCE_LABEL[s] ?? s}</span>
}

export function AssetRecord({ road, asset: a, findings, onClose, onStep }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const fb = useFeedback()
  const mine = fb.items[a.id]
  const [note, setNote] = useState(mine?.note ?? '')
  useEffect(() => setNote(fb.items[a.id]?.note ?? ''), [a.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const ft = num(a.attrs.chainage_ft) ?? num(a.attrs.start_chainage_ft) ?? 0
  const r = rowAt(road, ft)
  const nearCrashes = road.crashes.filter((c) => Math.abs(c.chainage_ft - ft) <= 300)
  const x = num(a.attrs.x_ft)
  const y = num(a.attrs.y_ft)
  const z = num(a.attrs.z_ft)
  const reviewed = a.attrs.human_reviewed?.value === true

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard unavailable: the values are selectable text */
    }
  }

  const row = (k: string) => {
    const at = a.attrs[k]
    if (!at) return null
    return (
      <div key={k} style={{ borderBottom: '1px solid var(--gridline)' }}>
        <button onClick={() => setOpen(open === k ? null : k)} style={rowBtn} aria-expanded={open === k}>
          <span style={{ color: 'var(--text-secondary)' }}>{ATTR_LABELS[k] ?? k}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: at.source === 'illustrative' || at.source === 'coming' ? 'var(--text-muted)' : 'var(--text-primary)', fontStyle: at.source === 'illustrative' || at.source === 'coming' ? 'italic' : 'normal', fontWeight: at.source === 'coming' ? 400 : 600 }}>
              {fmt(at, k)}
              {!at.range && at.spread !== undefined && at.spread > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ± {at.spread}{at.unit === 'in' ? ' in' : at.unit === 'ft' ? ' ft' : ''}</span>}
            </span>
            <SourceBadge s={at.source} />
          </span>
        </button>
        {open === k && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '0 0 10px', lineHeight: 1.45 }}>
            {at.method}
            {at.views !== undefined && <> · from {at.views} view{at.views === 1 ? '' : 's'}</>}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside style={panel} aria-label={`${a.label} record`}>
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--gridline)', display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconSvg a={a} size={20} />
          <b style={{ fontSize: 16, lineHeight: 1.2 }}>{a.label}</b>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button style={iconBtn} onClick={() => onStep(-1)} aria-label="Previous asset along the road" title="Previous along the road">‹</button>
            <button style={iconBtn} onClick={() => onStep(1)} aria-label="Next asset along the road" title="Next along the road">›</button>
            <button style={iconBtn} onClick={onClose} aria-label="Close">×</button>
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{a.id}</span>
          <span>Sta. {String(a.attrs.station?.value ?? (a.attrs.start_chainage_ft ? `${Math.round(ft)} ft` : ''))}</span>
          <span style={{ textTransform: 'capitalize' }}>{String(a.attrs.side?.value ?? '')} side</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ ...pill, background: reviewed ? 'rgba(31,107,61,0.12)' : 'var(--page)', color: reviewed ? '#1f6b3d' : 'var(--text-secondary)' }}>
            {reviewed ? 'Checked by a person' : 'Automatic detection'}
          </span>
          {a.attrs.seen_from_stations && <span style={pill}>Seen from {String(a.attrs.seen_from_stations.value)} survey stops</span>}
          {a.attrs.position_residual_ft && <span style={pill}>Position ± {String(a.attrs.position_residual_ft.value)} ft</span>}
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '4px 16px 16px' }}>
        {x !== null && y !== null && (
          <div style={coordBox}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}>
              <span style={{ color: 'var(--text-muted)' }}>x</span><span>{x.toLocaleString(undefined, { minimumFractionDigits: 2 })} ft</span>
              <span style={{ color: 'var(--text-muted)' }}>y</span><span>{y.toLocaleString(undefined, { minimumFractionDigits: 2 })} ft</span>
              {z !== null && <><span style={{ color: 'var(--text-muted)' }}>z</span><span>{z.toFixed(2)} ft</span></>}
              <span style={{ color: 'var(--text-muted)' }}>lat, lon</span><span>{a.lat.toFixed(6)}, {a.lon.toFixed(6)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>IL State Plane East, NAD83, US survey ft · {a.attrs.z_ft?.source === 'public' ? 'ground elevation from USGS 3DEP 1 m lidar (NAVD88)' : 'elevation from the survey trajectory'}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button style={smallBtn} onClick={() => copy(`${x.toFixed(2)}, ${y.toFixed(2)}${z !== null ? `, ${z.toFixed(2)}` : ''}`)}>Copy x, y, z</button>
              <button style={smallBtn} onClick={() => copy(`${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}`)}>Copy lat, lon</button>
              <a style={{ ...smallBtn, textDecoration: 'none' }} href={`https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lon}`} target="_blank" rel="noreferrer">Open in Google Maps</a>
            </div>
          </div>
        )}

        {(findings.length > 0 || CHECK_KEYS.some((k) => a.attrs[k] && a.attrs[k].value !== null)) && (
          <section style={sec}>
            <h4 style={h4}>Checks</h4>
            {CHECK_KEYS.filter((k) => a.attrs[k] && a.attrs[k].value !== null).map((k) => {
              const at = a.attrs[k]
              const v = String(at.value)
              const tone = v.startsWith('meets') || v === 'typical' ? 'ok' : v.startsWith('borderline') || v === 'check' ? 'warn' : 'bad'
              return (
                <div key={k} style={{ ...check, borderLeftColor: tone === 'ok' ? '#2f9e5b' : tone === 'warn' ? '#f0a020' : '#e5383b' }}>
                  <div style={{ fontWeight: 700 }}>{ATTR_LABELS[k]}: {v}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {at.method}
                    {at.margin_ft !== undefined && <> · margin {at.margin_ft > 0 ? '+' : ''}{at.margin_ft.toFixed(2)} ft</>}
                  </div>
                </div>
              )
            })}
            {findings.filter((f) => !f.text.startsWith('Sign')).map((f, i) => (
              <div key={i} style={{ ...check, borderLeftColor: f.severity === 'fail' ? '#e5383b' : f.severity === 'borderline' ? '#f0a020' : '#8e9aaf' }}>
                <div style={{ fontWeight: 600 }}>{f.text}</div>
              </div>
            ))}
          </section>
        )}

        {GROUPS.map((g) => {
          const keys = g.keys.filter((k) => a.attrs[k])
          if (!keys.length) return null
          return (
            <section key={g.title} style={sec}>
              <h4 style={h4}>{g.title}</h4>
              {keys.map(row)}
              {g.title === 'County record' && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>Placeholders show what the record holds once the county's inventory is linked; they are not measurements.</div>}
            </section>
          )
        })}

        <section style={sec}>
          <h4 style={h4}>The road at this spot</h4>
          <div style={ctxGrid}>
            <span>Paved width</span><b>{r.paved_width_ft ? `${r.paved_width_ft.toFixed(1)} ft` : '—'}</b>
            <span>Lane widths</span><b>{r.lane_width_L_ft && r.lane_width_R_ft ? `${r.lane_width_L_ft.toFixed(1)} / ${r.lane_width_R_ft.toFixed(1)} ft` : '—'}</b>
            <span>Shoulders</span><b>{r.idot_shoulder_width_ft ? `${r.idot_shoulder_width_ft} ft (IDOT record)` : '—'}</b>
            <span>Grade</span><b>{r.grade_pct > 0 ? '+' : ''}{r.grade_pct.toFixed(1)}%</b>
            <span>Alignment</span><b>{r.curve_radius_ft ? `${r.curve_dir} curve, R ${r.curve_radius_ft.toLocaleString()} ft` : 'Tangent'}</b>
            <span>Centre line</span><b>{r.centre_type ?? '—'}</b>
            <span>Traffic</span><b>{r.aadt ? `${r.aadt.toLocaleString()} AADT (${r.aadt_year})` : '—'}</b>
            <span>Road class</span><b>{r.functional_class ?? '—'}</b>
            <span>Crashes within 300 ft</span><b>{nearCrashes.length ? `${nearCrashes.length} (2014–2020)` : 'None mapped in IDOT 2014–20 data'}</b>
          </div>
        </section>

        {road.imagery.representative && a.evidence.length > 0 && (
          <section style={sec}>
            <h4 style={h4}>Evidence · {a.evidence.length} views</h4>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Detected in {a.evidence.length} camera views on this road. The photos themselves aren't loaded into the portal yet; they will appear here, zoomed to the detection, once they are.
            </div>
          </section>
        )}

        {!road.imagery.representative && a.evidence.length > 0 && (
          <section style={sec}>
            <h4 style={h4}>Evidence · {a.evidence.length} views</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              {a.evidence.map((e, i) => <EvidenceThumb key={i} road={road} e={e} />)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
              Each view is one camera face at one survey stop, zoomed to the detection; click a photo for the whole view.
            </div>
          </section>
        )}

        <section style={sec}>
          <h4 style={h4}>Your feedback on this record</h4>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['correct', 'wrong', 'missing'] as const).map((k) => (
              <button key={k} style={{ ...smallBtn, ...(mine?.verdict === k ? { background: 'var(--series-blue)', color: '#fff', borderColor: 'var(--series-blue)' } : {}) }}
                onClick={() => fb.set(a.id, { verdict: k, note })}>
                {k === 'correct' ? 'Looks right' : k === 'wrong' ? 'Something is wrong' : 'Missing a detail I need'}
              </button>
            ))}
          </div>
          <textarea id={`fb-${a.id}`} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (mine?.note ?? '') && fb.set(a.id, { verdict: mine?.verdict ?? null, note })}
            placeholder="What would you change, or what would you use this for?" rows={3} style={textarea} />
        </section>
      </div>
    </aside>
  )
}

function EvidenceThumb({ road, e }: { road: Road; e: Evidence }) {
  const [failed, setFailed] = useState(false)
  const [whole, setWhole] = useState(false)
  const pano = panoFor(road, e.station)
  const src = pano ? panoUrl(pano, e.face) : ''
  const [x0, y0, x1, y1] = e.bbox
  // zoom in around the detection: a square crop four times the box, clamped to the face
  const size = whole ? 2048 : Math.min(2048, Math.max(320, Math.max(x1 - x0, y1 - y0) * 4))
  const cx = Math.min(2048 - size / 2, Math.max(size / 2, (x0 + x1) / 2))
  const cy = Math.min(2048 - size / 2, Math.max(size / 2, (y0 + y1) / 2))
  const left = cx - size / 2
  const top = cy - size / 2
  const pct = (v: number) => `${(v / size) * 100}%`
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 3 }}>
      <button onClick={() => setWhole((w) => !w)} title={whole ? 'Zoom to the detection' : 'Show the whole camera view'}
        style={{ position: 'relative', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', padding: 0, border: 0, cursor: 'zoom-in',
          background: failed || !src ? 'linear-gradient(#cfe0ee 0 50%, #b9b29f 50% 100%)' : `#000 url(${src}) no-repeat`,
          backgroundSize: `${(2048 / size) * 100}%`, backgroundPosition: size >= 2048 ? '0 0' : `${(left / (2048 - size)) * 100}% ${(top / (2048 - size)) * 100}%` }}>
        {src && <img src={src} alt="" onError={() => setFailed(true)} style={{ display: 'none' }} />}
        <span style={{ position: 'absolute', left: pct(x0 - left), top: pct(y0 - top), width: pct(x1 - x0), height: pct(y1 - y0), border: '2px solid #ff3b30', borderRadius: 2, minWidth: 6, minHeight: 6 }} />
      </button>
      <figcaption style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.3 }}>
        Looking {FACE[e.face] ?? '?'} · {e.distance_ft.toFixed(0)} ft<br />
        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--text-muted)' }}>{e.station.replace(/^.*_T/, 'T')}</span>{e.reviewed ? ' · checked' : ''}
      </figcaption>
    </figure>
  )
}

const panel: React.CSSProperties = { position: 'absolute', top: 0, right: 0, bottom: 0, width: 400, maxWidth: '100%', background: 'var(--surface-1)', borderLeft: '1px solid var(--gridline)', boxShadow: 'var(--panel-shadow)', display: 'flex', flexDirection: 'column', zIndex: 5 }
const rowBtn: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, width: '100%', alignItems: 'center', border: 0, background: 'transparent', color: 'inherit', padding: '8px 0', fontSize: 13, textAlign: 'left', cursor: 'pointer' }
const iconBtn: React.CSSProperties = { width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }
const pill: React.CSSProperties = { fontSize: 11.5, padding: '3px 8px', borderRadius: 999, background: 'var(--page)', color: 'var(--text-secondary)', border: '1px solid var(--gridline)' }
const sec: React.CSSProperties = { marginTop: 16 }
const h4: React.CSSProperties = { margin: '0 0 4px', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }
const check: React.CSSProperties = { borderLeft: '4px solid', padding: '6px 10px', margin: '6px 0', background: 'var(--page)', borderRadius: '0 6px 6px 0', fontSize: 13, display: 'grid', gap: 2 }
const coordBox: React.CSSProperties = { marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--page)', border: '1px solid var(--gridline)' }
const smallBtn: React.CSSProperties = { fontSize: 12, padding: '5px 9px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer' }
const ctxGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '5px 12px', fontSize: 13, color: 'var(--text-secondary)' }
const textarea: React.CSSProperties = { width: '100%', marginTop: 8, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--page)', color: 'var(--text-primary)', font: 'inherit', fontSize: 13, resize: 'vertical' }
