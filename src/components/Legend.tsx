import type { LayerVisibility } from './MapView'
import { useAppState, type HeatmapMode } from '../lib/AppStateContext'

interface Props {
  visibility: LayerVisibility
  onChange: (v: LayerVisibility) => void
  onView3DCorridor: () => void
  heatmapOn: boolean
  onToggleHeatmap: () => void
}

export function Legend({ visibility, onChange, onView3DCorridor, heatmapOn, onToggleHeatmap }: Props) {
  const { heatmapMode, setHeatmapMode } = useAppState()
  const toggle = (key: keyof LayerVisibility) => onChange({ ...visibility, [key]: !visibility[key] })

  return (
    <div style={panelStyle}>
      <label style={rowStyle}>
        <input type="checkbox" checked={heatmapOn} onChange={onToggleHeatmap} />
        <strong>Maintenance heatmap</strong>
        <span className="badge badge-synthetic">Mostly synthetic</span>
      </label>
      <div style={{ display: 'flex', gap: 12, marginLeft: 22, marginTop: 4, fontSize: 12 }}>
        {(['segment', 'zone'] as HeatmapMode[]).map((m) => (
          <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="radio" name="heatmapMode" checked={heatmapMode === m} onChange={() => setHeatmapMode(m)} />
            {m === 'segment' ? 'Color roads' : 'Zone (township)'}
          </label>
        ))}
      </div>

      <div style={dividerStyle} />

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        GardenPrairie Rd pilot corridor layers
      </div>

      <label style={rowStyle}>
        <input type="checkbox" checked={visibility.signs} onChange={() => toggle('signs')} />
        <span>Asset inventory (signs)</span>
      </label>
      <div style={legendRow}>
        <Swatch color="#0ca30c" /> Confirmed
        <Swatch color="#d03b3b" /> Flagged
      </div>

      <label style={rowStyle}>
        <input type="checkbox" checked={visibility.pavement} onChange={() => toggle('pavement')} />
        <span>Pavement condition</span>
        <span className="badge badge-synthetic">Synthetic</span>
      </label>
      <div style={legendRow}>
        <Swatch color="#0ca30c" /> Good
        <Swatch color="#fab219" /> Fair
        <Swatch color="#d03b3b" /> Poor
      </div>

      <label style={rowStyle}>
        <input type="checkbox" checked={visibility.waypoints} onChange={() => toggle('waypoints')} />
        <span>Road photo waypoints</span>
      </label>

      <button style={btnStyle} onClick={onView3DCorridor}>
        View full corridor in 3D
      </button>

      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.4 }}>
        Pavement condition is fabricated placeholder data pending uGRIDD sensor
        integration — not measured. All other layers are real detections from the
        RuralBench/CV-Code Boone County pilot.
      </div>
    </div>
  )
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        marginRight: 4,
      }}
    />
  )
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  width: 260,
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  borderRadius: 12,
  padding: 16,
  boxShadow: 'var(--panel-shadow)',
  border: '1px solid var(--border)',
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'var(--gridline)',
  margin: '14px 0',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  marginTop: 10,
  cursor: 'pointer',
}

const legendRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: 'var(--text-secondary)',
  marginLeft: 22,
  marginTop: 4,
}

const btnStyle: React.CSSProperties = {
  marginTop: 14,
  width: '100%',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '8px 12px',
  cursor: 'pointer',
  fontSize: 13,
}
