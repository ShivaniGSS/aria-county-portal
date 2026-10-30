import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { CLASSES } from '../../lib/assetStyle'
import { num, type Road, type RoadAsset, type RoadIndexEntry } from '../../lib/roadTypes'
import { findings, rowAt, download, type Finding } from '../../lib/roadChecks'
import { useFeedback } from '../../lib/feedback'
import { COLOR_BY, RoadMap, flyToStation, type Basemap, type ColorBy } from './RoadMap'
import { PlanSheet } from './PlanSheet'
import { AssetRecord, SourceBadge } from './AssetRecord'
import { WorkLists } from './WorkLists'
import { InventoryTable } from './InventoryTable'
import { StreetView } from './StreetView'
import { MiniMap } from './MiniMap'
import { RoadScrubber } from './RoadScrubber'

/**
 * A surveyed road as a product. Three layouts of the same information are offered side by side so county engineers
 * can tell us which one fits how they work: Map (map first), Street view (photo first), Plan sheet (straight-line
 * diagram first). Work lists and the inventory are shared.
 */
type Tab = 'map' | 'street' | 'sheet' | 'lists' | 'inventory'
const LAYOUTS: { id: Tab; label: string; blurb: string }[] = [
  { id: 'map', label: 'Map', blurb: 'Map first, with the plan sheet underneath' },
  { id: 'street', label: 'Street view', blurb: '360° photos first, with a locator map and a road timeline' },
  { id: 'sheet', label: 'Plan sheet', blurb: 'The road drawn from above and straightened out, with photos and map beside it' },
]

export function RoadPage() {
  const [index, setIndex] = useState<RoadIndexEntry[]>([])
  const [slug, setSlug] = useState<string | null>(null)
  const [road, setRoad] = useState<Road | null>(null)
  const [assets, setAssets] = useState<RoadAsset[]>([])
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('street')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cursorFt, setCursorFt] = useState<number | null>(null)
  const [panoIndex, setPanoIndex] = useState(0)
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const [threeD, setThreeD] = useState(false)
  const [colorBy, setColorBy] = useState<ColorBy>('centre')
  const [visible, setVisible] = useState<Set<string>>(() => new Set(CLASSES.map((c) => c.id)))
  const [showCrashes, setShowCrashes] = useState(true)
  const [svInset, setSvInset] = useState(true)
  const [clearZoneFt, setClearZoneFt] = useState(10)
  const [leanDeg, setLeanDeg] = useState(5)
  const [narrowFt, setNarrowFt] = useState(22)
  const fb = useFeedback()

  useEffect(() => {
    fetch('data/roads/index.json')
      .then((r) => r.json())
      .then((ix: RoadIndexEntry[]) => {
        setIndex(ix)
        setSlug(ix.find((r) => r.slug === 'beaverton-rd')?.slug ?? ix[0]?.slug ?? null)
      })
      .catch(() => setError('The surveyed-road index could not be loaded.'))
  }, [])

  useEffect(() => {
    if (!slug) return
    setRoad(null)
    setSelectedId(null)
    Promise.all([fetch(`data/roads/${slug}/road.json`).then((r) => r.json()), fetch(`data/roads/${slug}/assets.json`).then((r) => r.json())])
      .then(([r, a]: [Road, RoadAsset[]]) => {
        setRoad(r)
        setAssets(a)
        // open the street view where there is something to see: just before the first sign
        const sign = a.filter((x) => x.class === 'sign').sort((u, v) => (num(u.attrs.chainage_ft) ?? 0) - (num(v.attrs.chainage_ft) ?? 0))[0]
        const ch = sign ? (num(sign.attrs.chainage_ft) ?? 0) - 60 : 0
        let best = 0
        r.panos.forEach((q, i) => { if (Math.abs(q.ch - ch) < Math.abs(r.panos[best].ch - ch)) best = i })
        setPanoIndex(best)
      })
      .catch(() => setError(`Road data for ${slug} could not be loaded.`))
  }, [slug])

  const opts = useMemo(() => ({ clearZoneFt, leanDeg }), [clearZoneFt, leanDeg])
  const findingsOf = useCallback((a: RoadAsset): Finding[] => findings(a, opts), [opts])
  const flagged = useMemo(() => {
    const m = new Map<string, 'fail' | 'borderline' | 'note'>()
    for (const a of assets) {
      const f = findingsOf(a)
      if (f.length) m.set(a.id, f.some((x) => x.severity === 'fail') ? 'fail' : f.some((x) => x.severity === 'borderline') ? 'borderline' : 'note')
    }
    return m
  }, [assets, findingsOf])

  const visibleAssets = useMemo(() => assets.filter((a) => visible.has(a.class)), [assets, visible])
  const ordered = useMemo(() => [...visibleAssets].sort((a, b) => (num(a.attrs.chainage_ft) ?? num(a.attrs.start_chainage_ft) ?? 0) - (num(b.attrs.chainage_ft) ?? num(b.attrs.start_chainage_ft) ?? 0)), [visibleAssets])
  const selected = assets.find((a) => a.id === selectedId) ?? null

  const select = (id: string | null) => {
    setSelectedId(id)
    if (id && (tab === 'lists' || tab === 'inventory')) setTab('street')
  }
  const pick = (ft: number) => {
    if (!road) return
    setCursorFt(ft)
    let best = 0
    road.panos.forEach((q, i) => { if (Math.abs(q.ch - ft) < Math.abs(road.panos[best].ch - ft)) best = i })
    setPanoIndex(best)
    if (tab === 'lists' || tab === 'inventory') setTab('map')
    setTimeout(() => flyToStation(road, ft), 50)
  }
  const step = (dir: -1 | 1) => {
    const i = ordered.findIndex((a) => a.id === selectedId)
    const next = ordered[Math.max(0, Math.min(ordered.length - 1, i + dir))]
    if (next) setSelectedId(next.id)
  }

  if (error) return <div style={{ padding: 24 }}>{error}</div>
  if (!road) return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading the surveyed road…</div>

  const counts = Object.fromEntries(CLASSES.map((c) => [c.id, assets.filter((a) => a.class === c.id).length]))
  const nFlag = [...flagged.values()].filter((v) => v === 'fail').length
  const nFb = Object.keys(fb.items).length
  const legend = COLOR_BY.find((c) => c.id === colorBy)!
  const mid = rowAt(road, road.length_ft / 2)
  const pano = road.panos[panoIndex]
  const record = selected && <AssetRecord road={road} asset={selected} findings={findingsOf(selected)} onClose={() => setSelectedId(null)} onStep={step} />
  const street = (compact = false) => (
    <StreetView road={road} assets={visibleAssets} flagged={flagged} index={panoIndex} setIndex={setPanoIndex} selectedId={selectedId} onSelect={select} compact={compact} />
  )
  const strip = (mode: 'compact' | 'full') => (
    <PlanSheet road={road} assets={visibleAssets} flagged={flagged} selectedId={selectedId} onSelect={select}
      panoIndex={panoIndex} setPanoIndex={setPanoIndex} compact={mode === 'compact'} />
  )

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={topbar}>
        <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select id="road-pick" value={slug ?? ''} onChange={(e) => setSlug(e.target.value)} style={roadPick} aria-label="Surveyed road">
              {index.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{mid.township ? `${mid.township[0]}${mid.township.slice(1).toLowerCase()} Township · ` : ''}Boone County</span>
            {road.imagery.representative && <span style={repChip}>Photos: representative</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span><b>{(road.length_ft / 5280).toFixed(2)} mi</b> surveyed</span>
            <span><b>{assets.length}</b> assets</span>
            <span><b>{road.panos.length}</b> 360° stops</span>
            <span>{road.crashes.length ? <><b>{road.crashes.length}</b> crashes 2014–20</> : 'No crashes mapped 2014–20'}</span>
            <span style={{ color: nFlag ? '#b3261e' : undefined }}><b>{nFlag}</b> need attention</span>
          </div>
        </div>
        <div role="tablist" style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginRight: 4 }}>Layout</span>
          {LAYOUTS.map((l) => (
            <button key={l.id} role="tab" aria-selected={tab === l.id} title={l.blurb} onClick={() => setTab(l.id)} style={tabBtn(tab === l.id)}>{l.label}</button>
          ))}
          <span style={{ width: 1, height: 22, background: 'var(--gridline)', margin: '0 8px' }} />
          {(['lists', 'inventory'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>{t === 'lists' ? 'Work lists' : 'Inventory'}</button>
          ))}
        </div>
        {LAYOUTS.some((l) => l.id === tab) && <LayoutVote layout={tab} />}
        <button style={ghost} onClick={() => download(`${road.slug}-engineer-feedback.json`, JSON.stringify({ road: road.slug, exported: new Date().toISOString(), items: fb.items }, null, 1), 'application/json')}
          title="Download every rating and comment recorded in this browser">
          Feedback ({nFb})
        </button>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {tab === 'map' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <RoadMap road={road} assets={assets} visible={visible} flagged={flagged} selectedId={selectedId} onSelect={select}
                cursorFt={cursorFt} onPickStation={pick} basemap={basemap} threeD={threeD} colorBy={colorBy} showCrashes={showCrashes} />
              <div style={controls}>
                <div style={seg}>
                  {(['satellite', 'streets'] as Basemap[]).map((b) => <button key={b} style={segBtn(basemap === b)} onClick={() => setBasemap(b)}>{b === 'satellite' ? 'Satellite' : 'Map'}</button>)}
                  <button style={segBtn(threeD)} onClick={() => setThreeD((v) => !v)} aria-pressed={threeD}>3D</button>
                </div>
                <div style={{ display: 'grid', gap: 3 }}>
                  {CLASSES.filter((c) => counts[c.id]).map((c) => (
                    <label key={c.id} style={layerRow}>
                      <input type="checkbox" checked={visible.has(c.id)} onChange={() => setVisible((s) => {
                        const n = new Set(s)
                        if (n.has(c.id)) n.delete(c.id)
                        else n.add(c.id)
                        return n
                      })} />
                      <span style={{ width: 10, height: 10, borderRadius: c.linear ? 2 : 999, background: c.color, flex: 'none' }} />
                      <span style={{ flex: 1 }}>{c.plural}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{counts[c.id]}</span>
                    </label>
                  ))}
                  <label style={layerRow}>
                    <input type="checkbox" checked={showCrashes} onChange={() => setShowCrashes((v) => !v)} />
                    <span style={{ width: 10, height: 10, borderRadius: 999, border: '2.5px solid #b3261e', flex: 'none' }} />
                    <span style={{ flex: 1 }}>Crashes 2014–20</span>
                    <span style={{ color: 'var(--text-muted)' }}>{road.crashes.length}</span>
                  </label>
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <label htmlFor="colorby" style={smallCaps}>Colour the road by</label>
                  <select id="colorby" value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)} style={{ padding: 4, borderRadius: 6 }}>
                    {COLOR_BY.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <div style={{ display: 'grid', gap: 2 }}>
                    {legend.legend.map(([col, lab]) => (
                      <span key={lab} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        <span style={{ width: 18, height: 5, borderRadius: 3, background: col }} />{lab}
                      </span>
                    ))}
                  </div>
                </div>
                <label style={layerRow}><input type="checkbox" checked={svInset} onChange={() => setSvInset((v) => !v)} /> Street view inset</label>
              </div>
              {svInset && (
                <div style={inset}>
                  {street(true)}
                  <button style={expandBtn} onClick={() => setTab('street')} title="Open the street-view layout">⤢</button>
                </div>
              )}
              {record}
            </div>
            <div style={{ height: 250, borderTop: '1px solid var(--gridline)', flex: 'none', position: 'relative' }}>{strip('compact')}</div>
          </div>
        )}

        {tab === 'street' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              {street()}
              <div style={{ ...miniBox, bottom: 70 }}>
                <MiniMap road={road} assets={visibleAssets} pano={pano} heading={null} selectedId={selectedId} onPickPano={setPanoIndex} />
              </div>
              {record}
            </div>
            <RoadScrubber road={road} assets={visibleAssets} flagged={flagged} index={panoIndex} setIndex={setPanoIndex} />
          </div>
        )}

        {tab === 'sheet' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>{strip('full')}</div>
            <div style={{ width: 460, flex: 'none', display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--gridline)', position: 'relative' }}>
              <div style={{ flex: 1, position: 'relative' }}>{street(true)}</div>
              <div style={{ height: 240, position: 'relative', borderTop: '1px solid var(--gridline)' }}>
                <MiniMap road={road} assets={visibleAssets} pano={pano} heading={null} selectedId={selectedId} onPickPano={setPanoIndex} zoom={15} />
              </div>
              {record}
            </div>
          </div>
        )}

        {tab === 'lists' && (
          <WorkLists road={road} assets={assets} clearZoneFt={clearZoneFt} setClearZoneFt={setClearZoneFt} leanDeg={leanDeg} setLeanDeg={setLeanDeg}
            narrowFt={narrowFt} setNarrowFt={setNarrowFt} onSelect={select} onPick={pick} />
        )}
        {tab === 'inventory' && <InventoryTable road={road} assets={assets} findingsOf={findingsOf} onSelect={select} />}
      </div>

      <div style={footer}>
        {road.survey.source}. {road.survey.faces_reviewed ? `${road.survey.faces_reviewed} of ${road.survey.faces.toLocaleString()} camera views checked in CVAT.` : ''}
        {road.imagery.representative && ' Street-view photos on this road are representative imagery from another road.'} Coordinates: {road.survey.crs}.
        {road.quality && (
          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 600 }}>How these numbers were checked ({road.quality.checked_on})</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr auto', gap: '6px 14px', padding: '8px 0 4px', maxHeight: 260, overflowY: 'auto' }}>
              {road.quality.checks.map((c) => (
                <Fragment key={c.what}>
                  <b style={{ color: 'var(--text-primary)' }}>{c.what}</b>
                  <span>{c.how && <>{c.how}. </>}{c.result}.</span>
                  <span style={{ alignSelf: 'start' }}><SourceBadge s={c.status === 'shown' ? 'checked' : c.status === 'coming' ? 'coming' : 'illustrative'} /></span>
                </Fragment>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

/** "Does this layout fit how you work?" — the feedback this prototype exists to collect. */
function LayoutVote({ layout }: { layout: Tab }) {
  const fb = useFeedback()
  const key = `layout:${layout}`
  const mine = fb.items[key]
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(mine?.note ?? '')
  useEffect(() => setNote(fb.items[key]?.note ?? ''), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const label = LAYOUTS.find((l) => l.id === layout)?.label
  return (
    <div style={{ position: 'relative' }}>
      <button style={{ ...ghost, borderColor: 'var(--series-blue)', color: mine?.verdict ? '#fff' : 'var(--series-blue)', background: mine?.verdict ? 'var(--series-blue)' : 'var(--surface-1)', fontWeight: 700 }}
        onClick={() => setOpen((v) => !v)}>
        {mine?.verdict === 'correct' ? `✓ ${label} works for me` : mine?.verdict === 'wrong' ? `${label}: not for me` : 'Rate this layout'}
      </button>
      {open && (
        <div style={votePop}>
          <b style={{ fontSize: 13 }}>Does the {label} layout fit how you work?</b>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={ghost} onClick={() => fb.set(key, { verdict: 'correct', note })}>Works for me</button>
            <button style={ghost} onClick={() => fb.set(key, { verdict: 'wrong', note })}>Not for me</button>
          </div>
          <textarea id={`vote-${layout}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What would you change? What do you look at first?"
            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--page)', color: 'var(--text-primary)', font: 'inherit', fontSize: 13 }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button style={ghost} onClick={() => { fb.set(key, { verdict: mine?.verdict ?? null, note }); setOpen(false) }}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}

const topbar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, padding: '8px 16px', borderBottom: '1px solid var(--gridline)', background: 'var(--surface-1)', flexWrap: 'wrap' }
const roadPick: React.CSSProperties = { fontSize: 16, fontWeight: 700, border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px', background: 'var(--surface-1)', color: 'var(--text-primary)' }
const repChip: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#7a3d74', background: 'rgba(122,61,116,0.12)', padding: '2px 7px', borderRadius: 999 }
const tabBtn = (on: boolean): React.CSSProperties => ({ border: 0, borderBottom: `3px solid ${on ? 'var(--series-blue)' : 'transparent'}`, background: 'transparent', color: on ? 'var(--text-primary)' : 'var(--text-secondary)', padding: '7px 10px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' })
const ghost: React.CSSProperties = { fontSize: 12.5, padding: '6px 11px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer' }
const controls: React.CSSProperties = { position: 'absolute', top: 12, left: 12, width: 226, background: 'var(--surface-1)', borderRadius: 10, boxShadow: 'var(--panel-shadow)', padding: 12, display: 'grid', gap: 12, zIndex: 3, maxHeight: 'calc(100% - 24px)', overflowY: 'auto' }
const seg: React.CSSProperties = { display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }
const segBtn = (on: boolean): React.CSSProperties => ({ flex: 1, border: 0, padding: '6px 8px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: on ? 'var(--series-blue)' : 'transparent', color: on ? '#fff' : 'var(--text-primary)' })
const layerRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }
const smallCaps: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }
const inset: React.CSSProperties = { position: 'absolute', right: 56, bottom: 14, width: 380, height: 230, borderRadius: 10, overflow: 'hidden', boxShadow: '0 6px 24px rgba(0,0,0,0.35)', border: '2px solid #fff', zIndex: 3 }
const expandBtn: React.CSSProperties = { position: 'absolute', top: 72, right: 8, width: 30, height: 30, borderRadius: 6, border: 0, background: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontSize: 15, zIndex: 2 }
const miniBox: React.CSSProperties = { position: 'absolute', left: 14, width: 300, height: 200, borderRadius: 10, overflow: 'hidden', border: '2px solid #fff', boxShadow: '0 6px 24px rgba(0,0,0,0.35)', zIndex: 3 }
const votePop: React.CSSProperties = { position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 320, background: 'var(--surface-1)', border: '1px solid var(--gridline)', borderRadius: 10, boxShadow: 'var(--panel-shadow)', padding: 12, display: 'grid', gap: 8, zIndex: 20 }
const footer: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', padding: '5px 16px', borderTop: '1px solid var(--gridline)', background: 'var(--surface-1)' }
