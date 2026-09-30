import { useMemo, useState } from 'react'
import {
  projectDoNothing, projectMaintained, reconstructionLiability, currentCondition,
  type CostBasis,
} from '../lib/conditionModel'
import type { CurveEntity } from '../lib/assetTypes'

interface Props {
  /** A segment, an asset class, or a single asset -- all carry the same curve. */
  segment: CurveEntity & { length_mi?: number | null }
  desiredMin: number
  reconstructionThreshold: number
  years?: number
  /** What the measured reading is, or what the synthetic value stands in for. */
  measuredSource?: string
  syntheticOf?: string
  /**
   * Which treatments apply and how much of the thing there is. Defaults to the
   * pavement table priced by the mile -- pass the asset class's own basis for
   * anything that is counted rather than measured in miles.
   */
  costBasis?: CostBasis
  /** How the quantity reads in the caption, e.g. "0.5 mi" or "12 signs". */
  quantityLabel?: string
}

const W = 760
const H = 340
const PAD = { top: 24, right: 96, bottom: 44, left: 52 }

const DO_NOTHING = '#2a78d6'
const MAINTAINED = '#1baf7a'

export function ConditionCurve({
  segment, desiredMin, reconstructionThreshold, years = 30,
  measuredSource, syntheticOf, costBasis, quantityLabel,
}: Props) {
  const [hoverYear, setHoverYear] = useState<number | null>(null)

  const { doNothing, maintained, liability } = useMemo(() => ({
    doNothing: projectDoNothing(segment, years),
    maintained: projectMaintained(segment, desiredMin, years, costBasis),
    liability: reconstructionLiability(segment, reconstructionThreshold, costBasis),
  }), [segment, desiredMin, reconstructionThreshold, years, costBasis])

  const year0 = doNothing[0].year
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (year: number) => PAD.left + ((year - year0) / years) * plotW
  const y = (index: number) => PAD.top + (1 - index / 100) * plotH

  const path = (pts: { year: number; index: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.year).toFixed(1)},${y(p.index).toFixed(1)}`).join(' ')

  // Uncertainty band, only where the projection isn't anchored on a real reading.
  const band = segment.tier === 'measured' ? null : (() => {
    const sd = segment.band_sd
    const upper = doNothing.map((p) => `${x(p.year).toFixed(1)},${y(Math.min(100, p.index + sd)).toFixed(1)}`)
    const lower = [...doNothing].reverse().map((p) => `${x(p.year).toFixed(1)},${y(Math.max(0, p.index - sd)).toFixed(1)}`)
    return `M${upper.join(' L')} L${lower.join(' L')} Z`
  })()

  const isProjected = segment.tier !== 'measured'
  const qty = quantityLabel ? ` for ${quantityLabel}` : ''
  const reconYear = liability.years !== null ? year0 + liability.years : null
  const hovered = hoverYear !== null ? {
    doNothing: doNothing.find((p) => p.year === hoverYear),
    maintained: maintained.points.find((p) => p.year === hoverYear),
  } : null

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const t = Math.round(((px - PAD.left) / plotW) * years)
    setHoverYear(t >= 0 && t <= years ? year0 + t : null)
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverYear(null)}
      >
        {/* gridlines + y axis */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--gridline)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">{v}</text>
          </g>
        ))}

        {/* thresholds */}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(desiredMin)} y2={y(desiredMin)}
          stroke="var(--status-warning)" strokeWidth={1.5} strokeDasharray="6 4" />
        <text x={W - PAD.right + 6} y={y(desiredMin) + 4} fontSize={10} fill="var(--text-secondary)">
          Desired min ({desiredMin})
        </text>
        <line x1={PAD.left} x2={W - PAD.right} y1={y(reconstructionThreshold)} y2={y(reconstructionThreshold)}
          stroke="var(--status-critical)" strokeWidth={1.5} strokeDasharray="3 4" />
        <text x={W - PAD.right + 6} y={y(reconstructionThreshold) + 4} fontSize={10} fill="var(--text-secondary)">
          Rebuild ({reconstructionThreshold})
        </text>

        {band && <path d={band} fill={DO_NOTHING} opacity={0.12} />}

        {/* maintained scenario */}
        <path d={path(maintained.points)} fill="none" stroke={MAINTAINED} strokeWidth={2} />
        {maintained.events.map((ev, i) => (
          <circle key={i} cx={x(ev.year)} cy={y(ev.indexAfter)} r={3.5} fill={MAINTAINED} stroke="var(--surface-1)" strokeWidth={1.5} />
        ))}

        {/* do-nothing scenario -- dashed whenever the projection isn't anchored on a reading */}
        <path
          d={path(doNothing)}
          fill="none"
          stroke={DO_NOTHING}
          strokeWidth={2}
          strokeDasharray={isProjected ? '7 5' : undefined}
        />

        {reconYear !== null && reconYear <= year0 + years && (
          <g>
            <line x1={x(reconYear)} x2={x(reconYear)} y1={y(reconstructionThreshold)} y2={H - PAD.bottom}
              stroke="var(--status-critical)" strokeWidth={1} />
            <text x={x(reconYear)} y={H - PAD.bottom + 28} textAnchor="middle" fontSize={10} fill="var(--status-critical)">
              rebuild ~{reconYear}
            </text>
          </g>
        )}

        {/* hover crosshair */}
        {hoverYear !== null && (
          <line x1={x(hoverYear)} x2={x(hoverYear)} y1={PAD.top} y2={H - PAD.bottom}
            stroke="var(--text-muted)" strokeWidth={1} opacity={0.5} />
        )}

        {/* x axis */}
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--border)" />
        {Array.from({ length: 7 }, (_, i) => year0 + Math.round((i * years) / 6)).map((yr) => (
          <text key={yr} x={x(yr)} y={H - PAD.bottom + 16} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
            {yr}
          </text>
        ))}
        <text x={PAD.left - 38} y={PAD.top + plotH / 2} fontSize={11} fill="var(--text-secondary)"
          transform={`rotate(-90 ${PAD.left - 38} ${PAD.top + plotH / 2})`} textAnchor="middle">
          Condition
        </text>
      </svg>

      <div style={legendRow}>
        <Legend color={DO_NOTHING} dashed={isProjected} label="Do nothing" />
        <Legend color={MAINTAINED} label={`Maintained · $${Math.round(maintained.totalCost).toLocaleString()} over ${years} yrs`} />
        {hovered?.doNothing && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {hoverYear}: do nothing <strong>{hovered.doNothing.index.toFixed(0)}</strong>
            {hovered.maintained && <> · maintained <strong>{hovered.maintained.index.toFixed(0)}</strong></>}
          </span>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10, lineHeight: 1.5 }}>
        {segment.tier === 'measured' ? (
          <>
            Anchored on a real {measuredSource ?? 'survey'} reading of{' '}
            <strong>{currentCondition(segment).toFixed(0)}</strong>. Forward projection is modelled.
          </>
        ) : (
          <>
            <strong>Synthetic placeholder.</strong> This has never been surveyed, so the starting
            condition of <strong>{currentCondition(segment).toFixed(0)}</strong> is fabricated —
            typical for {syntheticOf ?? 'assets of this kind'}, not an estimate of this one.
            Shaded band shows the spread. Replace with survey results.
          </>
        )}{' '}
        {liability.years === null
          ? 'It does not reach full replacement condition within the projection window.'
          : liability.years === 0
            ? `It is already at full replacement condition — roughly $${Math.round(liability.cost).toLocaleString()}${qty} to put right.`
            : `Left alone, it reaches full replacement condition in about ${liability.years} years — roughly $${Math.round(liability.cost).toLocaleString()}${qty}.`}
      </div>
    </div>
  )
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <svg width={22} height={8}>
        <line x1={0} y1={4} x2={22} y2={4} stroke={color} strokeWidth={2} strokeDasharray={dashed ? '5 4' : undefined} />
      </svg>
      {label}
    </span>
  )
}

const legendRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  marginTop: 6,
  flexWrap: 'wrap',
}
