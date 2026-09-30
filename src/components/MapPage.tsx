import { useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import { MapView, type LayerVisibility } from './MapView'
import { AssetPanel } from './AssetPanel'
import { WaypointPanel } from './WaypointPanel'
import { Legend } from './Legend'
import { PointCloudViewer } from './PointCloudViewer'
import { MaintenanceHeatmapLayer } from './MaintenanceHeatmapLayer'
import type { SignProperties, WaypointProperties } from '../lib/types'
import type { TaskInstance } from '../lib/maintenanceTypes'

type Focus3D = { E: number; N: number; label: string } | 'corridor' | null

interface Props {
  onSelectSegment: (segmentId: string, roadName: string, tasks: TaskInstance[]) => void
}

export function MapPage({ onSelectSegment }: Props) {
  const [visibility, setVisibility] = useState<LayerVisibility>({
    signs: true,
    pavement: true,
    waypoints: true,
  })
  const [selectedSign, setSelectedSign] = useState<SignProperties | null>(null)
  const [selectedWaypoint, setSelectedWaypoint] = useState<WaypointProperties | null>(null)
  const [focus3D, setFocus3D] = useState<Focus3D>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [heatmapOn, setHeatmapOn] = useState(true)

  // Only one of this page's own detail panels shows at a time (a segment selection
  // is owned by the parent dashboard, not this page, so it's handled separately).
  const selectSign = (props: SignProperties) => {
    setSelectedSign(props)
    setSelectedWaypoint(null)
  }
  const selectWaypoint = (props: WaypointProperties) => {
    setSelectedWaypoint(props)
    setSelectedSign(null)
  }
  const selectSegment = (segmentId: string, roadName: string, tasks: TaskInstance[]) => {
    setSelectedSign(null)
    setSelectedWaypoint(null)
    onSelectSegment(segmentId, roadName, tasks)
  }

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <MapView
        visibility={visibility}
        selectedSignId={selectedSign?.sign_id ?? null}
        onSelectSign={selectSign}
        onSelectWaypoint={selectWaypoint}
        onMapReady={setMap}
      />
      {map && <MaintenanceHeatmapLayer map={map} visible={heatmapOn} onSelectSegment={selectSegment} />}

      <Legend
        visibility={visibility}
        onChange={setVisibility}
        onView3DCorridor={() => setFocus3D('corridor')}
        heatmapOn={heatmapOn}
        onToggleHeatmap={() => setHeatmapOn((v) => !v)}
      />

      {selectedSign && (
        <AssetPanel
          sign={selectedSign}
          onClose={() => setSelectedSign(null)}
          onView3D={() => setFocus3D({ E: selectedSign.sign_E_ft, N: selectedSign.sign_N_ft, label: selectedSign.sign_id })}
        />
      )}
      {selectedWaypoint && <WaypointPanel waypoint={selectedWaypoint} onClose={() => setSelectedWaypoint(null)} />}

      {focus3D && (
        <PointCloudViewer
          track="garp_t1"
          focus={focus3D === 'corridor' ? undefined : focus3D}
          onClose={() => setFocus3D(null)}
        />
      )}
    </div>
  )
}
