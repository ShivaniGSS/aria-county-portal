import { useEffect, useState } from 'react'
import { AppStateProvider, useAppState } from './lib/AppStateContext'
import { StatTileStrip } from './components/StatTileStrip'
import { Sidebar } from './components/Sidebar'
import { TimePeriodControl } from './components/TimePeriodControl'
import { MapPage } from './components/MapPage'
import { TaskTable } from './components/TaskTable'
import { OverviewPage } from './components/OverviewPage'
import { CrewsPage } from './components/CrewsPage'
import { ProgrammingPage } from './components/ProgrammingPage'
import { ConditionPage } from './components/ConditionPage'
import { CountyMapPage } from './components/CountyMapPage'
import { FloatingMap } from './components/FloatingMap'
import { MaintenanceTaskPanel } from './components/MaintenanceTaskPanel'
import type { TaskInstance } from './lib/maintenanceTypes'

interface SelectedSegment {
  segmentId: string
  roadName: string
  tasks: TaskInstance[]
}

export default function App() {
  return (
    <AppStateProvider>
      <AppInner />
    </AppStateProvider>
  )
}

function AppInner() {
  const { page, taskTypeFilter, tierFilter, dateRange } = useAppState()
  const [selectedSegment, setSelectedSegment] = useState<SelectedSegment | null>(null)

  const selectSegment = (segmentId: string, roadName: string, tasks: TaskInstance[]) => {
    setSelectedSegment({ segmentId, roadName, tasks })
  }

  // If the active filters no longer include any task on the open segment panel,
  // close it rather than show a now-hidden/irrelevant item. A segment with no
  // tasks at all (empty array) is a legitimate state -- "no tasks on file" -- and
  // must not be treated as "filtered out" (Array.some on [] is always false).
  useEffect(() => {
    if (!selectedSegment) return
    const stillVisible =
      selectedSegment.tasks.length === 0 ||
      selectedSegment.tasks.some((t) => !taskTypeFilter || taskTypeFilter.has(t.task_type_id))
    if (!stillVisible) setSelectedSegment(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskTypeFilter, tierFilter, dateRange])

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <header style={headerStyle}>
        <strong style={{ fontSize: 15 }}>ARIA County Portal</strong>
        <TimePeriodControl />
      </header>

      <StatTileStrip />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {page === 'county' && <CountyMapPage />}
          {page === 'condition' && <ConditionPage />}
          {page === 'programming' && <ProgrammingPage />}
          {page === 'overview' && <OverviewPage onSelectTask={selectSegment} />}
          {page === 'map' && <MapPage onSelectSegment={selectSegment} />}
          {page === 'table' && <TaskTable onSelectTask={selectSegment} />}
          {page === 'crews' && <CrewsPage />}
        </main>
      </div>

      {/* The map follows you off the county page -- graphs are never read without
          the place they describe. */}
      {page !== 'county' && <FloatingMap />}

      {selectedSegment && (
        <MaintenanceTaskPanel
          segmentId={selectedSegment.segmentId}
          roadName={selectedSegment.roadName}
          tasks={selectedSegment.tasks}
          onClose={() => setSelectedSegment(null)}
        />
      )}
    </div>
  )
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 20,
  padding: '10px 20px',
  borderBottom: '1px solid var(--gridline)',
  flexShrink: 0,
}
