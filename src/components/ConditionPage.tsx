import { useMemo } from 'react'
import { useMaintenanceData } from '../lib/useMaintenanceData'
import { useAppState } from '../lib/AppStateContext'
import { ConditionCurve } from './ConditionCurve'
import { NetworkConditionChart, ConditionDistribution } from './NetworkCondition'
import { currentCondition, treatmentsFor, yearsUntilBelow, type CostBasis } from '../lib/conditionModel'
import { conditionColor, type AssetClass, type AssetItem, type CountySegment } from '../lib/assetTypes'

/**
 * Page 2 -- the graphs. Whatever the county map (or the breadcrumb) has selected, this
 * shows its deterioration curve: a whole 6-mile segment, one asset class on it, or one
 * individual asset. The floating map in the corner shows where you are while you read it.
 */
export function ConditionPage() {
  const { data, loading } = useMaintenanceData()
  const { selection, drillTo, setPage } = useAppState()

  const thresholds = data?.countyAssets.thresholds
  const segment = selection.segmentId ? data?.countySegmentById.get(selection.segmentId) : undefined
  const assetClass = segment?.asset_classes.find((c) => c.class_id === selection.classId)
  const asset = assetClass?.assets.find((a) => a.asset_id === selection.assetId)

  if (loading || !data || !thresholds) return <div style={{ padding: 24 }}>Loading the condition model…</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20, paddingBottom: 260 }}>
      <Breadcrumb segment={segment} assetClass={assetClass} asset={asset} />

      {!segment && <CountyLevel data={data} onPick={(id) => drillTo({ segmentId: id })} onMap={() => setPage('county')} />}

      {segment && !assetClass && (
        <SegmentLevel
          segment={segment}
          thresholds={thresholds}
          onPickClass={(classId) => drillTo({ segmentId: segment.segment_id, classId })}
        />
      )}

      {segment && assetClass && !asset && (
        <AssetClassLevel
          segment={segment}
          assetClass={assetClass}
          thresholds={thresholds}
          onPickAsset={(assetId) => drillTo({ segmentId: segment.segment_id, classId: assetClass.class_id, assetId })}
        />
      )}

      {segment && assetClass && asset && (
        <AssetLevel segment={segment} assetClass={assetClass} asset={asset} thresholds={thresholds} />
      )}
    </div>
  )
}

type Thresholds = { desired_min_condition: number; reconstruction_threshold: number }

/* ------------------------------------------------------------------ county */

function CountyLevel({
  data, onPick, onMap,
}: {
  data: NonNullable<ReturnType<typeof useMaintenanceData>['data']>
  onPick: (segmentId: string) => void
  onMap: () => void
}) {
  const segments = data.countyAssets.segments
  const thresholds = data.countyAssets.thresholds

  const ranked = useMemo(
    () => [...segments]
      .map((s) => ({
        seg: s,
        condition: currentCondition(s),
        yearsToRebuild: yearsUntilBelow(s, thresholds.reconstruction_threshold),
      }))
      .sort((a, b) => (a.yearsToRebuild ?? 999) - (b.yearsToRebuild ?? 999) || a.condition - b.condition),
    [segments, thresholds],
  )

  const measured = segments.filter((s) => s.tier === 'measured')
  const totalMiles = segments.reduce((a, s) => a + s.length_mi, 0)
  const assetCount = segments.reduce((a, s) => a + s.asset_classes.reduce((b, c) => b + c.assets.length, 0), 0)
  const realAssets = segments.reduce(
    (a, s) => a + s.asset_classes.reduce((b, c) => b + c.assets.filter((x) => x.real_detection).length, 0), 0)

  return (
    <>
      <div style={calloutGrid}>
        <Callout value={`${measured.length} of ${segments.length}`} label="planning segments have a real IDOT condition reading" tone="good" />
        <Callout value={`${realAssets}`} label={`of ${assetCount} assets come from the ARIA pilot survey`} tone="warning" />
        <Callout value={`${totalMiles.toFixed(0)} mi`} label="county highway system, in ~6-mile planning segments" tone="good" />
      </div>

      <div style={noteBox}>
        <strong>How to read these curves.</strong> {data.countyAssets.note} Synthetic values are drawn
        dashed with an uncertainty band and badged wherever they appear. They are placeholders for a
        survey that hasn't happened — not estimates of those specific roads — and are to be replaced
        wholesale with survey results.
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <NetworkConditionChart segments={segments} desiredMin={thresholds.desired_min_condition} />
        <ConditionDistribution segments={segments} />
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>Reaching rebuild condition soonest</h3>
        <button style={linkBtn} onClick={onMap}>see them on the county map →</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        Pick a segment to open its curve, its asset classes, and the assets on it.
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={th}>Segment</th>
            <th style={th}>Class</th>
            <th style={th}>Miles</th>
            <th style={th}>Condition now</th>
            <th style={th}>Yrs to rebuild</th>
            <th style={th}>Basis</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map(({ seg, condition, yearsToRebuild }) => (
            <tr key={seg.segment_id} style={{ cursor: 'pointer' }} onClick={() => onPick(seg.segment_id)}>
              <td style={td}>{seg.label}</td>
              <td style={td}>{seg.functional_class}</td>
              <td style={num}>{seg.length_mi.toFixed(1)}</td>
              <td style={{ ...num, color: conditionColor(condition), fontWeight: 700 }}>{condition.toFixed(0)}</td>
              <td style={num}>{yearsToRebuild ?? '—'}</td>
              <td style={td}><TierBadge tier={seg.tier} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/* ----------------------------------------------------------------- segment */

function SegmentLevel({
  segment, thresholds, onPickClass,
}: {
  segment: CountySegment
  thresholds: Thresholds
  onPickClass: (classId: string) => void
}) {
  return (
    <>
      <LevelHeading title={segment.label} tier={segment.tier}>
        {segment.functional_class} · {segment.length_mi.toFixed(1)} mi
        {segment.aadt ? ` · ${segment.aadt.toLocaleString()} AADT` : ''}
        {segment.township ? ` · ${segment.township} Township` : ''}
        {segment.surface_year_median ? ` · surfaced ${segment.surface_year_median}` : ' · no surface year on file'}
      </LevelHeading>

      <ChartFrame
        title="Pavement condition over 30 years"
        subtitle="The segment's headline condition is its pavement condition."
      >
        <ConditionCurve
          segment={segment}
          desiredMin={thresholds.desired_min_condition}
          reconstructionThreshold={thresholds.reconstruction_threshold}
          measuredSource="IDOT CRS/IRI"
          syntheticOf={segment.functional_class}
          costBasis={{ treatments: treatmentsFor('pavement'), quantity: segment.length_mi }}
          quantityLabel={`${segment.length_mi.toFixed(1)} mi`}
        />
      </ChartFrame>

      <h4 style={sectionHeading}>Asset classes on this segment</h4>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {segment.asset_classes.map((c) => (
          <button key={c.class_id} style={classCard} onClick={() => onPickClass(c.class_id)}>
            <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 10, alignItems: 'baseline' }}>
              <strong style={{ fontSize: 13 }}>{c.label}</strong>
              <span style={{ fontSize: 17, fontWeight: 700, color: conditionColor(c.condition_now), fontVariantNumeric: 'tabular-nums' }}>
                {c.condition_now.toFixed(0)}
              </span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}>
              {c.assets.length} {c.assets.length === 1 ? 'asset' : 'assets'}
              <TierBadge tier={c.tier} />
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

/* -------------------------------------------------------------- asset class */

function AssetClassLevel({
  segment, assetClass, thresholds, onPickAsset,
}: {
  segment: CountySegment
  assetClass: AssetClass
  thresholds: Thresholds
  onPickAsset: (assetId: string) => void
}) {
  const sorted = [...assetClass.assets].sort((a, b) => a.condition_now - b.condition_now)
  const real = assetClass.assets.filter((a) => a.real_detection).length
  const byMile = assetClass.class_id === 'pavement'
  const basis: CostBasis = {
    treatments: treatmentsFor(assetClass.class_id),
    quantity: byMile ? segment.length_mi : assetClass.assets.length,
  }
  const qty = byMile
    ? `${segment.length_mi.toFixed(1)} mi`
    : `${assetClass.assets.length} ${assetClass.label.toLowerCase()}`

  return (
    <>
      <LevelHeading title={`${assetClass.label} — ${segment.label}`} tier={assetClass.tier}>
        {assetClass.assets.length} {assetClass.assets.length === 1 ? 'asset' : 'assets'} ·{' '}
        {real > 0 ? `${real} from the pilot survey` : 'none surveyed yet'}
      </LevelHeading>

      <ChartFrame
        title={`${assetClass.label} condition across this segment`}
        subtitle={`Class condition is the mean of its assets, on the service life typical of ${assetClass.label.toLowerCase()}. The 55/25 action thresholds come from pavement practice and are applied to every class here as a working assumption.`}
      >
        <ConditionCurve
          segment={{ ...assetClass, length_mi: segment.length_mi }}
          desiredMin={thresholds.desired_min_condition}
          reconstructionThreshold={thresholds.reconstruction_threshold}
          measuredSource="ARIA pilot survey"
          syntheticOf={assetClass.label.toLowerCase()}
          costBasis={basis}
          quantityLabel={qty}
        />
      </ChartFrame>

      <h4 style={sectionHeading}>Assets, worst first</h4>
      <div style={assetGrid}>
        {sorted.map((a) => (
          <button key={a.asset_id} style={assetCard} onClick={() => onPickAsset(a.asset_id)}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <strong style={{ fontSize: 13, textTransform: 'capitalize' }}>{a.label}</strong>
              <span style={{ fontSize: 15, fontWeight: 700, color: conditionColor(a.condition_now), fontVariantNumeric: 'tabular-nums' }}>
                {a.condition_now.toFixed(0)}
              </span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.detail}</span>
            <TierBadge tier={a.tier} />
          </button>
        ))}
      </div>
    </>
  )
}

/* --------------------------------------------------------------- asset item */

function AssetLevel({
  segment, assetClass, asset, thresholds,
}: {
  segment: CountySegment
  assetClass: AssetClass
  asset: AssetItem
  thresholds: Thresholds
}) {
  return (
    <>
      <LevelHeading title={asset.label} tier={asset.tier}>
        {assetClass.label} on {segment.label} · {asset.detail}
      </LevelHeading>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <ChartFrame
          title="Condition over 30 years"
          subtitle={asset.real_detection
            ? 'Anchored on this asset’s own measured compliance from the pilot survey.'
            : 'This asset has not been surveyed; its condition is a synthetic placeholder.'}
        >
          <ConditionCurve
            segment={asset}
            desiredMin={thresholds.desired_min_condition}
            reconstructionThreshold={thresholds.reconstruction_threshold}
            measuredSource="ARIA pilot survey"
            syntheticOf={assetClass.label.toLowerCase()}
            costBasis={{
              treatments: treatmentsFor(assetClass.class_id),
              quantity: assetClass.class_id === 'pavement' ? segment.length_mi : 1,
            }}
            quantityLabel={assetClass.class_id === 'pavement' ? `${segment.length_mi.toFixed(1)} mi` : 'this one'}
          />
        </ChartFrame>

        {asset.crop_image && (
          <figure style={{ margin: 0, maxWidth: 300 }}>
            <img src={`data/${asset.crop_image}`} alt={asset.label}
              style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
            <figcaption style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Detection crop from the ARIA pilot survey · {asset.asset_id}
            </figcaption>
          </figure>
        )}
      </div>
    </>
  )
}

/* -------------------------------------------------------------- shared bits */

function Breadcrumb({
  segment, assetClass, asset,
}: {
  segment?: CountySegment
  assetClass?: AssetClass
  asset?: AssetItem
}) {
  const { drillTo, setPage } = useAppState()
  const crumbs: { label: string; go: () => void }[] = [
    { label: 'Boone County', go: () => drillTo({ segmentId: null }) },
  ]
  if (segment) crumbs.push({ label: segment.label, go: () => drillTo({ segmentId: segment.segment_id }) })
  if (segment && assetClass) {
    crumbs.push({
      label: assetClass.label,
      go: () => drillTo({ segmentId: segment.segment_id, classId: assetClass.class_id }),
    })
  }
  if (asset) crumbs.push({ label: asset.label, go: () => {} })

  const levelName = ['County', 'Segment', 'Asset class', 'Asset'][crumbs.length - 1]

  return (
    <div style={crumbRow}>
      {crumbs.map((c, i) => (
        <span key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {i > 0 && <span style={{ color: 'var(--text-muted)' }}>›</span>}
          {i < crumbs.length - 1
            ? <button style={crumbBtn} onClick={c.go}>{c.label}</button>
            : <strong style={{ textTransform: 'capitalize' }}>{c.label}</strong>}
        </span>
      ))}
      <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({levelName} level)</span>
      <button style={{ ...linkBtn, marginLeft: 'auto' }} onClick={() => setPage('county')}>county map →</button>
    </div>
  )
}

function LevelHeading({
  title, tier, children,
}: {
  title: string
  tier: 'measured' | 'synthetic'
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ margin: 0, textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 10 }}>
        {title} <TierBadge tier={tier} />
      </h3>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{children}</div>
    </div>
  )
}

function ChartFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={chartFrame}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '3px 0 10px' }}>{subtitle}</div>
      {children}
    </div>
  )
}

function TierBadge({ tier }: { tier: 'measured' | 'synthetic' }) {
  return tier === 'measured'
    ? <span className="badge badge-good">measured</span>
    : <span className="badge badge-synthetic">synthetic</span>
}

function Callout({ value, label, tone }: { value: string; label: string; tone: 'good' | 'warning' | 'critical' }) {
  const color = { good: 'var(--status-good)', warning: 'var(--status-warning)', critical: 'var(--status-critical)' }[tone]
  return (
    <div style={calloutStyle}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ styles */

const calloutGrid: React.CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }
const calloutStyle: React.CSSProperties = {
  flex: '1 1 220px', background: 'var(--surface-1)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '12px 16px',
}
const noteBox: React.CSSProperties = {
  background: 'var(--surface-1)', border: '1px solid var(--border)', borderLeft: '3px solid var(--status-warning)',
  borderRadius: 8, padding: '10px 14px', fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary)', marginBottom: 20,
}
const chartFrame: React.CSSProperties = {
  flex: '1 1 560px', minWidth: 0, background: 'var(--surface-1)',
  border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px',
}
const sectionHeading: React.CSSProperties = { marginBottom: 8, marginTop: 24 }
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 13,
  background: 'var(--surface-1)', borderRadius: 8, overflow: 'hidden',
}
const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--gridline)',
  color: 'var(--text-secondary)', fontWeight: 600,
}
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--gridline)' }
const num: React.CSSProperties = { ...td, fontVariantNumeric: 'tabular-nums' }
const crumbRow: React.CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 16, flexWrap: 'wrap',
}
const crumbBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--series-blue)',
  cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline',
}
const linkBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--series-blue)',
  cursor: 'pointer', fontSize: 12, padding: 0,
}
const classCard: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start',
  border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px',
  background: 'var(--surface-1)', color: 'var(--text-primary)', minWidth: 170, textAlign: 'left', cursor: 'pointer',
}
const assetGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8,
}
const assetCard: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start',
  border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px',
  background: 'var(--surface-1)', color: 'var(--text-primary)', textAlign: 'left', cursor: 'pointer',
}
