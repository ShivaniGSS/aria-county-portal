import { useEffect, useState } from 'react'
import type {
  Crew, Program, TaskInstance, TaskType, WorkOrder,
} from './maintenanceTypes'
import type { ConditionData, ConditionSegment } from './conditionModel'
import type { CountyAssets, CountySegment } from './assetTypes'

export interface MaintenanceData {
  taskTypes: TaskType[]
  taskTypeById: Map<string, TaskType>
  segments: GeoJSON.FeatureCollection
  zones: GeoJSON.FeatureCollection
  tasks: TaskInstance[]
  tasksBySegment: Map<string, TaskInstance[]>
  taskById: Map<string, TaskInstance>
  crews: Crew[]
  crewById: Map<string, Crew>
  workOrders: WorkOrder[]
  workOrderById: Map<string, WorkOrder>
  programs: Program[]
  programById: Map<string, Program>
  signs: GeoJSON.FeatureCollection
  condition: ConditionData
  conditionBySegment: Map<string, ConditionSegment>
  /** The county highway system as ~6-mile planning segments, with their asset drill-down. */
  countyAssets: CountyAssets
  countySegmentById: Map<string, CountySegment>
  countyGeometry: GeoJSON.FeatureCollection
}

let cache: Promise<MaintenanceData> | null = null

async function loadAll(): Promise<MaintenanceData> {
  const [taskTypesRaw, segments, zones, tasksRaw, crewsRaw, workOrdersRaw, programsRaw, signs, condition,
    countyAssets, countyGeometry] =
    await Promise.all([
      fetch('data/task_types.json').then((r) => r.json()),
      fetch('data/maintenance_segments.geojson').then((r) => r.json()),
      fetch('data/maintenance_zones.geojson').then((r) => r.json()),
      fetch('data/maintenance_tasks.json').then((r) => r.json()),
      fetch('data/crews.json').then((r) => r.json()),
      fetch('data/work_orders.json').then((r) => r.json()),
      fetch('data/programs.json').then((r) => r.json()),
      fetch('data/signs_with_segment.geojson').then((r) => r.json()),
      fetch('data/condition.json').then((r) => r.json() as Promise<ConditionData>),
      fetch('data/county_assets.json').then((r) => r.json() as Promise<CountyAssets>),
      fetch('data/county_segments.geojson').then((r) => r.json() as Promise<GeoJSON.FeatureCollection>),
    ])

  const taskTypes: TaskType[] = taskTypesRaw.task_types
  const tasks: TaskInstance[] = tasksRaw.tasks
  const crews: Crew[] = crewsRaw.crews
  const workOrders: WorkOrder[] = workOrdersRaw.work_orders
  const programs: Program[] = programsRaw.programs

  const tasksBySegment = new Map<string, TaskInstance[]>()
  for (const t of tasks) {
    const list = tasksBySegment.get(t.segment_id) ?? []
    list.push(t)
    tasksBySegment.set(t.segment_id, list)
  }

  return {
    taskTypes,
    taskTypeById: new Map(taskTypes.map((t) => [t.id, t])),
    segments,
    zones,
    tasks,
    tasksBySegment,
    taskById: new Map(tasks.map((t) => [t.id, t])),
    crews,
    crewById: new Map(crews.map((c) => [c.id, c])),
    workOrders,
    workOrderById: new Map(workOrders.map((w) => [w.id, w])),
    programs,
    programById: new Map(programs.map((p) => [p.id, p])),
    signs,
    condition,
    conditionBySegment: new Map(condition.segments.map((s) => [s.segment_id, s])),
    countyAssets,
    countySegmentById: new Map(countyAssets.segments.map((s) => [s.segment_id, s])),
    countyGeometry,
  }
}

export function useMaintenanceData() {
  const [data, setData] = useState<MaintenanceData | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!cache) cache = loadAll()
    let cancelled = false
    cache
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [])

  return { data, error, loading: !data && !error }
}
