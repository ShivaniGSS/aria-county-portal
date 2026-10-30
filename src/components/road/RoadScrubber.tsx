import { useMemo, useRef } from 'react'
import { num, station, type Road, type RoadAsset } from '../../lib/roadTypes'

/**
 * A slim timeline of the whole road for the street-view layout: asset density per 250 ft as a bar chart, issues as
 * red ticks, crashes as dots, and a handle for where the viewer stands. Click or drag to move along the road.
 */
interface Props {
  road: Road
  assets: RoadAsset[]
  flagged: Map<string, 'fail' | 'borderline' | 'note'>
  index: number
  setIndex: (i: number) => void
}

const BIN = 250

export function RoadScrubber(p: Props) {
  const box = useRef<HTMLDivElement>(null)
  const L = p.road.length_ft
  const bins = useMemo(() => {
    const n = Math.ceil(L / BIN)
    const c = new Array(n).fill(0)
    for (const a of p.assets) {
      const ch = num(a.attrs.chainage_ft)
      if (ch !== null) c[Math.min(n - 1, Math.floor(ch / BIN))]++
    }
    return c
  }, [p.assets, L])
  const max = Math.max(1, ...bins)
  const issues = p.assets.filter((a) => p.flagged.get(a.id) === 'fail')
  const pano = p.road.panos[p.index]
  const pos = pano ? (pano.ch / L) * 100 : 0

  const pick = (clientX: number) => {
    const r = box.current!.getBoundingClientRect()
    const ft = Math.max(0, Math.min(L, ((clientX - r.left) / r.width) * L))
    let best = 0
    let bd = Infinity
    p.road.panos.forEach((q, i) => {
      if (Math.abs(q.ch - ft) < bd) {
        bd = Math.abs(q.ch - ft)
        best = i
      }
    })
    p.setIndex(best)
  }

  return (
    <div style={{ padding: '8px 16px 10px', background: 'var(--surface-1)', borderTop: '1px solid var(--gridline)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
        <span>Sta. 0+00</span>
        <span>
          Assets per 250 ft · <span style={{ color: '#e5383b' }}>▍</span> needs attention · <span style={{ color: '#b3261e' }}>●</span> crash
        </span>
        <span>Sta. {station(L)}</span>
      </div>
      <div ref={box} style={{ position: 'relative', height: 44, cursor: 'pointer' }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e.clientX) }}
        onPointerMove={(e) => e.buttons === 1 && pick(e.clientX)}>
        <svg width="100%" height="44" preserveAspectRatio="none" viewBox={`0 0 ${bins.length} 44`} style={{ position: 'absolute', inset: 0 }}>
          {bins.map((c, i) => <rect key={i} x={i + 0.1} width={0.8} y={30 - (c / max) * 26} height={(c / max) * 26} fill="var(--series-blue)" opacity={0.35} />)}
        </svg>
        {issues.map((a) => (
          <div key={a.id} style={{ position: 'absolute', left: `${((num(a.attrs.chainage_ft) ?? 0) / L) * 100}%`, top: 2, width: 2, height: 28, background: '#e5383b', opacity: 0.8 }} />
        ))}
        {p.road.crashes.map((c, i) => (
          <div key={i} style={{ position: 'absolute', left: `${(c.chainage_ft / L) * 100}%`, top: 34, width: 6, height: 6, marginLeft: -3, borderRadius: 3, background: '#b3261e' }} />
        ))}
        <div style={{ position: 'absolute', left: `${pos}%`, top: -2, bottom: -2, width: 3, marginLeft: -1.5, background: 'var(--text-primary)', borderRadius: 2 }}>
          <div style={{ position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', background: 'var(--text-primary)', color: 'var(--surface-1)', padding: '1px 6px', borderRadius: 4 }}>
            {pano ? station(pano.ch) : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
