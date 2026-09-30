import { useState } from 'react'
import type { WaypointProperties } from '../lib/types'
import { CAM_LABEL } from '../lib/types'

interface Props {
  waypoint: WaypointProperties
  onClose: () => void
}

export function WaypointPanel({ waypoint, onClose }: Props) {
  const [cam, setCam] = useState(waypoint.available_cams[0])

  return (
    <aside style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Road view
          </div>
          <h3 style={{ margin: '4px 0' }}>Capture point {waypoint.upano}</h3>
        </div>
        <button onClick={onClose} style={closeBtn}>
          ✕
        </button>
      </div>

      <img
        src={`data/${waypoint.frame_base}${cam}_2048.jpg`}
        alt={`Facing ${CAM_LABEL[cam]}`}
        style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
      />

      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {waypoint.available_cams.map((c) => (
          <button
            key={c}
            onClick={() => setCam(c)}
            style={{ ...dirBtn, ...(c === cam ? dirBtnActive : {}) }}
          >
            {CAM_LABEL[c] ?? c}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 16 }}>
        Panorama vehicle heading {waypoint.heading.toFixed(0)}°. Source: RuralBench/CV-Code pilot, Boone County.
      </div>
    </aside>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 320,
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  borderRadius: 12,
  padding: 16,
  boxShadow: 'var(--panel-shadow)',
  border: '1px solid var(--border)',
}

const closeBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  fontSize: 16,
  cursor: 'pointer',
  color: 'var(--text-muted)',
}

const dirBtn: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: 13,
}

const dirBtnActive: React.CSSProperties = {
  background: 'var(--series-blue)',
  borderColor: 'var(--series-blue)',
  color: 'white',
  fontWeight: 600,
}
