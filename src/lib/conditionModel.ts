import type { CurveEntity } from './assetTypes'
/**
 * Condition projection and treatment-scenario logic.
 *
 * Every curve here is a PLANNING PROJECTION, not an observation. A single survey
 * cycle cannot establish deterioration rates, so only one functional class in Boone
 * (Other Principal Arterial) has a curve fitted from local measurements; the rest use
 * documented defaults. Views must show which is which -- see `tier` and `basis`.
 */

/**
 * `measured` is a real IDOT reading. `synthetic` is an openly fabricated placeholder
 * for a survey that hasn't happened -- not an estimate of that specific road. Views
 * must keep the two visually distinct.
 */
export type ConditionTier = 'measured' | 'synthetic'

export interface ConditionSegment {
  segment_id: string
  road_name: string
  functional_class: string
  aadt: number | null
  length_mi: number | null
  surface_type_code: number | null
  surface_year: number | null
  age_years: number | null
  measured_index: number | null
  measured_from: 'CRS' | 'IRI' | null
  tier: ConditionTier
  condition_now: number
  assumed_age: number
  curve: { L: number; s: number; anchor_offset: number }
  band_sd: number
}

export interface ClassModel {
  L: number
  s: number
  basis: 'fitted_from_boone_measurements' | 'documented_default_not_fitted'
  not_fitted_because?: string
  n_samples: number
  age_condition_correlation: number | null
  residual_sd: number
}

export interface ConditionData {
  generated_at: string
  method: string
  caveat: string
  thresholds: { desired_min_condition: number; reconstruction_threshold: number }
  class_models: Record<string, ClassModel>
  tier_counts: Record<ConditionTier, number>
  segments: ConditionSegment[]
}

/**
 * A treatment the county can apply. Costs are ILLUSTRATIVE unit rates, not Boone's
 * own bid prices, and are priced per mile for pavement and per unit for counted assets
 * -- a sign is not costed by the mile.
 */
export interface Treatment {
  id: string
  label: string
  restores: number // condition index points regained
  /** Cost per mile when `unit` is 'mile', per item when it is 'each'. */
  cost: number
  unit: 'mile' | 'each'
  /** Applicable when current index sits within this range. */
  minIndex: number
  maxIndex: number
}

export const TREATMENTS: Treatment[] = [
  { id: 'crack_seal', label: 'Crack sealing', restores: 8, cost: 4_000, unit: 'mile', minIndex: 62, maxIndex: 88 },
  { id: 'seal_coat', label: 'Seal coat', restores: 18, cost: 18_000, unit: 'mile', minIndex: 48, maxIndex: 78 },
  { id: 'thin_overlay', label: 'Thin overlay', restores: 34, cost: 95_000, unit: 'mile', minIndex: 34, maxIndex: 66 },
  { id: 'resurfacing', label: 'Resurfacing', restores: 55, cost: 240_000, unit: 'mile', minIndex: 25, maxIndex: 52 },
  { id: 'reconstruction', label: 'Reconstruction', restores: 100, cost: 850_000, unit: 'mile', minIndex: 0, maxIndex: 30 },
]

/**
 * What each asset class can actually have done to it. Pavement is priced by the mile;
 * signs, culverts and guardrail by the unit. Without this split the pavement table gets
 * applied to a single sign and the portal quotes six figures to replace it.
 */
export const CLASS_TREATMENTS: Record<string, Treatment[]> = {
  pavement: TREATMENTS,
  signs: [
    { id: 'sign_reset', label: 'Reset / straighten post', restores: 20, cost: 180, unit: 'each', minIndex: 45, maxIndex: 85 },
    { id: 'sign_reface', label: 'Reface sheeting', restores: 45, cost: 320, unit: 'each', minIndex: 25, maxIndex: 65 },
    { id: 'sign_replace', label: 'Replace sign and post', restores: 100, cost: 620, unit: 'each', minIndex: 0, maxIndex: 45 },
  ],
  culverts: [
    { id: 'culvert_clean', label: 'Clean out', restores: 12, cost: 900, unit: 'each', minIndex: 55, maxIndex: 90 },
    { id: 'culvert_line', label: 'Slipline / repair end', restores: 40, cost: 7_500, unit: 'each', minIndex: 28, maxIndex: 70 },
    { id: 'culvert_replace', label: 'Replace structure', restores: 100, cost: 32_000, unit: 'each', minIndex: 0, maxIndex: 35 },
  ],
  guardrail: [
    { id: 'rail_retension', label: 'Re-tension / reset posts', restores: 18, cost: 1_400, unit: 'each', minIndex: 50, maxIndex: 88 },
    { id: 'rail_panel', label: 'Replace damaged panels', restores: 45, cost: 6_200, unit: 'each', minIndex: 25, maxIndex: 68 },
    { id: 'rail_replace', label: 'Replace run and end treatment', restores: 100, cost: 24_000, unit: 'each', minIndex: 0, maxIndex: 35 },
  ],
}

export function treatmentsFor(classId: string): Treatment[] {
  return CLASS_TREATMENTS[classId] ?? TREATMENTS
}

const CURRENT_YEAR = 2026

/** The class's logistic decay at a given age, before any anchoring. */
function classCurve(L: number, s: number, age: number): number {
  return 100 / (1 + Math.exp((age - L) / s))
}

/**
 * Where on the class curve a given condition sits.
 *
 * The curve is anchored to the entity's condition HORIZONTALLY -- we ask "at what age
 * would this class be in this condition?" -- rather than by adding a constant offset.
 * A vertical offset would make the curve asymptote to that offset instead of to zero,
 * so a road anchored deep in the tail would sit flat forever and a rebuilt road would
 * read as permanently near-new. Both are false, and both flatter the projection.
 */
function ageForCondition(L: number, s: number, condition: number): number {
  const c = Math.max(1, Math.min(99, condition))
  return L + s * Math.log(100 / c - 1)
}

/** Condition index at a given point along the class curve. */
export function conditionAtAge(seg: CurveEntity, age: number): number {
  return Math.max(0, Math.min(100, classCurve(seg.curve.L, seg.curve.s, age)))
}

/**
 * The age the projection runs from -- the point on the class curve matching today's
 * condition, not the surface age. Those differ whenever a road has worn faster or
 * slower than its class; the measured condition is the thing we trust.
 */
export function currentAge(seg: CurveEntity): number {
  return ageForCondition(seg.curve.L, seg.curve.s, seg.condition_now)
}

/** Today's condition -- a real reading when `tier` is 'measured', otherwise synthetic. */
export function currentCondition(seg: CurveEntity): number {
  return seg.condition_now
}

export interface CurvePoint {
  year: number // calendar year
  age: number
  index: number
}

/** The do-nothing trajectory from today forward. */
export function projectDoNothing(seg: CurveEntity, years = 30): CurvePoint[] {
  const age0 = currentAge(seg)
  const out: CurvePoint[] = []
  for (let t = 0; t <= years; t++) {
    out.push({ year: CURRENT_YEAR + t, age: age0 + t, index: conditionAtAge(seg, age0 + t) })
  }
  return out
}

/** Years until the do-nothing curve falls below a threshold; null if it never does in range. */
export function yearsUntilBelow(seg: CurveEntity, threshold: number, years = 60): number | null {
  const age0 = currentAge(seg)
  for (let t = 0; t <= years; t++) {
    if (conditionAtAge(seg, age0 + t) < threshold) return t
  }
  return null
}

/** Cheapest treatment that applies at this condition and lifts it back above the target. */
export function recommendTreatment(index: number, target: number, from: Treatment[] = TREATMENTS): Treatment {
  const applicable = from.filter((t) => index >= t.minIndex && index <= t.maxIndex)
  const sufficient = applicable.filter((t) => Math.min(100, index + t.restores) >= target)
  const pick = (sufficient.length ? sufficient : applicable)[0]
  return pick ?? from[from.length - 1]
}

/**
 * How much of the thing there is: miles for pavement, items for a counted asset class.
 * The treatment list and the quantity must always be chosen together -- miles priced
 * against per-unit rates, or items against per-mile rates, are both silently wrong.
 */
export interface CostBasis {
  treatments: Treatment[]
  quantity: number
}

function basisFor(seg: { length_mi?: number | null }, basis?: CostBasis): CostBasis {
  return basis ?? { treatments: TREATMENTS, quantity: seg.length_mi ?? 0.25 }
}

export interface MaintenanceEvent {
  year: number
  treatment: Treatment
  cost: number
  indexBefore: number
  indexAfter: number
}

export interface MaintainedScenario {
  points: CurvePoint[]
  events: MaintenanceEvent[]
  totalCost: number
}

/**
 * The maintained trajectory: intervene whenever condition would drop below the desired
 * minimum, restoring it and resuming decay from the new, better condition.
 */
export function projectMaintained(
  seg: CurveEntity & { length_mi?: number | null },
  desiredMin: number,
  years = 30,
  costBasis?: CostBasis,
): MaintainedScenario {
  const { L, s } = seg.curve
  const { treatments, quantity } = basisFor(seg, costBasis)
  const points: CurvePoint[] = []
  const events: MaintenanceEvent[] = []
  let age = currentAge(seg)
  let totalCost = 0

  for (let t = 0; t <= years; t++) {
    const index = conditionAtAge(seg, age)
    if (index < desiredMin) {
      const treatment = recommendTreatment(index, desiredMin + 10, treatments)
      if (treatment) {
        const after = Math.min(100, index + treatment.restores)
        const cost = treatment.cost * quantity
        totalCost += cost
        events.push({ year: CURRENT_YEAR + t, treatment, cost, indexBefore: index, indexAfter: after })
        // Emit both sides of the intervention at the same year so the chart shows a
        // vertical step up, rather than silently starting from the restored value.
        points.push({ year: CURRENT_YEAR + t, age, index })
        points.push({ year: CURRENT_YEAR + t, age, index: after })
        // A treatment moves the road back along its own curve; it does not exempt it
        // from that curve, so decay resumes from the age matching the restored value.
        age = ageForCondition(L, s, after) + 1
        continue
      }
    }
    points.push({ year: CURRENT_YEAR + t, age, index })
    age += 1
  }

  return { points, events, totalCost }
}

/** Cost of doing nothing: the reconstruction that eventually becomes unavoidable. */
export function reconstructionLiability(
  seg: CurveEntity & { length_mi?: number | null },
  reconstructionThreshold: number,
  costBasis?: CostBasis,
): { years: number | null; cost: number } {
  const years = yearsUntilBelow(seg, reconstructionThreshold)
  const { treatments, quantity } = basisFor(seg, costBasis)
  const heaviest = treatments[treatments.length - 1]
  return { years, cost: heaviest.cost * quantity }
}
