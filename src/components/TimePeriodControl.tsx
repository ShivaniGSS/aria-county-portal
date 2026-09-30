import { useMemo, useState } from 'react'
import { useAppState } from '../lib/AppStateContext'
import { useMaintenanceData } from '../lib/useMaintenanceData'
import { addPeriod, formatPeriodLabel, isoDate, parseIsoDateLocal, type PeriodType } from '../lib/dateMath'
import { inDateRange } from '../lib/AppStateContext'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PERIOD_TYPES: PeriodType[] = ['day', 'week', 'month', 'all']

export function TimePeriodControl() {
  const { periodType, periodAnchor, dateRange, setPeriodType, setPeriodAnchor, goToPrevPeriod, goToNextPeriod, goToToday } =
    useAppState()
  const { data } = useMaintenanceData()
  const [popoverOpen, setPopoverOpen] = useState(false)

  const anchorDate = parseIsoDateLocal(periodAnchor)
  // The popover browses its own month independently of the live filter, until a day is clicked.
  const [browseCursor, setBrowseCursor] = useState(() => ({ year: anchorDate.getFullYear(), month: anchorDate.getMonth() }))

  const workOrderCountByDate = useMemo(() => {
    const map = new Map<string, number>()
    if (!data) return map
    for (const wo of data.workOrders) map.set(wo.scheduled_date, (map.get(wo.scheduled_date) ?? 0) + 1)
    return map
  }, [data])

  const openPopover = () => {
    setBrowseCursor({ year: anchorDate.getFullYear(), month: anchorDate.getMonth() })
    setPopoverOpen((v) => !v)
  }

  const pickDay = (iso: string) => {
    setPeriodAnchor(iso)
    if (periodType === 'all') setPeriodType('day')
    setPopoverOpen(false)
  }

  const firstOfMonth = new Date(browseCursor.year, browseCursor.month, 1)
  const daysInMonth = new Date(browseCursor.year, browseCursor.month + 1, 0).getDate()
  const startWeekday = firstOfMonth.getDay()
  const cells: (number | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={segmentedStyle}>
        {PERIOD_TYPES.map((pt) => (
          <button
            key={pt}
            onClick={() => setPeriodType(pt)}
            style={{ ...segmentBtnStyle, ...(periodType === pt ? segmentBtnActive : {}) }}
          >
            {pt === 'all' ? 'All' : pt.charAt(0).toUpperCase() + pt.slice(1)}
          </button>
        ))}
      </div>

      {periodType !== 'all' && (
        <button style={navBtn} onClick={goToPrevPeriod} aria-label="Previous period">
          ◀
        </button>
      )}
      <strong style={{ fontSize: 13, minWidth: 150, textAlign: 'center' }}>{formatPeriodLabel(periodType, anchorDate)}</strong>
      {periodType !== 'all' && (
        <button style={navBtn} onClick={goToNextPeriod} aria-label="Next period">
          ▶
        </button>
      )}

      <button style={navBtn} onClick={goToToday}>
        Today
      </button>
      <button style={navBtn} onClick={openPopover} aria-label="Jump to date">
        📅
      </button>

      {popoverOpen && (
        <div style={popoverStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <button
              style={navBtn}
              onClick={() => setBrowseCursor((c) => normalizeMonth(c.year, c.month - 1))}
            >
              ←
            </button>
            <strong style={{ fontSize: 13 }}>{firstOfMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
            <button
              style={navBtn}
              onClick={() => setBrowseCursor((c) => normalizeMonth(c.year, c.month + 1))}
            >
              →
            </button>
          </div>
          <div style={gridStyle}>
            {WEEKDAYS.map((w) => (
              <div key={w} style={weekdayStyle}>
                {w}
              </div>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <div key={`e${i}`} />
              const iso = isoDate(browseCursor.year, browseCursor.month, day)
              const count = workOrderCountByDate.get(iso) ?? 0
              const inRange = inDateRange(iso, dateRange)
              return (
                <button key={iso} style={{ ...dayCellStyle, ...(inRange ? dayCellInRange : {}) }} onClick={() => pickDay(iso)}>
                  <div>{day}</div>
                  {count > 0 && <div style={dayCountStyle}>{count}</div>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function normalizeMonth(year: number, month: number) {
  if (month < 0) return { year: year - 1, month: 11 }
  if (month > 11) return { year: year + 1, month: 0 }
  return { year, month }
}

const segmentedStyle: React.CSSProperties = {
  display: 'flex',
  border: '1px solid var(--border)',
  borderRadius: 8,
  overflow: 'hidden',
}

const segmentBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}

const segmentBtnActive: React.CSSProperties = {
  background: 'var(--series-blue)',
  color: 'white',
}

const navBtn: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '5px 9px',
  cursor: 'pointer',
  fontSize: 12,
}

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: '110%',
  left: 0,
  zIndex: 50,
  width: 280,
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: 'var(--panel-shadow)',
  padding: 14,
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 3,
}

const weekdayStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-muted)',
  textAlign: 'center',
  padding: '2px 0',
}

const dayCellStyle: React.CSSProperties = {
  aspectRatio: '1',
  border: '1px solid var(--border)',
  borderRadius: 5,
  background: 'transparent',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 11,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 1,
}

const dayCellInRange: React.CSSProperties = {
  borderColor: 'var(--series-blue)',
  borderWidth: 2,
  background: 'color-mix(in srgb, var(--series-blue) 12%, transparent)',
}

const dayCountStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  color: 'white',
  background: 'var(--series-blue)',
  borderRadius: 999,
  padding: '0 4px',
}
