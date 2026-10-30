import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { IconSvg } from '../../lib/assetStyle'
import { num, panoUrl, type Road, type RoadAsset } from '../../lib/roadTypes'
import { fillGaps, markingsSeen } from '../../lib/roadChecks'

/**
 * 360° street view from the survey's own panoramas: six cube faces per stop (0 W, 1 N, 2 E, 3 S, 4 up, 5 down,
 * compass-fixed), drawn as the inside of a cube around the camera. Assets are pinned at their measured bearing and
 * height from the stop, so a pin points at the object in the photo.
 */
const FACE_AZ = [270, 0, 90, 180]
const PIN_RANGE_FT = 230


interface Props {
  road: Road
  assets: RoadAsset[]
  flagged: Map<string, 'fail' | 'borderline' | 'note'>
  index: number
  setIndex: (i: number) => void
  selectedId: string | null
  onSelect: (id: string) => void
  compact?: boolean
}

const compass = (d: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((d % 360) + 360) % 360) / 45) % 8]

/** Height above the road at which the label sits on the object: the middle of the sign face, the pole, the box. */
function pinHeight(a: RoadAsset): number {
  if (a.class === 'sign') {
    const b = num(a.attrs.bottom_height_ft)
    const t = num(a.attrs.top_height_ft)
    return b !== null && t !== null ? (b + t) / 2 : 7
  }
  if (a.class === 'utility_pole' || a.class === 'light_pole') return (num(a.attrs.height_ft) ?? 26) * 0.55
  if (a.class === 'mailbox') return ((num(a.attrs.top_height_in) ?? 46) - 6) / 12
  return 0.5
}

type Overlay = { scene: THREE.Scene; camera: THREE.PerspectiveCamera }

/** Road-marking shading, laid on the road plane: travelled lanes, shoulders, pavement edges, centre line. */
export const MARKING_STYLE = {
  lanes: { color: '#3d8bfd', opacity: 0.2, label: 'Travelled lanes' },
  shoulder: { color: '#f08c00', opacity: 0.5, label: 'Shoulder' },
  pavement: { color: '#14d2e6', opacity: 0.95, label: 'Pavement edge' },
  centre: { color: '#ffd23f', opacity: 0.95, label: 'Centre line' },
} as const

function buildMarkings(road: Road, pano: { x: number; y: number; ch: number }, camH: number): THREE.Group {
  const g = new THREE.Group()
  const rows = road.profile.filter((r) => r.chainage_ft > pano.ch - 260 && r.chainage_ft < pano.ch + 260)
  if (rows.length < 2) return g
  const med = (k: keyof (typeof rows)[0], d: number) => {
    const xs = road.profile.map((r) => r[k] as number | null).filter((x): x is number => x !== null).sort((a, b) => a - b)
    return xs.length ? xs[Math.floor(xs.length / 2)] : d
  }
  const c = fillGaps(rows.map((r) => r.centre_offset_ft), 0)
  const peL = fillGaps(rows.map((r) => r.pavement_edge_L_ft), med('pavement_edge_L_ft', -10.5))
  const peR = fillGaps(rows.map((r) => r.pavement_edge_R_ft), med('pavement_edge_R_ft', 10.5))
  const seL = fillGaps(rows.map((r) => r.shoulder_edge_L_ft), med('shoulder_edge_L_ft', -12))
  const seR = fillGaps(rows.map((r) => r.shoulder_edge_R_ft), med('shoulder_edge_R_ft', 12))
  // a point `lat` ft right of the centre line at row i, in viewer coordinates (x east, y up, -z north)
  const at = (i: number, lat: number) => {
    const r = rows[i]
    const h = (r.heading_deg * Math.PI) / 180
    const L = c[i] + lat // lateral from the survey path, + right of travel
    return [r.x_ft + Math.cos(h) * L - pano.x, -camH + 0.05, -(r.y_ft - Math.sin(h) * L - pano.y)]
  }
  const xs = road.cross_streets ?? []
  // never paint markings onto a stretch where none were seen (e.g. an unmarked gravel road); judged over the whole road
  const all = markingsSeen(road.profile)
  const seen = rows.map((r) => all[Math.floor(r.chainage_ft / 25)] ?? false)
  const atJunction = (i: number) => xs.some((x) => Math.abs(rows[i].chainage_ft - x.chainage_ft) < 70)
  const band = (inner: (i: number) => number, outer: (i: number) => number, color: string, opacity: number, gapAtJunctions = false) => {
    const pos: number[] = []
    for (let i = 0; i < rows.length - 1; i++) {
      if (!seen[i] || !seen[i + 1]) continue
      if (gapAtJunctions && (atJunction(i) || atJunction(i + 1))) continue
      const a = at(i, inner(i)), b = at(i, outer(i)), c2 = at(i + 1, inner(i + 1)), d = at(i + 1, outer(i + 1))
      pos.push(...a, ...b, ...c2, ...b, ...d, ...c2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide })))
  }
  const S = MARKING_STYLE
  band((i) => peL[i], (i) => peR[i], S.lanes.color, S.lanes.opacity)
  band((i) => seL[i], (i) => peL[i], S.shoulder.color, S.shoulder.opacity, true)
  band((i) => peR[i], (i) => seR[i], S.shoulder.color, S.shoulder.opacity, true)
  for (const e of [peL, peR]) band((i) => e[i] - 0.3, (i) => e[i] + 0.3, S.pavement.color, S.pavement.opacity, true)
  band(() => -0.45, () => 0.45, S.centre.color, S.centre.opacity)
  return g
}

export function StreetView(p: Props) {
  const host = useRef<HTMLDivElement>(null)
  const pinLayer = useRef<HTMLDivElement>(null)
  const st = useRef({ yaw: 0, pitch: 3, fov: 72, dirty: true })
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; faces: THREE.Mesh[]; overlay: Overlay } | null>(null)
  const [markings, setMarkings] = useState(true)
  const camH = p.road.survey.camera_height_ft
  const [loading, setLoading] = useState(true)
  const [heading, setHeading] = useState(0)
  const pano = p.road.panos[Math.max(0, Math.min(p.road.panos.length - 1, p.index))]

  const pins = useMemo(() => {
    if (!pano || p.road.imagery.representative) return []
    return p.assets
      .filter((a) => !a.line)
      .map((a) => {
        const x = num(a.attrs.x_ft)
        const y = num(a.attrs.y_ft)
        if (x === null || y === null) return null
        const dx = x - pano.x
        const dy = y - pano.y
        const D = Math.hypot(dx, dy)
        if (D > PIN_RANGE_FT || D < 4) return null
        const az = (Math.atan2(dx, dy) * 180) / Math.PI
        const el = Math.atan2(pinHeight(a) - camH, D)
        const azr = (az * Math.PI) / 180
        const v = new THREE.Vector3(Math.sin(azr) * Math.cos(el), Math.sin(el), -Math.cos(azr) * Math.cos(el))
        return { a, D, v }
      })
      .filter((x): x is { a: RoadAsset; D: number; v: THREE.Vector3 } => x !== null)
      .sort((u, w) => w.D - u.D)
  }, [p.assets, pano])

  // set up three.js once
  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#9aa3a8')
    const camera = new THREE.PerspectiveCamera(80, 1, 0.01, 10)
    camera.rotation.order = 'YXZ'
    const faces: THREE.Mesh[] = []
    for (let k = 0; k < 6; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.002, 2.002), new THREE.MeshBasicMaterial({ color: 0xffffff }))
      if (k < 4) {
        const az = (FACE_AZ[k] * Math.PI) / 180
        m.position.set(Math.sin(az), 0, -Math.cos(az))
        m.rotation.y = -az
      } else if (k === 4) {
        m.position.set(0, 1, 0)
        m.rotation.x = Math.PI / 2
      } else {
        m.position.set(0, -1, 0)
        m.rotation.x = -Math.PI / 2
      }
      scene.add(m)
      faces.push(m)
    }
    // road markings live in their own scene at true feet, drawn over the photo with the same view direction
    const overlay: Overlay = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(80, 1, 0.5, 3000) }
    overlay.camera.rotation.order = 'YXZ'
    renderer.autoClear = false
    three.current = { renderer, scene, camera, faces, overlay }

    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
      st.current.dirty = true
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    let raf = 0
    const tmp = new THREE.Vector3()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const s = st.current
      if (!s.dirty) return
      s.dirty = false
      camera.fov = s.fov
      camera.updateProjectionMatrix()
      camera.rotation.y = (-s.yaw * Math.PI) / 180
      camera.rotation.x = (s.pitch * Math.PI) / 180
      camera.updateMatrixWorld()
      renderer.clear()
      renderer.render(scene, camera)
      const oc = overlay.camera
      oc.fov = camera.fov
      oc.aspect = camera.aspect
      oc.updateProjectionMatrix()
      oc.rotation.copy(camera.rotation)
      oc.updateMatrixWorld()
      renderer.render(overlay.scene, oc)
      // place pins
      const layer = pinLayer.current
      if (layer) {
        const w = el.clientWidth
        const h = el.clientHeight
        for (const node of Array.from(layer.children) as HTMLElement[]) {
          const v = (node as HTMLElement & { _v?: THREE.Vector3 })._v
          if (!v) continue
          tmp.copy(v).project(camera)
          if (tmp.z >= 1 || Math.abs(tmp.x) > 1.2 || Math.abs(tmp.y) > 1.2) {
            node.style.display = 'none'
            continue
          }
          node.style.display = ''
          node.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`
        }
      }
      setHeading(s.yaw)
      window.dispatchEvent(new CustomEvent('road:heading', { detail: s.yaw }))
    }
    loop()

    // drag to look around
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-pin]')) return
      drag = { x: e.clientX, y: e.clientY, yaw: st.current.yaw, pitch: st.current.pitch }
      el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      const k = st.current.fov / el.clientHeight
      st.current.yaw = drag.yaw - (e.clientX - drag.x) * k
      st.current.pitch = Math.max(-80, Math.min(80, drag.pitch + (e.clientY - drag.y) * k))
      st.current.dirty = true
    }
    const up = () => {
      drag = null
      el.style.cursor = 'grab'
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      st.current.fov = Math.max(25, Math.min(100, st.current.fov + e.deltaY * 0.05))
      st.current.dirty = true
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.style.cursor = 'grab'
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', wheel)
      faces.forEach((f) => {
        const mat = f.material as THREE.MeshBasicMaterial
        mat.map?.dispose()
        mat.dispose()
        f.geometry.dispose()
      })
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  // load the stop's six faces
  const firstLoad = useRef(true)
  useEffect(() => {
    const t = three.current
    if (!t || !pano) return
    if (firstLoad.current) {
      st.current.yaw = pano.heading
      firstLoad.current = false
    }
    setLoading(true)
    const loader = new THREE.TextureLoader()
    let left = 6
    let cancelled = false
    for (let k = 0; k < 6; k++) {
      loader.load(panoUrl(pano, k), (tex) => {
        if (cancelled) {
          tex.dispose()
          return
        }
        tex.colorSpace = THREE.SRGBColorSpace
        const mat = t.faces[k].material as THREE.MeshBasicMaterial
        mat.map?.dispose()
        mat.map = tex
        mat.needsUpdate = true
        st.current.dirty = true
        if (--left === 0) setLoading(false)
      }, undefined, () => {
        if (--left === 0) setLoading(false)
      })
    }
    // warm the cache for the next stops in both directions
    for (const d of [1, -1, 2]) {
      const q = p.road.panos[p.index + d]
      if (q) for (let k = 0; k < 4; k++) new Image().src = panoUrl(q, k)
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pano?.pano, pano?.title])

  // when an asset is selected elsewhere, stand ~40 ft from it and look at it
  useEffect(() => {
    const a = p.assets.find((x) => x.id === p.selectedId)
    const x = a ? num(a.attrs.x_ft) : null
    const y = a ? num(a.attrs.y_ft) : null
    if (!a || x === null || y === null) return
    const cur = p.road.panos[p.index]
    if (cur && Math.hypot(x - cur.x, y - cur.y) < 120) {
      st.current.yaw = (Math.atan2(x - cur.x, y - cur.y) * 180) / Math.PI
      st.current.dirty = true
      return
    }
    let best = 0
    let bd = Infinity
    p.road.panos.forEach((q, i) => {
      const d = Math.abs(Math.hypot(x - q.x, y - q.y) - 45)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    const q = p.road.panos[best]
    st.current.yaw = (Math.atan2(x - q.x, y - q.y) * 180) / Math.PI
    st.current.pitch = 0
    st.current.dirty = true
    p.setIndex(best)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selectedId])

  useEffect(() => {
    st.current.dirty = true
  }, [pins, p.selectedId, p.flagged])

  useEffect(() => {
    const t = three.current
    if (!t || !pano) return
    const sc = t.overlay.scene
    for (const o of [...sc.children]) {
      sc.remove(o)
      o.traverse((m) => {
        if (m instanceof THREE.Mesh) {
          m.geometry.dispose()
          ;(m.material as THREE.Material).dispose()
        }
      })
    }
    if (markings && !p.road.imagery.representative) sc.add(buildMarkings(p.road, pano, camH))
    st.current.dirty = true
  }, [pano, markings, p.road, camH])

  const step = (d: number) => {
    // step in the direction the viewer faces along the road
    const fwd = Math.cos(((heading - (pano?.heading ?? 0)) * Math.PI) / 180) >= 0 ? 1 : -1
    p.setIndex(Math.max(0, Math.min(p.road.panos.length - 1, p.index + d * fwd)))
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowUp') step(e.shiftKey ? 5 : 1)
      else if (e.key === 'ArrowDown') step(e.shiftKey ? -5 : -1)
      else if (e.key === 'ArrowLeft') st.current.yaw -= 15
      else if (e.key === 'ArrowRight') st.current.yaw += 15
      else return
      st.current.dirty = true
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (!pano) return <div style={{ padding: 20 }}>No panoramas for this road.</div>
  const sta = `${Math.floor(pano.ch / 100)}+${String(Math.round(pano.ch % 100)).padStart(2, '0')}`

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#20262b', userSelect: 'none' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div ref={pinLayer} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {pins.map(({ a, D, v }) => {
          const flag = p.flagged.get(a.id)
          const sel = a.id === p.selectedId
          return (
            <div key={a.id} data-pin ref={(n) => { if (n) (n as HTMLDivElement & { _v?: THREE.Vector3 })._v = v }}
              style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'auto', willChange: 'transform' }}>
              <button onClick={() => p.onSelect(a.id)} title={`${a.label} · ${Math.round(D)} ft`}
                style={{
                  transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', gap: 5, padding: sel ? '5px 9px' : '3px 7px',
                  borderRadius: 999, border: `2px solid ${sel ? '#2a78d6' : flag === 'fail' ? '#e5383b' : flag === 'borderline' ? '#f0a020' : 'rgba(255,255,255,0.9)'}`,
                  background: sel ? '#ffffff' : 'rgba(17,20,24,0.72)', color: sel ? '#111' : '#fff', fontSize: sel ? 12.5 : 11, fontWeight: 600,
                  cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.35)', opacity: D > 150 && !sel ? 0.75 : 1,
                }}>
                <IconSvg a={a} size={sel ? 15 : 12} />
                {(sel || D < 90) && <span>{a.label.split(' (')[0]}</span>}
                <span style={{ opacity: 0.75, fontWeight: 400 }}>{Math.round(D)} ft</span>
              </button>
            </div>
          )
        })}
      </div>

      <div style={{ position: 'absolute', top: 12, left: 12, display: 'grid', gap: 6, maxWidth: 'calc(100% - 120px)' }}>
        <div style={chip}>
          <b>Sta. {sta}</b>
          <span style={{ opacity: 0.8 }}>looking {compass(heading)}{p.compact ? '' : ` · stop ${p.index + 1} of ${p.road.panos.length}`}</span>
        </div>
        {p.road.imagery.representative && (
          <div style={{ ...chip, background: 'rgba(122,61,116,0.9)' }}>
            {p.compact ? 'Representative photos' : "Representative photos from Beaverton Rd, to show the viewer. This road's own photos aren't loaded yet, so its assets are shown on the map, not pinned here."}
          </div>
        )}
      </div>

      {!p.road.imagery.representative && (
        <div style={{ position: 'absolute', left: 12, bottom: p.compact ? 48 : 18, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', ...chip, padding: p.compact ? '4px 8px' : '6px 10px' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontWeight: 600 }}>
            <input type="checkbox" checked={markings} onChange={() => setMarkings((v) => !v)} /> Road markings
          </label>
          {markings && !p.compact && Object.values(MARKING_STYLE).map((m) => (
            <span key={m.label} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11.5 }}>
              <span style={{ width: 14, height: 8, borderRadius: 2, background: m.color, opacity: Math.max(0.55, m.opacity) }} />{m.label}
            </span>
          ))}
        </div>
      )}

      {/* compass */}
      <div style={{ position: 'absolute', top: 12, right: 12, width: p.compact ? 40 : 52, height: p.compact ? 40 : 52, borderRadius: 999, background: 'rgba(17,20,24,0.7)', display: 'grid', placeItems: 'center' }}
        aria-label={`Facing ${compass(heading)}`}>
        <svg width="40" height="40" viewBox="-20 -20 40 40" style={{ transform: `rotate(${-heading}deg)` }}>
          <polygon points="0,-16 5,0 -5,0" fill="#e5383b" />
          <polygon points="0,16 5,0 -5,0" fill="#fff" />
          <text x="0" y="-8" textAnchor="middle" fontSize="7" fill="#fff" fontWeight="700" transform="translate(0,-9)">N</text>
        </svg>
      </div>

      <div style={{ position: 'absolute', bottom: p.compact ? 10 : 18, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
        <button style={p.compact ? navSm : navBtn} onClick={() => step(-1)} aria-label="Step back along the road">{p.compact ? '◀' : '◀ Back'}</button>
        <button style={p.compact ? navSm : navBtn} onClick={() => { st.current.yaw = pano.heading; st.current.pitch = 3; st.current.dirty = true }} title="Look along the road">{p.compact ? '⟲' : 'Look along road'}</button>
        <button style={p.compact ? navSm : navBtn} onClick={() => step(1)} aria-label="Step forward along the road">{p.compact ? '▶' : 'Forward ▶'}</button>
      </div>
      {!p.compact && (
        <div style={{ position: 'absolute', bottom: 18, right: 14, fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>
          Drag to look · scroll to zoom · ↑ ↓ to move · ← → to turn
        </div>
      )}
      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', ...chip }}>Loading panorama…</div>}
    </div>
  )
}

const chip: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', padding: '6px 10px', borderRadius: 8, background: 'rgba(17,20,24,0.75)', color: '#fff', fontSize: 12.5 }
const navSm: React.CSSProperties = { width: 32, height: 30, borderRadius: 999, border: 0, background: 'rgba(255,255,255,0.92)', color: '#111', fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }
const navBtn: React.CSSProperties = { whiteSpace: 'nowrap',  padding: '8px 14px', borderRadius: 999, border: 0, background: 'rgba(255,255,255,0.92)', color: '#111', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.35)' }
