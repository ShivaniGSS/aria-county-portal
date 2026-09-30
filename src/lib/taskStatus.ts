import type { PriorityTier, TaskInstance, TaskType } from './maintenanceTypes'
import { parseIsoDateLocal } from './dateMath'

/**
 * Single source of truth for status/priority derivation -- imported by the heatmap,
 * table, and calendar. Never reimplement this logic per-view; if it needs to change,
 * change it here so every view stays consistent.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export function deriveDateTarget(task: TaskInstance, taskType: TaskType): Date {
  const identified = parseIsoDateLocal(task.date_identified)
  return new Date(identified.getTime() + taskType.default_target_response_days * DAY_MS)
}

/**
 * complete: date_completed is set -- terminal, aging stops regardless of how it went.
 * normal: not yet past its target response window.
 * watch: past target, but not yet by a full extra window.
 * critical: past target by more than a full extra window -- the "sat too long, bump
 * it up" escalation the county-engineer workflow asked for. The clock keeps running
 * for in_progress tasks too (started-but-stalled work still ages).
 */
export function derivePriorityTier(task: TaskInstance, taskType: TaskType, now: Date): PriorityTier {
  if (task.status === 'complete') return 'complete'

  const target = deriveDateTarget(task, taskType)
  const daysOverdue = (now.getTime() - target.getTime()) / DAY_MS
  if (daysOverdue <= 0) return 'normal'
  if (daysOverdue <= taskType.default_target_response_days) return 'watch'
  return 'critical'
}

export function daysOpen(task: TaskInstance, now: Date): number {
  const identified = parseIsoDateLocal(task.date_identified)
  const end = task.date_completed ? parseIsoDateLocal(task.date_completed) : now
  return Math.round((end.getTime() - identified.getTime()) / DAY_MS)
}

/** Sortable composite score -- higher = more urgent. Ties broken by severity, then age. */
export function priorityScore(task: TaskInstance, taskType: TaskType, now: Date): number {
  const tier = derivePriorityTier(task, taskType, now)
  const tierRank = { complete: 0, normal: 1, watch: 2, critical: 3 }[tier]
  const overdueDays = Math.max(0, (now.getTime() - deriveDateTarget(task, taskType).getTime()) / DAY_MS)
  return tierRank * 10_000 + taskType.severity_weight * 100 + Math.min(overdueDays, 99)
}

/**
 * Worst tier among a segment's OPEN (non-complete) tasks only -- what the
 * segment-coloring heatmap mode paints. Returns null if the segment has no open
 * tasks (nothing to flag, not the same as "everything's fine forever").
 */
export function deriveSegmentWorstStatus(
  segmentId: string,
  tasks: TaskInstance[],
  taskTypeById: Map<string, TaskType>,
  now: Date,
): PriorityTier | null {
  let worst: PriorityTier | null = null
  const order: Record<PriorityTier, number> = { complete: 0, normal: 1, watch: 2, critical: 3 }
  for (const task of tasks) {
    if (task.segment_id !== segmentId || task.status === 'complete') continue
    const taskType = taskTypeById.get(task.task_type_id)
    if (!taskType) continue
    const tier = derivePriorityTier(task, taskType, now)
    if (worst === null || order[tier] > order[worst]) worst = tier
  }
  return worst
}
