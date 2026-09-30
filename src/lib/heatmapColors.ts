import type { DateRange } from './dateMath'
import { inDateRange } from './AppStateContext'
import { PRIORITY_ORDER, type PriorityTier, type TaskInstance, type TaskType, type WorkOrder } from './maintenanceTypes'
import { derivePriorityTier, deriveSegmentWorstStatus } from './taskStatus'

export const TIER_COLORS: Record<PriorityTier | 'none', string> = {
  none: '#c3c2b7', // muted gray -- no open task on this segment
  normal: '#0ca30c',
  watch: '#fab219',
  critical: '#d03b3b',
  complete: '#0ca30c',
}

export interface HeatmapFilters {
  taskTypeFilter: Set<string> | null
  tierFilter: Set<PriorityTier> | null
  dateRange: DateRange | null
}

/** A task's "relevant date" for period filtering: its work order's scheduled date
 * if it has one, otherwise the date it was identified (still sitting in the backlog). */
export function relevantDate(task: TaskInstance, workOrderById: Map<string, WorkOrder>): string {
  if (task.work_order_id) {
    const wo = workOrderById.get(task.work_order_id)
    if (wo) return wo.scheduled_date
  }
  return task.date_identified
}

function passesFilters(
  task: TaskInstance,
  taskType: TaskType,
  workOrderById: Map<string, WorkOrder>,
  filters: HeatmapFilters,
  now: Date,
): boolean {
  if (filters.taskTypeFilter && !filters.taskTypeFilter.has(task.task_type_id)) return false
  if (!inDateRange(relevantDate(task, workOrderById), filters.dateRange)) return false
  if (filters.tierFilter) {
    const tier = derivePriorityTier(task, taskType, now)
    if (!filters.tierFilter.has(tier)) return false
  }
  return true
}

/** Worst open-task tier per segment_id, after applying the active filters. */
export function computeSegmentTiers(
  tasks: TaskInstance[],
  taskTypeById: Map<string, TaskType>,
  workOrderById: Map<string, WorkOrder>,
  filters: HeatmapFilters,
  now: Date,
): Map<string, PriorityTier | null> {
  const filtered = tasks.filter((t) => {
    const tt = taskTypeById.get(t.task_type_id)
    return tt && passesFilters(t, tt, workOrderById, filters, now)
  })

  const bySegment = new Map<string, TaskInstance[]>()
  for (const t of filtered) {
    const list = bySegment.get(t.segment_id) ?? []
    list.push(t)
    bySegment.set(t.segment_id, list)
  }

  const result = new Map<string, PriorityTier | null>()
  for (const [segmentId, segTasks] of bySegment) {
    result.set(segmentId, deriveSegmentWorstStatus(segmentId, segTasks, taskTypeById, now))
  }
  return result
}

/** Worst tier among all segments belonging to each zone. */
export function computeZoneTiers(
  segments: GeoJSON.FeatureCollection,
  segmentTiers: Map<string, PriorityTier | null>,
): Map<string, PriorityTier | null> {
  const result = new Map<string, PriorityTier | null>()
  for (const feat of segments.features) {
    const props = feat.properties as { segment_id: string; zone_id: string }
    const tier = segmentTiers.get(props.segment_id) ?? null
    if (!tier) continue
    const current = result.get(props.zone_id) ?? null
    if (!current || PRIORITY_ORDER[tier] > PRIORITY_ORDER[current]) {
      result.set(props.zone_id, tier)
    }
  }
  return result
}
