import { useMaintenanceData } from '../lib/useMaintenanceData'
import { derivePriorityTier, daysOpen } from '../lib/taskStatus'
import { TIER_COLORS } from '../lib/heatmapColors'
import type { TaskInstance } from '../lib/maintenanceTypes'

interface Props {
  segmentId: string
  roadName: string
  tasks: TaskInstance[]
  onClose: () => void
}

export function MaintenanceTaskPanel({ roadName, tasks, onClose }: Props) {
  const { data } = useMaintenanceData()
  if (!data) return null

  const now = new Date()

  return (
    <aside style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Segment
          </div>
          <h3 style={{ margin: '4px 0' }}>{roadName || 'Unnamed segment'}</h3>
        </div>
        <button onClick={onClose} style={closeBtn}>
          ✕
        </button>
      </div>

      {tasks.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12 }}>No maintenance tasks on file.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        {tasks.map((task) => {
          const taskType = data.taskTypeById.get(task.task_type_id)
          if (!taskType) return null
          const tier = derivePriorityTier(task, taskType, now)
          const wo = task.work_order_id ? data.workOrderById.get(task.work_order_id) : null
          const crew = wo ? data.crewById.get(wo.crew_id) : null

          return (
            <div key={task.id} style={taskCardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 13 }}>{taskType.label}</strong>
                <span style={{ ...tierBadge, background: TIER_COLORS[tier] }}>{tier}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                Status: {task.status.replace('_', ' ')} · {daysOpen(task, now)} days open
              </div>
              {wo && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Work order {wo.id} · {crew?.name ?? wo.crew_id} · scheduled {wo.scheduled_date}
                </div>
              )}
              {task.source === 'real' ? (
                <div style={{ fontSize: 11, marginTop: 6 }}>
                  <span className="badge badge-critical" style={{ marginRight: 4 }}>
                    Real detection
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    the compliance flag is real; the crew/work-order/dates above are illustrative.
                  </span>
                  {task.source_detail && (
                    <div style={{ marginTop: 2, color: 'var(--text-secondary)' }}>{task.source_detail}</div>
                  )}
                </div>
              ) : (
                <span className="badge badge-synthetic" style={{ marginTop: 6 }}>
                  Synthetic
                </span>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 340,
  maxHeight: 'calc(100% - 32px)',
  overflowY: 'auto',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  borderRadius: 12,
  padding: 16,
  boxShadow: 'var(--panel-shadow)',
  border: '1px solid var(--border)',
}

const closeBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  fontSize: 16,
  cursor: 'pointer',
  color: 'var(--text-muted)',
}

const taskCardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 10,
}

const tierBadge: React.CSSProperties = {
  color: 'white',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  padding: '2px 8px',
  borderRadius: 999,
}
