import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadPointCloud, localXY, pointsNear, type PointCloud } from '../lib/pointcloud'

interface Props {
  track: string
  /** When set, view is recentered and cropped to points within radiusFt of this sign. */
  focus?: { E: number; N: number; label: string; radiusFt?: number }
  onClose: () => void
}

let cloudCache: Promise<PointCloud> | null = null
function getCloud(track: string) {
  if (!cloudCache) cloudCache = loadPointCloud(track)
  return cloudCache
}

export function PointCloudViewer({ track, focus, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pointCount, setPointCount] = useState(0)

  useEffect(() => {
    let disposed = false
    let renderer: THREE.WebGLRenderer | undefined
    let frameId = 0

    getCloud(track)
      .then((cloud) => {
        if (disposed || !containerRef.current) return

        const radiusFt = focus?.radiusFt ?? 60
        let idx: number[] | null = null
        let cx = 0
        let cy = 0
        if (focus) {
          const [lx, ly] = localXY(cloud.meta, focus.E, focus.N)
          idx = pointsNear(cloud, lx, ly, radiusFt)
          cx = lx
          cy = ly
        }
        const n = idx ? idx.length : cloud.xyz.length / 3
        setPointCount(n)

        const positions = new Float32Array(n * 3)
        const colors = new Float32Array(n * 3)
        const min = [Infinity, Infinity, Infinity]
        const max = [-Infinity, -Infinity, -Infinity]
        for (let i = 0; i < n; i++) {
          const src = idx ? idx[i] : i
          const px = cloud.xyz[src * 3] - cx
          const py = cloud.xyz[src * 3 + 2] // z -> y (up) for a natural 3D view
          const pz = -(cloud.xyz[src * 3 + 1] - cy)
          positions[i * 3] = px
          positions[i * 3 + 1] = py
          positions[i * 3 + 2] = pz
          if (px < min[0]) min[0] = px
          if (py < min[1]) min[1] = py
          if (pz < min[2]) min[2] = pz
          if (px > max[0]) max[0] = px
          if (py > max[1]) max[1] = py
          if (pz > max[2]) max[2] = pz
          colors[i * 3] = cloud.rgb[src * 3] / 255
          colors[i * 3 + 1] = cloud.rgb[src * 3 + 1] / 255
          colors[i * 3 + 2] = cloud.rgb[src * 3 + 2] / 255
        }

        // Recenter on the actual bounding-box center so the camera always frames the data,
        // regardless of where this slice sits within the full corridor's coordinate range.
        const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2)
        const extent = [0, 1, 2].map((k) => max[k] - min[k])
        const radius = Math.max(1, Math.sqrt(extent[0] ** 2 + extent[1] ** 2 + extent[2] ** 2) / 2)
        for (let i = 0; i < n; i++) {
          positions[i * 3] -= center[0]
          positions[i * 3 + 1] -= center[1]
          positions[i * 3 + 2] -= center[2]
        }

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

        // Corridor view: clusters are tiny (~90ft) but scattered across a 7-mile span, so
        // world-space point size (shrinking with camera distance) makes them invisible from
        // a distance that fits the whole corridor. Use a fixed screen-space size instead.
        // Per-sign view: keep world-space attenuation for a true close-up 3D feel.
        const material = focus
          ? new THREE.PointsMaterial({ size: Math.max(0.05, radius / 200), vertexColors: true })
          : new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true })
        const points = new THREE.Points(geometry, material)

        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0x14161a)
        scene.add(points)

        const el = containerRef.current
        const width = el.clientWidth
        const height = el.clientHeight
        const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, radius * 50 + 100)
        if (focus) {
          // Per-sign: a compact, roughly cube-shaped cluster reads fine from an oblique angle.
          const d = radius * 1.6
          camera.position.set(d, d * 0.8, d)
        } else {
          // Full corridor: the data is a long, thin line (7mi long, ~90ft clusters), so an
          // oblique/isometric angle wastes nearly the whole frame on empty space around it.
          // Frame it top-down instead, sized to the dominant along-corridor extent (z here).
          const along = Math.max(extent[0], extent[1], extent[2])
          const d = along * 0.7
          camera.position.set(d * 0.04, d, d * 0.04)
        }

        renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setSize(width, height)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        el.appendChild(renderer.domElement)

        const controls = new OrbitControls(camera, renderer.domElement)
        controls.target.set(0, 0, 0)
        controls.enableDamping = true

        const onResize = () => {
          if (!el) return
          camera.aspect = el.clientWidth / el.clientHeight
          camera.updateProjectionMatrix()
          renderer!.setSize(el.clientWidth, el.clientHeight)
        }
        window.addEventListener('resize', onResize)

        const animate = () => {
          controls.update()
          renderer!.render(scene, camera)
          frameId = requestAnimationFrame(animate)
        }
        animate()
        setStatus('ready')

        return () => {
          window.removeEventListener('resize', onResize)
          cancelAnimationFrame(frameId)
          controls.dispose()
          geometry.dispose()
          material.dispose()
          renderer?.dispose()
        }
      })
      .catch((err) => {
        console.error(err)
        if (!disposed) setStatus('error')
      })

    return () => {
      disposed = true
      if (renderer) {
        cancelAnimationFrame(frameId)
        renderer.dispose()
        renderer.domElement.remove()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, focus?.E, focus?.N])

  return (
    <div style={overlayStyle}>
      <div style={headerStyle}>
        <div>
          <strong>{focus ? `3D view — ${focus.label}` : `3D view — full corridor`}</strong>
          <div style={{ fontSize: 12, color: '#c3c2b7' }}>
            {status === 'loading' && 'Loading point cloud…'}
            {status === 'ready' && `${pointCount.toLocaleString()} points · drag to orbit, scroll to zoom`}
            {status === 'error' && 'Failed to load point cloud'}
          </div>
        </div>
        <button onClick={onClose} style={closeButtonStyle}>
          Close
        </button>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
      <div style={footerStyle}>
        Sign-vicinity LiDAR crop (45ft radius per station) — not a continuous corridor sweep. Source:
        RuralBench/CV-Code pilot, Boone County GardenPrairie Rd.
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  padding: 24,
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  color: 'white',
  marginBottom: 8,
}

const closeButtonStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.15)',
  color: 'white',
  border: '1px solid rgba(255,255,255,0.3)',
  borderRadius: 6,
  padding: '6px 12px',
  cursor: 'pointer',
}

const footerStyle: React.CSSProperties = {
  color: '#898781',
  fontSize: 12,
  marginTop: 8,
}
