import { useMaintenanceData } from '../lib/useMaintenanceData'
import { useAppState, type Page } from '../lib/AppStateContext'
import type { PriorityTier } from '../lib/maintenanceTypes'

const TIERS: PriorityTier[] = ['normal', 'watch', 'critical']
// Planning is the spine; operations sits beneath it.
const NAV: { id: Page; label: string; group: 'Surveyed' | 'Planning' | 'Operations' }[] = [
  { id: 'roads', label: 'Surveyed roads', group: 'Surveyed' },
  { id: 'county', label: 'County map', group: 'Planning' },
  { id: 'condition', label: 'Condition', group: 'Planning' },
  { id: 'programming', label: 'Programming', group: 'Planning' },
  { id: 'map', label: 'Survey corridors', group: 'Operations' },
  { id: 'overview', label: 'Overview', group: 'Operations' },
  { id: 'table', label: 'Table', group: 'Operations' },
  { id: 'crews', label: 'Resources', group: 'Operations' },
]

export function Sidebar() {
  const { data } = useMaintenanceData()
  const { page, setPage, taskTypeFilter, setTaskTypeFilter, tierFilter, setTierFilter } = useAppState()

  const toggleTaskType = (id: string) => {
    const next = new Set(taskTypeFilter ?? [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setTaskTypeFilter(next.size === 0 ? null : next)
  }

  const toggleTier = (tier: PriorityTier) => {
    const next = new Set(tierFilter ?? TIERS)
    if (next.has(tier)) next.delete(tier)
    else next.add(tier)
    setTierFilter(next.size === TIERS.length ? null : next)
  }

  return (
    <nav style={sidebarStyle}>
      <div>
        {(['Surveyed', 'Planning', 'Operations'] as const).map((group) => (
          <div key={group} style={{ marginBottom: 10 }}>
            <div style={groupLabel}>{group}</div>
            {NAV.filter((n) => n.group === group).map((n) => (
              <button key={n.id} onClick={() => setPage(n.id)} style={{ ...navBtnStyle, ...(page === n.id ? navBtnActive : {}) }}>
                {n.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {page !== 'roads' && <>
      <div style={dividerStyle} />

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Priority</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {TIERS.map((tier) => {
          const active = !tierFilter || tierFilter.has(tier)
          return (
            <button key={tier} onClick={() => toggleTier(tier)} style={{ ...chipStyle, opacity: active ? 1 : 0.4 }}>
              {tier}
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginTop: 16 }}>Task type</div>
      <div style={taskListStyle}>
        {data?.taskTypes.map((tt) => (
          <label key={tt.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 0', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!taskTypeFilter || taskTypeFilter.has(tt.id)}
              onChange={() => toggleTaskType(tt.id)}
            />
            {tt.label}
          </label>
        ))}
      </div>
      </>}
    </nav>
  )
}

const sidebarStyle: React.CSSProperties = {
  width: 220,
  flexShrink: 0,
  borderRight: '1px solid var(--gridline)',
  padding: 16,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
}

const groupLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  padding: '0 10px 4px',
}

const navBtnStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  marginBottom: 2,
}

const navBtnActive: React.CSSProperties = {
  background: 'var(--series-blue)',
  color: 'white',
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'var(--gridline)',
  margin: '14px 0',
}

const chipStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-primary)',
  borderRadius: 999,
  padding: '3px 10px',
  fontSize: 11,
  textTransform: 'capitalize',
  cursor: 'pointer',
}

const taskListStyle: React.CSSProperties = {
  marginTop: 6,
  overflowY: 'auto',
  paddingTop: 4,
}
