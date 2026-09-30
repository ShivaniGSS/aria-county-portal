import type { PointCloudMeta } from './types'

export interface PointCloud {
  meta: PointCloudMeta
  xyz: Float32Array // interleaved x,y,z, local feet, z already offset near 0
  rgb: Uint8Array // interleaved r,g,b
}

/**
 * Points ship base64-encoded inside JSON rather than as a raw .bin: static hosts
 * that only serve standard web media types won't serve application/octet-stream.
 * The wrapper carries its own point_count, since it's decimated relative to the
 * full cloud described by the metadata file.
 */
export async function loadPointCloud(track: string): Promise<PointCloud> {
  const [meta, points] = await Promise.all([
    fetch(`data/pointcloud/${track}.json`).then((r) => r.json() as Promise<PointCloudMeta>),
    fetch(`data/pointcloud/${track}_points.json`).then(
      (r) => r.json() as Promise<{ point_count: number; b64: string }>,
    ),
  ])

  const binary = atob(points.b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const n = points.point_count
  const xyzBytes = n * 3 * 4
  const xyz = new Float32Array(bytes.buffer.slice(0, xyzBytes))
  const rgb = new Uint8Array(bytes.buffer.slice(xyzBytes, xyzBytes + n * 3))
  return { meta: { ...meta, point_count: n }, xyz, rgb }
}

/** Local (x, y) for a sign given its raw state-plane E/N and the cloud's origin. */
export function localXY(meta: PointCloudMeta, E: number, N: number): [number, number] {
  return [E - meta.origin_E, N - meta.origin_N]
}

/** Indices of points within `radiusFt` of (x, y) in the local frame (ignores z). */
export function pointsNear(cloud: PointCloud, x: number, y: number, radiusFt: number): number[] {
  const r2 = radiusFt * radiusFt
  const out: number[] = []
  const { xyz } = cloud
  for (let i = 0; i < xyz.length / 3; i++) {
    const dx = xyz[i * 3] - x
    const dy = xyz[i * 3 + 1] - y
    if (dx * dx + dy * dy <= r2) out.push(i)
  }
  return out
}
