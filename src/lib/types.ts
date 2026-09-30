export interface SignProperties {
  sign_id: string
  sign_type: string
  face: string
  sign_E_ft: number
  sign_N_ft: number
  review_status: 'confirmed' | 'flagged'
  violations: string[]
  height_above_pavement_ft: number | null
  lateral_clearance_ft: number | null
  range_ft: number | null
  detection_confidence: number | null
  crop_image: string | null
  frame_image: string | null
  cam_face: string | null
  source: string
}

export interface WaypointProperties {
  upano: string
  heading: number
  available_cams: string[]
  frame_base: string
}

export interface PavementProperties {
  segment_id: string
  iri_in_per_mi: number
  pci: number
  condition_class: 'good' | 'fair' | 'poor'
  source: 'synthetic_placeholder'
  note: string
}

export interface PointCloudMeta {
  track: string
  point_count: number
  origin_E: number
  origin_N: number
  origin_z_offset: number
  bounds: { x: [number, number]; y: [number, number]; z: [number, number] }
  layout: string
  source: string
  note: string
}

export const CAM_LABEL: Record<string, string> = {
  '0': 'West',
  '1': 'North',
  '2': 'East',
  '3': 'South',
}
