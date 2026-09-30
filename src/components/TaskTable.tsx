import { useMemo, useState } from 'react'
import { useMaintenanceData } from '../lib/useMaintenanceData'
import { useAppState, inDateRange } from '../lib/AppStateContext'
import { derivePriorityTier, daysOpen, priorityScore } from '../lib/taskStatus'
import { TIER_COLORS } from '../lib/heatmapColors'
import type { TaskInstance } from '../lib/maintenanceTypes'

type SortKey = 'priority' | 'days_open' | 'road' | 'status'

interface Props {
  onSelectTask: (segmentId: string, roadName: string, tasks: TaskInstance[]) => void
}

export function TaskTable({ onSelectTask }: Props) {
  const { data, loading } = useMaintenanceData()
  const { taskTypeFilter, tierFilter, dateRange } = useAppState()
  const [sortKey, setSortKey] = useState<SortKey>('priority')

  const segmentById = useMemo(() => {
    if (!data) return new Map<string, any>()
    return new Map(data.segments.features.map((f: any) => [f.properties.segment_id, f.properties]))
  }, [data])

  const rows = useMemo(() => {
    if (!data) return []
    const now = new Date()
    return data.tasks
      .filter((t) => !taskTypeFilter || taskTypeFilter.has(t.task_type_id))
      .filter((t) => {
        if (!tierFilter) return true
        const tt = data.taskTypeById.get(t.task_type_id)
        return tt && tierFilter.has(derivePriorityTier(t, tt, now))
      })
      .filter((t) => {
        const wo = t.work_order_id ? data.workOrderById.get(t.work_order_id) : null
        const relevantDate = wo ? wo.scheduled_date : t.date_identified
        return inDateRange(relevantDate, dateRange)
      })
      .map((t) => {
        const taskType = data.taskTypeById.get(t.task_type_id)!
        const segment = segmentById.get(t.segment_id)
        const wo = t.work_order_id ? data.workOrderById.get(t.work_order_id) : null
        const crew = wo ? data.crewById.get(wo.crew_id) : null
        const program = wo ? data.programById.get(wo.program_id) : null
        return {
          task: t,
          taskType,
          roadName: segment?.road_name || t.segment_id,
          zone: segment?.zone_id,
          tier: derivePriorityTier(t, taskType, now),
          days: daysOpen(t, now),
          crewName: crew?.name ?? '—',
          workOrderId: wo?.id ?? '—',
          scheduledDate: wo?.scheduled_date ?? '—',
          programName: program?.name ?? '—',
          score: priorityScore(t, taskType, now),
        }
      })
  }, [data, taskTypeFilter, tierFilter, dateRange, segmentById])

  const sorted = useMemo(() => {
    const copy = [...rows]
    switch (sortKey) {
      case 'priority':
        return copy.sort((a, b) => b.score - a.score)
      case 'days_open':
        return copy.sort((a, b) => b.days - a.days)
      case 'road':
        return copy.sort((a, b) => a.roadName.localeCompare(b.roadName))
      case 'status':
        return copy.sort((a, b) => a.task.status.localeCompare(b.task.status))
    }
  }, [rows, sortKey])

  if (loading) return <div style={{ padding: 24 }}>Loading maintenance data…</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0' }}>
        {sorted.length} tasks match the active filters ({rows.filter((r) => r.task.source === 'real').length} real detections,
        rest synthetic placeholder)
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <Th label="Road / segment" onClick={() => setSortKey('road')} />
            <th style={thStyle}>Task type</th>
            <Th label="Status" onClick={() => setSortKey('status')} />
            <th style={thStyle}>Priority</th>
            <Th label="Days open" onClick={() => setSortKey('days_open')} />
            <th style={thStyle}>Crew</th>
            <th style={thStyle}>Work order</th>
            <th style={thStyle}>Scheduled</th>
            <th style={thStyle}>Program</th>
            <th style={thStyle}>Source</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.task.id}
              style={rowStyle}
              onClick={() => onSelectTask(r.task.segment_id, r.roadName, data!.tasksBySegment.get(r.task.segment_id) ?? [])}
            >
              <td style={tdStyle}>{r.roadName}</td>
              <td style={tdStyle}>{r.taskType.label}</td>
              <td style={tdStyle}>{r.task.status.replace('_', ' ')}</td>
              <td style={tdStyle}>
                <span style={{ ...tierBadge, background: TIER_COLORS[r.tier] }}>{r.tier}</span>
              </td>
              <td style={tdStyle}>{r.days}</td>
              <td style={tdStyle}>{r.crewName}</td>
              <td style={tdStyle}>{r.workOrderId}</td>
              <td style={tdStyle}>{r.scheduledDate}</td>
              <td style={tdStyle}>{r.programName}</td>
              <td style={tdStyle}>
                {r.task.source === 'real' ? (
                  <span className="badge badge-critical">real</span>
                ) : (
                  <span className="badge badge-synthetic">synthetic</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <th style={{ ...thStyle, cursor: 'pointer' }} onClick={onClick}>
      {label} ↕
    </th>
  )
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  background: 'var(--surface-1)',
  borderRadius: 8,
  overflow: 'hidden',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--gridline)',
  color: 'var(--text-secondary)',
  fontWeight: 600,
  position: 'sticky',
  top: 0,
  background: 'var(--surface-1)',
}

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--gridline)',
}

const rowStyle: React.CSSProperties = {
  cursor: 'pointer',
}

const tierBadge: React.CSSProperties = {
  color: 'white',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  padding: '2px 8px',
  borderRadius: 999,
}
