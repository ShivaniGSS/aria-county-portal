import { useMemo } from 'react'
import { useMaintenanceData } from '../lib/useMaintenanceData'
import { useAppState, inDateRange } from '../lib/AppStateContext'
import { derivePriorityTier, priorityScore, daysOpen } from '../lib/taskStatus'
import { TIER_COLORS } from '../lib/heatmapColors'
import type { TaskInstance } from '../lib/maintenanceTypes'

interface Props {
  onSelectTask: (segmentId: string, roadName: string, tasks: TaskInstance[]) => void
}

export function OverviewPage({ onSelectTask }: Props) {
  const { data, loading } = useMaintenanceData()
  const { dateRange } = useAppState()

  const { topTasks, upcomingWorkOrders } = useMemo(() => {
    if (!data) return { topTasks: [], upcomingWorkOrders: [] }
    const now = new Date()

    const openScored = data.tasks
      .filter((t) => t.status !== 'complete')
      .map((t) => {
        const taskType = data.taskTypeById.get(t.task_type_id)!
        const segment = data.segments.features.find(
          (f: any) => f.properties.segment_id === t.segment_id,
        )?.properties as { road_name?: string } | undefined
        return { task: t, taskType, roadName: segment?.road_name || t.segment_id, score: priorityScore(t, taskType, now) }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    const upcoming = data.workOrders
      .filter((wo) => inDateRange(wo.scheduled_date, dateRange))
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
      .slice(0, 10)

    return { topTasks: openScored, upcomingWorkOrders: upcoming }
  }, [data, dateRange])

  if (loading || !data) return <div style={{ padding: 24 }}>Loading…</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20, display: 'flex', gap: 20 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ marginTop: 0 }}>Top priority tasks</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {topTasks.map(({ task, taskType, roadName }) => {
            const now = new Date()
            const tier = derivePriorityTier(task, taskType, now)
            return (
              <button
                key={task.id}
                style={cardBtnStyle}
                onClick={() => onSelectTask(task.segment_id, roadName, data.tasksBySegment.get(task.segment_id) ?? [])}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 13 }}>{roadName}</strong>
                  <span style={{ ...tierBadge, background: TIER_COLORS[tier] }}>{tier}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {taskType.label} · {daysOpen(task, now)} days open
                  {task.source === 'real' && (
                    <span className="badge badge-critical" style={{ marginLeft: 6 }}>
                      real
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ marginTop: 0 }}>Upcoming work orders (current period)</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {upcomingWorkOrders.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No work orders scheduled in this period.</div>
          )}
          {upcomingWorkOrders.map((wo) => {
            const crew = data.crewById.get(wo.crew_id)
            const program = data.programById.get(wo.program_id)
            return (
              <div key={wo.id} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13 }}>{wo.id}</strong>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{wo.scheduled_date}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{crew?.name ?? wo.crew_id}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {program?.name ?? wo.program_id} · {wo.task_ids.length} task(s) · ${wo.cost_estimate.toLocaleString()}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 10,
  background: 'var(--surface-1)',
}

const cardBtnStyle: React.CSSProperties = {
  ...cardStyle,
  textAlign: 'left',
  cursor: 'pointer',
  width: '100%',
  font: 'inherit',
  color: 'inherit',
}

const tierBadge: React.CSSProperties = {
  color: 'white',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  padding: '2px 8px',
  borderRadius: 999,
}
