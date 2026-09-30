export interface TaskType {
  id: string
  family: string
  label: string
  default_target_response_days: number
  severity_weight: number
}

export interface TaskTypeRegistry {
  note: string
  task_types: TaskType[]
}

export type TaskStatus = 'not_started' | 'in_progress' | 'complete'
export type TargetType = 'segment' | 'point_asset'

export interface TaskInstance {
  id: string
  task_type_id: string
  target_type: TargetType
  target_id: string
  segment_id: string
  status: TaskStatus
  date_identified: string // ISO date
  date_completed: string | null
  work_order_id: string | null
  source: 'real' | 'synthetic_placeholder'
  source_detail: string | null
}

export interface Crew {
  id: string
  name: string
  zone_id: string | null
  size: number
  source: 'synthetic_placeholder'
}

export interface WorkOrder {
  id: string
  crew_id: string
  scheduled_date: string // ISO date
  program_id: string
  task_ids: string[]
  cost_estimate: number
  source: 'synthetic_placeholder'
}

export interface Program {
  id: string
  name: string
  funding_source: string
  budget_total: number
  budget_spent: number
  source: 'synthetic_placeholder'
}

export interface PavementConditionInfo {
  iri: number | null
  crs: number | null
  source: 'real' | 'synthetic_placeholder'
}

export interface SegmentProperties {
  segment_id: string
  road_name: string
  functional_class: string | null
  aadt: number | null
  aadt_year: string | null
  speed_limit: string | null
  lanes: number | null
  township: string | null
  zone_id: string
  seg_length_mi: string | null
  pavement_condition: PavementConditionInfo
  source: 'real'
  source_detail: string
}

export interface ZoneProperties {
  zone_id: string
  name: string
  source: 'real'
  source_detail: string
}

/** normal < watch < critical < complete (terminal) */
export type PriorityTier = 'complete' | 'normal' | 'watch' | 'critical'

export const PRIORITY_ORDER: Record<PriorityTier, number> = {
  complete: 0,
  normal: 1,
  watch: 2,
  critical: 3,
}
