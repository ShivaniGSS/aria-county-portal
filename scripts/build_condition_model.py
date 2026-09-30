"""
Build the per-segment condition model that the Condition page draws.

Two kinds of condition value, and the distinction is the whole point
-------------------------------------------------------------------
  measured   - a real IDOT reading (CRS, or IRI where CRS is absent). 692 of 3,295
               Boone segments. Solid curve, anchored on the real value.
  synthetic  - a fabricated placeholder, generated here. 2,603 segments. Dashed
               curve, badged as synthetic everywhere it appears.

Why synthetic rather than projected: an earlier version tried to infer condition from
SURF_YR, which records the last surface treatment. On Boone's local roads (median
recorded age 49 years) that produced "condition 0, rebuild now" for 854 segments --
a fabricated alarm, since an old surface year on a rural road usually records original
construction rather than an untouched pavement. Assuming mid-life instead simply
inverted the error, reporting 1,229 roads as healthy on no evidence.

A single survey cycle cannot establish deterioration rates either way: treatment
history is confounded with age, and only one of six functional classes shows any
usable age-condition relationship in Boone. So rather than dress a guess as an
inference, the unmeasured segments carry openly synthetic values, consistent with how
tasks, work orders, resources and budgets are already handled in this portal.

The deterioration CURVE shape is fitted to Boone's own measurements where the data
supports a fit, and uses a documented default otherwise.

Output: public/data/condition.json
"""
import json
import math
import random
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw_data" / "idot_boone_roads.geojson"
DATA = ROOT / "public" / "data"
CURRENT_YEAR = 2026
RNG_SEED = 42

# A class curve is only fitted when the data supports one. Checked 2026-09-18 against
# Boone's 676 measured+aged segments: only Other Principal Arterial shows a real
# age-condition relationship (r=-0.62, n=405). Minor Arterial is weak (-0.13), Major
# Collector flat (-0.00), Interstate has no age variance, and Local Road shows a
# POSITIVE correlation on n=6. Fitting those would manufacture a trend.
MIN_SAMPLES_TO_FIT = 30
MIN_ABS_CORRELATION = 0.30
MIN_AGE_SPREAD_YEARS = 5

# Curve shape (service-life midpoint L, transition sharpness s) where no fit is possible.
LITERATURE_DEFAULTS = {
    "Interstate": (34.0, 9.0),
    "Other Principal Arterial": (30.0, 8.0),
    "Minor Arterial": (27.0, 8.0),
    "Major Collector": (24.0, 7.0),
    "Minor Collector": (21.0, 7.0),
    "Local Road or Street": (18.0, 6.0),
}
FALLBACK = (22.0, 7.0)

# Synthetic condition distribution per class. Lower classes sit worse, reflecting the
# pattern ARIA exists to document -- county-owned local roads are the neglected ones --
# without asserting mass failure. FABRICATED: replace wholesale with survey results.
SYNTHETIC_CONDITION = {
    "Interstate": (74.0, 10.0),
    "Other Principal Arterial": (71.0, 12.0),
    "Minor Arterial": (67.0, 13.0),
    "Major Collector": (61.0, 14.0),
    "Minor Collector": (56.0, 15.0),
    "Local Road or Street": (52.0, 16.0),
}
SYNTHETIC_FALLBACK = (58.0, 14.0)

DESIRED_MIN_CONDITION = 55.0
RECONSTRUCTION_THRESHOLD = 25.0


def condition_index(crs, iri):
    """0-100 condition index. CRS (1-9, higher better) preferred; IRI is the fallback."""
    if crs and crs > 0:
        return max(0.0, min(100.0, (crs - 1.0) / 8.0 * 100.0))
    if iri and iri > 0:
        # 40 in/mi ~ new; 220 in/mi ~ failed. Federal Good/Fair/Poor breaks sit at 95/170.
        return max(0.0, min(100.0, 100.0 * (1.0 - (iri - 40.0) / 180.0)))
    return None


def logistic(age, L, s):
    return 100.0 / (1.0 + math.exp((age - L) / s))


def fit_class(ages, indices):
    """Coarse grid search for (L, s) minimising squared error. No scipy dependency."""
    best, best_sse = None, float("inf")
    ages = np.asarray(ages, dtype=float)
    indices = np.asarray(indices, dtype=float)
    for L in np.arange(6.0, 80.0, 0.5):
        for s in np.arange(2.0, 30.0, 0.5):
            pred = 100.0 / (1.0 + np.exp((ages - L) / s))
            sse = float(np.sum((pred - indices) ** 2))
            if sse < best_sse:
                best_sse, best = sse, (float(L), float(s))
    resid_sd = float(np.std(indices - np.array([logistic(a, *best) for a in ages])))
    return best, resid_sd


def main():
    rng = random.Random(RNG_SEED)
    raw = json.loads(RAW.read_text())

    # --- gather per-segment facts -------------------------------------------------
    segments = []
    for feat in raw["features"]:
        p = feat["properties"]
        yr = str(p.get("SURF_YR") or "").strip()
        age = CURRENT_YEAR - int(yr) if yr.isdigit() else None
        if age is not None:
            age = max(0, min(80, age))
        idx = condition_index(p.get("CRS_WITH"), p.get("IRI_WITH"))
        segments.append({
            "segment_id": f"boone_{p['OBJECTID']}",
            "road_name": (p.get("ROAD_NAME") or "").strip(),
            "functional_class": p.get("FC_NAME") or "Unknown",
            "aadt": p.get("AADT") or None,
            "length_mi": float(p.get("SEG_LENGTH") or 0) or None,
            "surface_type_code": p.get("SURF_TYP"),
            "surface_year": int(yr) if yr.isdigit() else None,
            "age_years": age,
            "measured_index": round(idx, 1) if idx is not None else None,
            "measured_from": ("CRS" if (p.get("CRS_WITH") or 0) > 0 else "IRI") if idx is not None else None,
        })

    # --- fit a curve shape per functional class, where the data supports it --------
    by_class = {}
    for s in segments:
        if s["measured_index"] is not None and s["age_years"] is not None:
            by_class.setdefault(s["functional_class"], []).append((s["age_years"], s["measured_index"]))

    class_models = {}
    for fc in sorted({s["functional_class"] for s in segments}):
        samples = by_class.get(fc, [])
        ages = [a for a, _ in samples]
        idxs = [i for _, i in samples]

        corr = None
        spread = (max(ages) - min(ages)) if len(ages) > 1 else 0
        if len(samples) > 2 and spread >= MIN_AGE_SPREAD_YEARS and np.std(ages) > 0 and np.std(idxs) > 0:
            corr = float(np.corrcoef(ages, idxs)[0, 1])

        if len(samples) >= MIN_SAMPLES_TO_FIT and corr is not None and corr <= -MIN_ABS_CORRELATION:
            (L, s_), resid = fit_class(ages, idxs)
            class_models[fc] = {
                "L": round(L, 2), "s": round(s_, 2),
                "basis": "fitted_from_boone_measurements",
                "n_samples": len(samples),
                "age_condition_correlation": round(corr, 3),
                "residual_sd": round(resid, 1),
            }
        else:
            L, s_ = LITERATURE_DEFAULTS.get(fc, FALLBACK)
            why = (
                "insufficient age variation in measured samples" if corr is None
                else f"only {len(samples)} measured samples" if len(samples) < MIN_SAMPLES_TO_FIT
                else f"no age-condition relationship in Boone data (r={corr:+.2f})"
            )
            class_models[fc] = {
                "L": L, "s": s_,
                "basis": "documented_default_not_fitted",
                "not_fitted_because": why,
                "n_samples": len(samples),
                "age_condition_correlation": round(corr, 3) if corr is not None else None,
                "residual_sd": 14.0,
            }

    # --- assign every segment a condition, real or openly synthetic ---------------
    tier_counts = {"measured": 0, "synthetic": 0}
    out = []
    for s in segments:
        model = class_models[s["functional_class"]]

        if s["measured_index"] is not None:
            tier = "measured"
            index_now = s["measured_index"]
        else:
            tier = "synthetic"
            mean, sd = SYNTHETIC_CONDITION.get(s["functional_class"], SYNTHETIC_FALLBACK)
            value = rng.gauss(mean, sd)
            # Mild age influence so the fabricated picture stays internally coherent --
            # deliberately gentle, since SURF_YR can't carry the weight of a real trend.
            if s["age_years"] is not None and s["age_years"] > 20:
                value -= min(15.0, (s["age_years"] - 20) * 0.25)
            index_now = round(max(15.0, min(95.0, value)), 1)
        tier_counts[tier] += 1

        # Shift the class curve so it passes through this segment's condition today.
        age_now = s["age_years"] if s["age_years"] is not None else round(model["L"] * 0.6, 1)
        anchor_offset = round(index_now - logistic(age_now, model["L"], model["s"]), 1)

        out.append({
            **s,
            "tier": tier,
            "condition_now": index_now,
            "assumed_age": age_now,
            "curve": {"L": model["L"], "s": model["s"], "anchor_offset": anchor_offset},
            "band_sd": round(model["residual_sd"] * (0.4 if tier == "measured" else 1.0), 1),
        })

    payload = {
        "generated_at": f"{CURRENT_YEAR}-09-18",
        "method": (
            "Condition is a real IDOT reading where one exists (692 segments) and an openly "
            "synthetic placeholder otherwise (2,603 segments). The deterioration curve shape is "
            "a logistic decay fitted to Boone's own measurements where the data supports a fit, "
            "and a documented default elsewhere. Forward projection is modelled in both cases."
        ),
        "caveat": (
            "A single survey cycle cannot establish deterioration rates: SURF_YR records the last "
            "surface treatment, so treatment history is confounded with age, and only one of six "
            "functional classes shows a usable age-condition relationship in Boone. Synthetic "
            "condition values are placeholders for a survey that has not happened -- they are not "
            "estimates of these specific roads and must be replaced wholesale with survey results."
        ),
        "thresholds": {
            "desired_min_condition": DESIRED_MIN_CONDITION,
            "reconstruction_threshold": RECONSTRUCTION_THRESHOLD,
        },
        "class_models": class_models,
        "tier_counts": tier_counts,
        "segments": out,
    }
    (DATA / "condition.json").write_text(json.dumps(payload))

    print(f"condition.json: {len(out)} segments — {tier_counts}")
    below = sum(1 for s in out if s["condition_now"] < DESIRED_MIN_CONDITION)
    print(f"  below desired minimum ({DESIRED_MIN_CONDITION}): {below}")
    for fc, m in class_models.items():
        print(f"  {fc:28s} L={m['L']:6.2f} s={m['s']:5.2f}  n={m['n_samples']:4d}  {m['basis']}")


if __name__ == "__main__":
    main()
