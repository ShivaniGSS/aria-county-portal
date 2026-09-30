import { useMemo } from 'react'
import { useAppState } from '../lib/AppStateContext'
import { useMaintenanceData } from '../lib/useMaintenanceData'
import { inDateRange } from '../lib/AppStateContext'
import { relevantDate } from '../lib/heatmapColors'
import { derivePriorityTier } from '../lib/taskStatus'

export function StatTileStrip() {
  const { dateRange } = useAppState()
  const { data, loading } = useMaintenanceData()

  const stats = useMemo(() => {
    if (!data) return null
    const now = new Date()
    let critical = 0
    let watch = 0
    let completed = 0
    const activeCrews = new Set<string>()
    let costThisPeriod = 0

    for (const task of data.tasks) {
      const taskType = data.taskTypeById.get(task.task_type_id)
      if (!taskType) continue
      const inPeriod = inDateRange(relevantDate(task, data.workOrderById), dateRange)
      if (!inPeriod) continue

      if (task.status === 'complete') {
        completed++
      } else {
        const tier = derivePriorityTier(task, taskType, now)
        if (tier === 'critical') critical++
        else if (tier === 'watch') watch++
      }
    }

    for (const wo of data.workOrders) {
      if (!inDateRange(wo.scheduled_date, dateRange)) continue
      activeCrews.add(wo.crew_id)
      costThisPeriod += wo.cost_estimate
    }

    return { critical, watch, completed, activeCrews: activeCrews.size, costThisPeriod }
  }, [data, dateRange])

  if (loading || !stats) return <div style={stripStyle}>Loading…</div>

  return (
    <div style={stripStyle}>
      <Tile label="Critical" value={stats.critical} color="var(--status-critical)" />
      <Tile label="Watch" value={stats.watch} color="var(--status-warning)" />
      <Tile label="Completed this period" value={stats.completed} color="var(--status-good)" />
      <Tile label="Crews active this period" value={stats.activeCrews} />
      <Tile label="Est. cost this period" value={`$${Math.round(stats.costThisPeriod).toLocaleString()}`} />
    </div>
  )
}

function Tile({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={tileStyle}>
      <div style={{ ...valueStyle, color: color ?? 'var(--text-primary)' }}>{value}</div>
      <div style={labelStyle}>{label}</div>
    </div>
  )
}

const stripStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  padding: '12px 20px',
  borderBottom: '1px solid var(--gridline)',
  background: 'var(--page)',
}

const tileStyle: React.CSSProperties = {
  flex: 1,
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '10px 14px',
  minWidth: 0,
}

const valueStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  marginTop: 2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
