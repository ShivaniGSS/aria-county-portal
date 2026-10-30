import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { PriorityTier } from './maintenanceTypes'
import { addPeriod, computePeriodRange, isoDate, parseIsoDateLocal, type DateRange, type PeriodType } from './dateMath'

export type { DateRange } from './dateMath'
export type Page = 'roads' | 'county' | 'condition' | 'programming' | 'overview' | 'map' | 'table' | 'crews'
export type HeatmapMode = 'segment' | 'zone'

/**
 * Where the user is in the county -> segment -> asset class -> asset drill-down.
 * It lives here, not inside a page, because two pages share it: the county map sets
 * it, the condition page reads it, and the floating map follows it across both.
 */
export interface Selection {
  segmentId: string | null
  classId: string | null
  assetId: string | null
}

const NO_SELECTION: Selection = { segmentId: null, classId: null, assetId: null }

interface AppState {
  page: Page
  setPage: (p: Page) => void

  selection: Selection
  /** Move to a level of the drill-down. Omitted levels below the one given are cleared. */
  drillTo: (sel: Partial<Selection>) => void

  // The primary time-period filter -- day/week/month/all, driving every other view.
  periodType: PeriodType
  periodAnchor: string // ISO date the period is computed relative to
  dateRange: DateRange | null // derived from (periodType, periodAnchor); null = 'all'
  setPeriodType: (t: PeriodType) => void
  setPeriodAnchor: (iso: string) => void
  goToPrevPeriod: () => void
  goToNextPeriod: () => void
  goToToday: () => void

  taskTypeFilter: Set<string> | null // null = all task types
  setTaskTypeFilter: (f: Set<string> | null) => void
  tierFilter: Set<PriorityTier> | null // null = all tiers
  setTierFilter: (f: Set<PriorityTier> | null) => void
  heatmapMode: HeatmapMode
  setHeatmapMode: (m: HeatmapMode) => void
}

const AppStateContext = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<Page>('roads')
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  const [periodType, setPeriodType] = useState<PeriodType>('day')
  const [periodAnchor, setPeriodAnchor] = useState<string>(() => isoDate(new Date()))
  const [taskTypeFilter, setTaskTypeFilter] = useState<Set<string> | null>(null)
  const [tierFilter, setTierFilter] = useState<Set<PriorityTier> | null>(null)
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('segment')

  const dateRange = useMemo(
    () => computePeriodRange(periodType, parseIsoDateLocal(periodAnchor)),
    [periodType, periodAnchor],
  )

  // 'all' has no anchor-relative direction to step, and stepping away from it should
  // resume from wherever the anchor was left rather than resetting to today.
  const goToPrevPeriod = useCallback(() => {
    if (periodType === 'all') return
    setPeriodAnchor((iso) => isoDate(addPeriod(periodType, parseIsoDateLocal(iso), -1)))
  }, [periodType])
  const goToNextPeriod = useCallback(() => {
    if (periodType === 'all') return
    setPeriodAnchor((iso) => isoDate(addPeriod(periodType, parseIsoDateLocal(iso), 1)))
  }, [periodType])
  const goToToday = useCallback(() => setPeriodAnchor(isoDate(new Date())), [])

  // Naming a level implicitly leaves the ones below it: picking a different asset class
  // must not keep the previously selected asset, which belongs to the old class.
  const drillTo = useCallback((sel: Partial<Selection>) => {
    setSelection((prev) => ({
      segmentId: sel.segmentId !== undefined ? sel.segmentId : prev.segmentId,
      classId: sel.segmentId !== undefined && sel.classId === undefined ? null : sel.classId ?? null,
      assetId: sel.assetId ?? null,
    }))
  }, [])

  const value = useMemo(
    () => ({
      page, setPage,
      selection, drillTo,
      periodType, periodAnchor, dateRange, setPeriodType, setPeriodAnchor,
      goToPrevPeriod, goToNextPeriod, goToToday,
      taskTypeFilter, setTaskTypeFilter,
      tierFilter, setTierFilter,
      heatmapMode, setHeatmapMode,
    }),
    [page, selection, drillTo, periodType, periodAnchor, dateRange, goToPrevPeriod, goToNextPeriod, goToToday, taskTypeFilter, tierFilter, heatmapMode],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within an AppStateProvider')
  return ctx
}

/** A date falls within the active period range, if one is set ('all' => null => no filter). */
export function inDateRange(dateIso: string, range: DateRange | null): boolean {
  if (!range) return true
  return dateIso >= range.start && dateIso <= range.end
}
