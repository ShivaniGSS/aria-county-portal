"""
Build the drill-down the portal navigates: county -> segment -> asset class -> asset.

Every level carries a condition value and a deterioration curve, so the same graph
works whether you're looking at a 6-mile segment, its sign inventory as a class, or one
individual sign.

Real vs synthetic, as everywhere in this portal:
  - Pavement condition on 6 of 28 segments is a real rolled-up IDOT CRS/IRI reading.
  - The 24 sign detections from the ARIA pilot survey are real, with real MUTCD
    compliance measurements, spatially matched to the county segment they sit on.
  - Everything else -- culverts, guardrail, signs outside the surveyed corridors, and
    pavement on the other 22 segments -- is synthetic placeholder, tagged as such.

Output: public/data/county_assets.json
"""
import json
import random
from pathlib import Path

from shapely.geometry import shape, Point

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
RNG_SEED = 42
CURRENT_YEAR = 2026

DESIRED_MIN_CONDITION = 55.0
RECONSTRUCTION_THRESHOLD = 25.0

# Curve shape per asset class: service-life midpoint L and transition sharpness s.
# Pavement uses the per-road-class model; the rest use class-typical service lives.
CLASS_CURVES = {
    "pavement": {"Interstate": (34.0, 9.0), "Other Principal Arterial": (30.5, 17.0),
                 "Minor Arterial": (27.0, 8.0), "Major Collector": (24.0, 7.0),
                 "Minor Collector": (21.0, 7.0), "Local Road or Street": (18.0, 6.0)},
    "signs": (12.0, 4.0),
    "culverts": (40.0, 12.0),
    "guardrail": (25.0, 8.0),
}

SYNTHETIC_CONDITION = {
    "pavement": {"Interstate": (74, 10), "Other Principal Arterial": (71, 12),
                 "Minor Arterial": (67, 13), "Major Collector": (61, 14),
                 "Minor Collector": (56, 15), "Local Road or Street": (52, 16)},
    "signs": (68, 16),
    "culverts": (63, 17),
    "guardrail": (66, 15),
}

ASSET_CLASSES = [
    {"id": "pavement", "label": "Pavement"},
    {"id": "signs", "label": "Signs"},
    {"id": "culverts", "label": "Culverts"},
    {"id": "guardrail", "label": "Guardrail"},
]


def make_entity(condition, tier, L, s, age, band_sd):
    """
    Condition today, plus the class curve it will be read against.

    The portal anchors that curve to `condition_now` by AGE rather than by adding a
    vertical offset, so `assumed_age` here is the real (or assumed) surface age for
    display only -- the projection finds its own starting point on the curve.
    """
    return {
        "condition_now": round(condition, 1),
        "tier": tier,
        "assumed_age": round(age, 1),
        "curve": {"L": L, "s": s},
        "band_sd": band_sd,
    }


def main():
    rng = random.Random(RNG_SEED)
    segments_geo = json.loads((DATA / "county_segments.geojson").read_text())
    signs_geo = json.loads((DATA / "signs_with_segment.geojson").read_text())

    # --- match the real pilot sign detections onto county segments ----------------
    seg_shapes = [(f["properties"]["segment_id"], shape(f["geometry"])) for f in segments_geo["features"]]
    real_signs_by_segment = {}
    unmatched = 0
    for f in signs_geo["features"]:
        pt = Point(f["geometry"]["coordinates"])
        best_id, best_d = None, float("inf")
        for seg_id, geom in seg_shapes:
            d = geom.distance(pt)
            if d < best_d:
                best_id, best_d = seg_id, d
        # ~0.005 degrees is roughly a quarter mile at this latitude.
        if best_d > 0.005:
            unmatched += 1
            continue
        real_signs_by_segment.setdefault(best_id, []).append(f["properties"])

    out_segments = []
    for feat in segments_geo["features"]:
        p = feat["properties"]
        fc = p["functional_class"]
        length_mi = max(0.1, p["length_mi"])
        pav_L, pav_s = CLASS_CURVES["pavement"].get(fc, (22.0, 7.0))
        age = (CURRENT_YEAR - p["surface_year_median"]) if p.get("surface_year_median") else pav_L * 0.6
        age = max(0, min(80, age))

        # --- pavement -------------------------------------------------------------
        if p.get("measured_condition") is not None:
            pav = make_entity(p["measured_condition"], "measured", pav_L, pav_s, age, 5.0)
            pav["measured_miles"] = p["measured_miles"]
        else:
            mean, sd = SYNTHETIC_CONDITION["pavement"].get(fc, (58, 14))
            val = max(18.0, min(92.0, rng.gauss(mean, sd)))
            pav = make_entity(val, "synthetic", pav_L, pav_s, age, 14.0)

        pavement_class = {
            "class_id": "pavement", "label": "Pavement",
            **pav,
            "assets": [{
                "asset_id": f"{p['segment_id']}_pav", "label": f"{p['label']} pavement",
                "detail": f"{length_mi:.1f} mi · {fc}", **pav,
            }],
        }

        classes = [pavement_class]

        # --- signs ----------------------------------------------------------------
        real_signs = real_signs_by_segment.get(p["segment_id"], [])
        sign_assets = []
        sL, sS = CLASS_CURVES["signs"]
        for s in real_signs:
            # A flagged sign is genuinely out of compliance; treat that as poor condition.
            flagged = s["review_status"] == "flagged"
            cond = 35.0 if flagged else 78.0
            e = make_entity(cond, "measured", sL, sS, sL * 0.5, 6.0)
            sign_assets.append({
                "asset_id": s["sign_id"],
                "label": s["sign_type"].replace("_", " "),
                "detail": "; ".join(s["violations"]) if flagged else "compliant",
                "crop_image": s.get("crop_image"),
                "real_detection": True,
                **e,
            })
        n_synth = max(0, int(length_mi * 3) - len(sign_assets))
        for i in range(n_synth):
            mean, sd = SYNTHETIC_CONDITION["signs"]
            cond = max(20.0, min(95.0, rng.gauss(mean, sd)))
            sign_assets.append({
                "asset_id": f"{p['segment_id']}_sign_{i:02d}",
                "label": rng.choice(["stop", "curve warning", "speed limit", "street name", "yield", "school zone"]),
                "detail": "not surveyed",
                "real_detection": False,
                **make_entity(cond, "synthetic", sL, sS, sL * 0.6, 15.0),
            })
        if sign_assets:
            classes.append(roll_up("signs", "Signs", sign_assets, sL, sS))

        # --- culverts and guardrail (synthetic inventories) ------------------------
        for cid, label, per_mile in (("culverts", "Culverts", 2.0), ("guardrail", "Guardrail", 0.8)):
            L, S = CLASS_CURVES[cid]
            mean, sd = SYNTHETIC_CONDITION[cid]
            n = max(1, int(length_mi * per_mile))
            assets = []
            for i in range(n):
                cond = max(20.0, min(95.0, rng.gauss(mean, sd)))
                assets.append({
                    "asset_id": f"{p['segment_id']}_{cid}_{i:02d}",
                    "label": f"{label[:-1]} {i + 1}",
                    "detail": "not surveyed",
                    "real_detection": False,
                    **make_entity(cond, "synthetic", L, S, L * 0.6, 16.0),
                })
            classes.append(roll_up(cid, label, assets, L, S))

        out_segments.append({
            "segment_id": p["segment_id"],
            "label": p["label"],
            "road_name": p["road_name"],
            "length_mi": p["length_mi"],
            "functional_class": fc,
            "township": p.get("township"),
            "aadt": p.get("aadt"),
            "surface_year_median": p.get("surface_year_median"),
            "inventory_records": p["inventory_records"],
            **pav,  # the segment's headline condition is its pavement condition
            "asset_classes": classes,
        })

    payload = {
        "generated_at": f"{CURRENT_YEAR}-09-18",
        "thresholds": {
            "desired_min_condition": DESIRED_MIN_CONDITION,
            "reconstruction_threshold": RECONSTRUCTION_THRESHOLD,
        },
        "note": (
            "Pavement condition on 6 of 28 segments is a real rolled-up IDOT CRS/IRI reading, and "
            "the sign detections from the ARIA pilot corridors are real with real MUTCD compliance "
            "measurements. Everything else is synthetic placeholder awaiting survey."
        ),
        "segments": out_segments,
    }
    (DATA / "county_assets.json").write_text(json.dumps(payload))

    n_assets = sum(len(c["assets"]) for s in out_segments for c in s["asset_classes"])
    n_real = sum(1 for s in out_segments for c in s["asset_classes"]
                 for a in c["assets"] if a.get("real_detection"))
    measured_segs = sum(1 for s in out_segments if s["tier"] == "measured")
    print(f"county_assets.json: {len(out_segments)} segments, {n_assets} assets ({n_real} real detections)")
    print(f"  segments with measured pavement condition: {measured_segs}")
    print(f"  real signs matched to segments: {sum(len(v) for v in real_signs_by_segment.values())}"
          f" ({unmatched} unmatched, outside the county system)")
    for seg_id, signs in sorted(real_signs_by_segment.items()):
        label = next(s["label"] for s in out_segments if s["segment_id"] == seg_id)
        print(f"    {label}: {len(signs)} real signs")


def roll_up(class_id, label, assets, L, s):
    """A class's condition is the mean of its assets; measured if any asset is real."""
    mean_cond = sum(a["condition_now"] for a in assets) / len(assets)
    tier = "measured" if any(a.get("real_detection") for a in assets) else "synthetic"
    age = sum(a["assumed_age"] for a in assets) / len(assets)
    return {
        "class_id": class_id, "label": label,
        **make_entity(mean_cond, tier, L, s, age, 10.0 if tier == "measured" else 15.0),
        "assets": assets,
    }


if __name__ == "__main__":
    main()
