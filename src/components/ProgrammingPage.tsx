import { useMemo, useState } from 'react'
import { useMaintenanceData } from '../lib/useMaintenanceData'
import { useAppState, inDateRange } from '../lib/AppStateContext'
import {
  currentCondition, recommendTreatment, yearsUntilBelow, reconstructionLiability,
  type ConditionSegment, type Treatment,
} from '../lib/conditionModel'

interface Candidate {
  seg: ConditionSegment
  condition: number
  treatment: Treatment
  cost: number
  benefit: number
  effectiveness: number
  yearsToRebuild: number | null
  rebuildCost: number
}

export function ProgrammingPage() {
  const { data, loading } = useMaintenanceData()
  const { dateRange } = useAppState()
  const [budgetInput, setBudgetInput] = useState('750000')

  const budget = Math.max(0, Number(budgetInput.replace(/[^0-9.]/g, '')) || 0)

  const { funded, deferred, totals } = useMemo(() => {
    if (!data) return { funded: [] as Candidate[], deferred: [] as Candidate[], totals: null }
    const { desired_min_condition, reconstruction_threshold } = data.condition.thresholds

    const candidates: Candidate[] = data.condition.segments
      // Segments whose condition we won't state can't be programmed against.
      .filter((seg) => currentCondition(seg) !== null)
      .map((seg) => {
        const condition = currentCondition(seg)!
        const treatment = recommendTreatment(condition, desired_min_condition + 10)!
        const lengthMi = seg.length_mi ?? 0.25
        const cost = treatment.cost * lengthMi
        // Benefit favours big condition gains on well-used roads, scaled by length.
        const trafficWeight = Math.log10((seg.aadt ?? 50) + 10)
        const gain = Math.min(100, condition + treatment.restores) - condition
        const benefit = gain * lengthMi * trafficWeight
        const { years, cost: rebuildCost } = reconstructionLiability(seg, reconstruction_threshold)
        return {
          seg, condition, treatment, cost, benefit,
          effectiveness: cost > 0 ? benefit / cost : 0,
          yearsToRebuild: years ?? yearsUntilBelow(seg, reconstruction_threshold),
          rebuildCost,
        }
      })
      // Only segments that have actually fallen below the desired level are candidates.
      .filter((c) => c.condition < desired_min_condition)
      .sort((a, b) => b.effectiveness - a.effectiveness)

    const fundedList: Candidate[] = []
    const deferredList: Candidate[] = []
    let spent = 0
    for (const c of candidates) {
      if (spent + c.cost <= budget) {
        fundedList.push(c)
        spent += c.cost
      } else {
        deferredList.push(c)
      }
    }

    return {
      funded: fundedList,
      deferred: deferredList,
      totals: {
        spent,
        remaining: budget - spent,
        milesTreated: fundedList.reduce((s, c) => s + (c.seg.length_mi ?? 0.25), 0),
        deferredLiability: deferredList.reduce((s, c) => s + c.rebuildCost, 0),
        candidateCount: candidates.length,
      },
    }
  }, [data, budget])

  if (loading || !data || !totals) return <div style={{ padding: 24 }}>Loading…</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20 }}>
      <h3 style={{ marginTop: 0 }}>Programming</h3>

      <div style={budgetRow}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>
          Enter $ amount in budget
          <input
            id="budget-input"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            style={budgetInputStyle}
            inputMode="numeric"
          />
        </label>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <Stat label="Programmed" value={`$${Math.round(totals.spent).toLocaleString()}`} />
          <Stat label="Unspent" value={`$${Math.round(totals.remaining).toLocaleString()}`} />
          <Stat label="Segments funded" value={funded.length.toLocaleString()} />
          <Stat label="Miles treated" value={totals.milesTreated.toFixed(1)} />
          <Stat label="Deferred" value={deferred.length.toLocaleString()} tone="critical" />
        </div>
      </div>

      <div style={noteBox}>
        {totals.candidateCount.toLocaleString()} segments are currently below the desired minimum
        condition of {data.condition.thresholds.desired_min_condition}. This budget covers{' '}
        <strong>{funded.length}</strong> of them. Leaving the remaining {deferred.length.toLocaleString()}{' '}
        untreated carries an eventual rebuild liability of roughly{' '}
        <strong>${Math.round(totals.deferredLiability).toLocaleString()}</strong> — the cost of waiting.
        Treatment costs are illustrative; condition for most segments is projected, not measured.
      </div>

      <h4>Funded this program</h4>
      <ProgramTable rows={funded} empty="Nothing fits in this budget." />

      <h4 style={{ marginTop: 24 }}>Deferred — and what deferral costs</h4>
      <ProgramTable rows={deferred.slice(0, 40)} showConsequence empty="Everything is funded." />
      {deferred.length > 40 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          Showing the 40 highest-value deferrals of {deferred.length.toLocaleString()}.
        </div>
      )}

      <h4 style={{ marginTop: 28 }}>Funding programs</h4>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
        Synthetic placeholder. Annual totals do not decompose by date, so they are not scoped to the
        selected period; period cost is computed separately from scheduled work orders.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.programs.map((program) => {
          const periodOrders = data.workOrders.filter(
            (wo) => wo.program_id === program.id && inDateRange(wo.scheduled_date, dateRange),
          )
          const periodCost = periodOrders.reduce((s, wo) => s + wo.cost_estimate, 0)
          const pct = Math.min(100, (program.budget_spent / program.budget_total) * 100)
          return (
            <div key={program.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ fontSize: 14 }}>{program.name}</strong>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{program.funding_source}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
                <span>FY total</span>
                <span>${Math.round(program.budget_spent).toLocaleString()} / ${Math.round(program.budget_total).toLocaleString()}</span>
              </div>
              <div style={barTrack}><div style={{ ...barFill, width: `${pct}%` }} /></div>
              <div style={{ display: 'flex', gap: 18, marginTop: 10 }}>
                <Stat label="Work orders this period" value={periodOrders.length} />
                <Stat label="Est. cost this period" value={`$${Math.round(periodCost).toLocaleString()}`} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ProgramTable({ rows, showConsequence, empty }: { rows: Candidate[]; showConsequence?: boolean; empty: string }) {
  if (rows.length === 0) return <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{empty}</div>
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={th}>Road</th>
          <th style={th}>Class</th>
          <th style={th}>Condition</th>
          <th style={th}>Treatment</th>
          <th style={th}>Cost</th>
          {showConsequence && <th style={th}>Yrs to rebuild</th>}
          {showConsequence && <th style={th}>Rebuild cost</th>}
          <th style={th}>Basis</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.seg.segment_id}>
            <td style={td}>{c.seg.road_name || c.seg.segment_id}</td>
            <td style={td}>{c.seg.functional_class}</td>
            <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{c.condition.toFixed(0)}</td>
            <td style={td}>{c.treatment.label}</td>
            <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>${Math.round(c.cost).toLocaleString()}</td>
            {showConsequence && <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{c.yearsToRebuild ?? '—'}</td>}
            {showConsequence && <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>${Math.round(c.rebuildCost).toLocaleString()}</td>}
            <td style={td}>
              <span className={`badge ${c.seg.tier === 'measured' ? 'badge-good' : 'badge-synthetic'}`}>
                {c.seg.tier === 'measured' ? 'measured' : 'projected'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'critical' }) {
  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 700, color: tone === 'critical' ? 'var(--status-critical)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

const budgetRow: React.CSSProperties = {
  display: 'flex', gap: 28, alignItems: 'flex-end', flexWrap: 'wrap',
  background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '14px 18px', marginBottom: 14,
}
const budgetInputStyle: React.CSSProperties = {
  display: 'block', marginTop: 6, fontSize: 20, fontWeight: 700, padding: '6px 10px',
  border: '1px solid var(--border)', borderRadius: 8, width: 180,
  background: 'var(--page)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
}
const noteBox: React.CSSProperties = {
  background: 'var(--surface-1)', border: '1px solid var(--border)', borderLeft: '3px solid var(--status-warning)',
  borderRadius: 8, padding: '10px 14px', fontSize: 12, lineHeight: 1.55,
  color: 'var(--text-secondary)', marginBottom: 20,
}
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 13,
  background: 'var(--surface-1)', borderRadius: 8, overflow: 'hidden',
}
const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--gridline)',
  color: 'var(--text-secondary)', fontWeight: 600,
}
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--gridline)' }
const card: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--surface-1)',
}
const barTrack: React.CSSProperties = {
  height: 8, borderRadius: 999, background: 'var(--gridline)', marginTop: 6, overflow: 'hidden',
}
const barFill: React.CSSProperties = { height: '100%', background: 'var(--series-blue)', borderRadius: 999 }
