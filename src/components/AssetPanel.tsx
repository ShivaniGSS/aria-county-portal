import type { SignProperties } from '../lib/types'

interface Props {
  sign: SignProperties
  onClose: () => void
  onView3D: () => void
}

function fmt(n: number | null, unit: string) {
  return n === null ? '—' : `${n.toFixed(1)} ${unit}`
}

export function AssetPanel({ sign, onClose, onView3D }: Props) {
  return (
    <aside style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Asset · {sign.sign_type.replace(/_/g, ' ')}
          </div>
          <h3 style={{ margin: '4px 0' }}>{sign.sign_id}</h3>
        </div>
        <button onClick={onClose} style={closeBtn}>
          ✕
        </button>
      </div>

      <span className={`badge ${sign.review_status === 'flagged' ? 'badge-critical' : 'badge-good'}`}>
        {sign.review_status === 'flagged' ? '⚑ Flagged for review' : '✓ Confirmed'}
      </span>

      {sign.violations.length > 0 && (
        <ul style={{ marginTop: 10, paddingLeft: 18, color: 'var(--status-critical)', fontSize: 13 }}>
          {sign.violations.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      )}

      {sign.crop_image && (
        <img
          src={`data/${sign.crop_image}`}
          alt={`Detected ${sign.sign_type}`}
          style={{ width: '100%', borderRadius: 8, marginTop: 12, border: '1px solid var(--border)' }}
        />
      )}

      <dl style={dlStyle}>
        <dt>Height above pavement</dt>
        <dd>{fmt(sign.height_above_pavement_ft, 'ft')}</dd>
        <dt>Lateral clearance</dt>
        <dd>{fmt(sign.lateral_clearance_ft, 'ft')}</dd>
        <dt>Detection confidence</dt>
        <dd>{sign.detection_confidence !== null ? `${(sign.detection_confidence * 100).toFixed(0)}%` : '—'}</dd>
        <dt>Facing / range</dt>
        <dd>
          {sign.face} · {fmt(sign.range_ft, 'ft')}
        </dd>
      </dl>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={primaryBtn} onClick={onView3D}>
          View in 3D
        </button>
        {sign.frame_image && (
          <a href={`data/${sign.frame_image}`} target="_blank" rel="noreferrer" style={secondaryBtnLink}>
            Full frame
          </a>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 16 }}>
        Source: RuralBench/CV-Code pilot data, Boone County ({sign.source}).
      </div>
    </aside>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 320,
  maxHeight: 'calc(100% - 32px)',
  overflowY: 'auto',
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

const dlStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  rowGap: 6,
  columnGap: 12,
  fontSize: 13,
  marginTop: 14,
}

const primaryBtn: React.CSSProperties = {
  background: 'var(--series-blue)',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  padding: '8px 14px',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
}

const secondaryBtnLink: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  color: 'var(--text-primary)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
}
