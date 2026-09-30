/** Anything that carries a condition and a deterioration curve: a segment, an asset
 *  class, or a single asset. The same graph renders all three. */
export interface CurveEntity {
  condition_now: number
  tier: 'measured' | 'synthetic'
  assumed_age: number
  /** The class's deterioration curve: service-life midpoint L, transition sharpness s.
   *  It is anchored to `condition_now` by age, not by a vertical offset -- see
   *  `currentAge` in conditionModel.ts for why. */
  curve: { L: number; s: number }
  band_sd: number
}

export interface AssetItem extends CurveEntity {
  asset_id: string
  label: string
  detail: string
  crop_image?: string | null
  real_detection?: boolean
}

export interface AssetClass extends CurveEntity {
  class_id: string
  label: string
  assets: AssetItem[]
}

export interface CountySegment extends CurveEntity {
  segment_id: string
  label: string
  road_name: string
  length_mi: number
  functional_class: string
  township: string | null
  aadt: number | null
  surface_year_median: number | null
  inventory_records: number
  measured_miles?: number
  asset_classes: AssetClass[]
}

export interface CountyAssets {
  generated_at: string
  thresholds: { desired_min_condition: number; reconstruction_threshold: number }
  note: string
  segments: CountySegment[]
}

/**
 * The condition ramp, used by the map, the rail and every chart.
 *
 * Chosen against colour-vision deficiency rather than by eye: the previous
 * green/amber/salmon/red ramp put Fair and Poor at OKLab dE 13.6 in normal vision and
 * 11.4 under deuteranopia, below the dE>=15 / dE>=8 thresholds -- the two bands a
 * pavement map most needs to separate. This ramp steps lightness as well as hue, so the
 * worst adjacent pair is dE 23.9 under simulated deuteranopia and protanopia, and the
 * order still reads correctly in greyscale and in print.
 *
 * `tint` is the same band for roads outside the county's jurisdiction: subordinate by
 * lightness, never by transparency, which muddies every colour it crosses.
 */
export const CONDITION_BANDS = [
  { label: 'Good', min: 75, color: '#1B6E3C', tint: '#6BA180' },
  { label: 'Fair', min: 55, color: '#E8C547', tint: '#F0D987' },
  { label: 'Poor', min: 25, color: '#BF5B18', tint: '#D59469' },
  { label: 'Failed', min: 0, color: '#6E1414', tint: '#A16666' },
]

export function conditionColor(index: number): string {
  return (CONDITION_BANDS.find((b) => index >= b.min) ?? CONDITION_BANDS[3]).color
}
