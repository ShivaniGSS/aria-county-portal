import { useEffect, useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import { useAppState } from '../lib/AppStateContext'
import { useMaintenanceData } from '../lib/useMaintenanceData'
import { computeSegmentTiers, computeZoneTiers, TIER_COLORS } from '../lib/heatmapColors'
import type { TaskInstance } from '../lib/maintenanceTypes'

interface Props {
  map: maplibregl.Map
  visible: boolean
  onSelectSegment: (segmentId: string, roadName: string, tasks: TaskInstance[]) => void
}

function whenStyleReady(map: maplibregl.Map, cb: () => void) {
  if (map.isStyleLoaded()) cb()
  else map.once('load', cb)
}

const TIER_MATCH_EXPR = [
  'match',
  ['get', 'worst_tier'],
  'critical', TIER_COLORS.critical,
  'watch', TIER_COLORS.watch,
  'normal', TIER_COLORS.normal,
  TIER_COLORS.none,
]

export function MaintenanceHeatmapLayer({ map, visible, onSelectSegment }: Props) {
  const { heatmapMode, taskTypeFilter, tierFilter, dateRange } = useAppState()
  const { data } = useMaintenanceData()
  const [ready, setReady] = useState(false)

  // Add sources/layers once, when both the map style and the data are ready.
  useEffect(() => {
    if (!data || ready) return

    whenStyleReady(map, () => {
      if (map.getSource('maintenance-segments')) {
        setReady(true)
        return
      }

      map.addSource('maintenance-segments', { type: 'geojson', data: data.segments })
      map.addSource('maintenance-zones', { type: 'geojson', data: data.zones })

      map.addLayer({
        id: 'maintenance-segments-line',
        type: 'line',
        source: 'maintenance-segments',
        layout: { visibility: 'none' },
        paint: { 'line-width': 3, 'line-color': TIER_MATCH_EXPR as any },
      })

      map.addLayer({
        id: 'maintenance-zones-fill',
        type: 'fill',
        source: 'maintenance-zones',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': TIER_MATCH_EXPR as any,
          'fill-opacity': 0.35,
          'fill-outline-color': '#52514e',
        },
      })

      map.on('click', 'maintenance-segments-line', (e) => {
        const f = e.features?.[0]
        if (!f) return
        const segId = f.properties!.segment_id as string
        const roadName = (f.properties!.road_name as string) || segId
        const tasks = data.tasksBySegment.get(segId) ?? []
        onSelectSegment(segId, roadName, tasks)
      })
      map.on('mouseenter', 'maintenance-segments-line', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'maintenance-segments-line', () => (map.getCanvas().style.cursor = ''))

      setReady(true)
    })
  }, [data, map, onSelectSegment, ready])

  // Toggle which heatmap mode (segment vs zone) is visible, and whether the whole
  // heatmap group is shown at all.
  useEffect(() => {
    if (!ready) return
    const showSegments = visible && heatmapMode === 'segment'
    const showZones = visible && heatmapMode === 'zone'
    map.setLayoutProperty('maintenance-segments-line', 'visibility', showSegments ? 'visible' : 'none')
    map.setLayoutProperty('maintenance-zones-fill', 'visibility', showZones ? 'visible' : 'none')
  }, [map, visible, heatmapMode, ready])

  // Recompute worst-tier colors whenever the underlying data or active filters change.
  useEffect(() => {
    if (!data || !ready) return
    const now = new Date()
    const filters = { taskTypeFilter, tierFilter, dateRange }
    const segmentTiers = computeSegmentTiers(data.tasks, data.taskTypeById, data.workOrderById, filters, now)

    const segmentsWithTier: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: data.segments.features.map((f) => {
        const segId = (f.properties as any).segment_id
        return { ...f, properties: { ...f.properties, worst_tier: segmentTiers.get(segId) ?? null } }
      }),
    }
    const segSource = map.getSource('maintenance-segments') as maplibregl.GeoJSONSource | undefined
    segSource?.setData(segmentsWithTier)

    const zoneTiers = computeZoneTiers(data.segments, segmentTiers)
    const zonesWithTier: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: data.zones.features.map((f) => {
        const zoneId = (f.properties as any).zone_id
        return { ...f, properties: { ...f.properties, worst_tier: zoneTiers.get(zoneId) ?? null } }
      }),
    }
    const zoneSource = map.getSource('maintenance-zones') as maplibregl.GeoJSONSource | undefined
    zoneSource?.setData(zonesWithTier)
  }, [data, map, taskTypeFilter, tierFilter, dateRange, ready])

  return null
}
