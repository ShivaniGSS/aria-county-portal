import { useMemo } from 'react'
import { conditionAtAge, currentAge, currentCondition } from '../lib/conditionModel'
import type { CurveEntity } from '../lib/assetTypes'

/** Anything with a curve and a length can be rolled into a network view. */
type NetworkMember = CurveEntity & { length_mi?: number | null }

const W = 760
const H = 260
const PAD = { top: 20, right: 96, bottom: 40, left: 52 }
const DO_NOTHING = '#2a78d6'
const CURRENT_YEAR = 2026

/** Mile-weighted network condition over time if nothing is done. */
export function NetworkConditionChart({
  segments, desiredMin, years = 30,
}: {
  segments: NetworkMember[]
  desiredMin: number
  years?: number
}) {
  const series = useMemo(() => {
    const totalMiles = segments.reduce((s, x) => s + (x.length_mi ?? 0.25), 0)
    return Array.from({ length: years + 1 }, (_, t) => {
      let weighted = 0
      let milesBelow = 0
      for (const seg of segments) {
        const mi = seg.length_mi ?? 0.25
        const idx = conditionAtAge(seg, currentAge(seg) + t)
        weighted += idx * mi
        if (idx < desiredMin) milesBelow += mi
      }
      return {
        year: CURRENT_YEAR + t,
        avg: weighted / totalMiles,
        pctBelow: (milesBelow / totalMiles) * 100,
      }
    })
  }, [segments, desiredMin, years])

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (year: number) => PAD.left + ((year - CURRENT_YEAR) / years) * plotW
  const y = (v: number) => PAD.top + (1 - v / 100) * plotH

  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.year).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ')
  const last = series[series.length - 1]

  return (
    <div style={card}>
      <div style={cardTitle}>Network condition if nothing is done</div>
      <div style={cardSub}>
        Mile-weighted average across {segments.length.toLocaleString()} segments. Falls from{' '}
        <strong>{series[0].avg.toFixed(0)}</strong> to <strong>{last.avg.toFixed(0)}</strong> by {last.year}, with{' '}
        <strong>{last.pctBelow.toFixed(0)}%</strong> of miles below the desired minimum.
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--gridline)" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">{v}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(desiredMin)} y2={y(desiredMin)}
          stroke="var(--status-warning)" strokeWidth={1.5} strokeDasharray="6 4" />
        <text x={W - PAD.right + 6} y={y(desiredMin) + 4} fontSize={10} fill="var(--text-secondary)">
          Desired min ({desiredMin})
        </text>
        <path d={line} fill="none" stroke={DO_NOTHING} strokeWidth={2.5} />
        <circle cx={x(series[0].year)} cy={y(series[0].avg)} r={4} fill={DO_NOTHING} />
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--border)" />
        {Array.from({ length: 7 }, (_, i) => CURRENT_YEAR + Math.round((i * years) / 6)).map((yr) => (
          <text key={yr} x={x(yr)} y={H - PAD.bottom + 16} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{yr}</text>
        ))}
      </svg>
    </div>
  )
}

const BANDS = [
  { label: 'Good (75+)', min: 75, color: '#0ca30c' },
  { label: 'Fair (55–75)', min: 55, color: '#fab219' },
  { label: 'Poor (25–55)', min: 25, color: '#ec835a' },
  { label: 'Failed (<25)', min: 0, color: '#d03b3b' },
]

/** Miles in each condition band today, split by whether the value is real or synthetic. */
export function ConditionDistribution({ segments }: { segments: NetworkMember[] }) {
  const rows = useMemo(() => {
    return BANDS.map((band, i) => {
      const upper = i === 0 ? 101 : BANDS[i - 1].min
      const inBand = segments.filter((s) => {
        const c = currentCondition(s)
        return c >= band.min && c < upper
      })
      const measured = inBand.filter((s) => s.tier === 'measured').reduce((a, s) => a + (s.length_mi ?? 0.25), 0)
      const synthetic = inBand.filter((s) => s.tier === 'synthetic').reduce((a, s) => a + (s.length_mi ?? 0.25), 0)
      return { ...band, measured, synthetic, total: measured + synthetic }
    })
  }, [segments])

  const max = Math.max(...rows.map((r) => r.total), 1)

  return (
    <div style={card}>
      <div style={cardTitle}>Network miles by condition today</div>
      <div style={cardSub}>
        Solid is measured; hatched is synthetic placeholder awaiting survey.
      </div>
      <svg viewBox="0 0 760 200" style={{ width: '100%', height: 'auto' }}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--surface-1)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="3" />
          </pattern>
        </defs>
        {rows.map((r, i) => {
          const yPos = 14 + i * 46
          const wMeasured = (r.measured / max) * 520
          const wSynthetic = (r.synthetic / max) * 520
          return (
            <g key={r.label} color={r.color}>
              <text x={0} y={yPos + 16} fontSize={12} fill="var(--text-secondary)">{r.label}</text>
              <rect x={130} y={yPos} width={Math.max(0, wMeasured)} height={22} rx={3} fill={r.color} />
              <rect x={130 + wMeasured + (wSynthetic > 0 ? 2 : 0)} y={yPos} width={Math.max(0, wSynthetic)} height={22} rx={3}
                fill="url(#hatch)" stroke={r.color} strokeWidth={1} />
              <text x={130 + wMeasured + wSynthetic + 8} y={yPos + 16} fontSize={12} fill="var(--text-primary)"
                style={{ fontVariantNumeric: 'tabular-nums' }}>
                {r.total.toFixed(0)} mi
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

const card: React.CSSProperties = {
  flex: '1 1 380px',
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '14px 16px',
  minWidth: 0,
}
const cardTitle: React.CSSProperties = { fontWeight: 700, fontSize: 14 }
const cardSub: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 10px', lineHeight: 1.5,
}
