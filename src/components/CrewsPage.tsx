import { useMemo } from 'react'
import { useMaintenanceData } from '../lib/useMaintenanceData'
import { useAppState, inDateRange } from '../lib/AppStateContext'

export function CrewsPage() {
  const { data, loading } = useMaintenanceData()
  const { dateRange } = useAppState()

  const rows = useMemo(() => {
    if (!data) return []
    return data.crews.map((crew) => {
      const workOrders = data.workOrders.filter((wo) => wo.crew_id === crew.id && inDateRange(wo.scheduled_date, dateRange))
      const taskCount = workOrders.reduce((sum, wo) => sum + wo.task_ids.length, 0)
      const cost = workOrders.reduce((sum, wo) => sum + wo.cost_estimate, 0)
      const zone = crew.zone_id ? data.zones.features.find((f: any) => f.properties.zone_id === crew.zone_id) : null
      const zoneName = (zone?.properties as any)?.name ?? 'Countywide'
      return { crew, zoneName, workOrderCount: workOrders.length, taskCount, cost }
    })
  }, [data, dateRange])

  if (loading || !data) return <div style={{ padding: 24 }}>Loading…</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        Crew roster and assignment are synthetic placeholder data — no real personnel system exists to draw from yet.
      </div>
      <div style={gridStyle}>
        {rows.map(({ crew, zoneName, workOrderCount, taskCount, cost }) => (
          <div key={crew.id} style={cardStyle}>
            <strong style={{ fontSize: 14 }}>{crew.name}</strong>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              {zoneName} · {crew.size} people
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
              <Stat label="Work orders" value={workOrderCount} />
              <Stat label="Tasks" value={taskCount} />
              <Stat label="Est. cost" value={`$${Math.round(cost).toLocaleString()}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 12,
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 14,
  background: 'var(--surface-1)',
}
