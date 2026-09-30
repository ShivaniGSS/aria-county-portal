"""
Preprocess GardenPrairie Track01 (Boone County) source data from the RuralBench/
CV-Code pipeline into static web assets for the ARIA county-engineer portal demo.

Sources (read-only, all under ~/Downloads):
  - ruralbench_pilot/pooled_signGT_flagged.csv  -> sign condition + compliance flags
  - garp_t1_sign_manifest.csv                   -> per-detection confidence, pixel bbox, image link
  - sign_labels_garp_t1/{frames,crops}/         -> actual imagery
  - Trajectory_Spreadsheet/REV_Data_GardenPrarie.csv -> drive path / capture points
  - garp_t1_reduced.npz                         -> LiDAR point cloud (sign-vicinity crops)

Outputs (written into public/data/):
  - signs.geojson              asset inventory overlay
  - route.geojson              road path + photo waypoints
  - pavement_synthetic.geojson SYNTHETIC placeholder condition data (see NOTE below)
  - pointcloud/garp_t1.bin     decimated point cloud (interleaved f32 xyz + u8 rgb)
  - pointcloud/garp_t1.json    point cloud metadata (origin, count, bounds)
  - imagery/garp_t1/frames/*   copied frame images
  - imagery/garp_t1/crops/*    copied crop images

NOTE ON SYNTHETIC DATA: pavement IRI/PCI has no real source in this pipeline (it
only exists behind uGRIDD's production sensors/API, which this demo has no access
to). Every record in pavement_synthetic.geojson is tagged source="synthetic_placeholder"
and should be replaced wholesale once real uGRIDD condition data is available --
do not treat it as measured.
"""
import csv
import json
import random
import shutil
from pathlib import Path

import numpy as np
from pyproj import Transformer

DOWNLOADS = Path.home() / "Downloads"
RURALBENCH = DOWNLOADS / "ruralbench_pilot"
OUT = Path(__file__).resolve().parent.parent / "public" / "data"

TRACK = "garp_t1"
TITLE_PREFIX = "GarP_T1_"
POINTCLOUD_MAX_POINTS = 800_000
RNG_SEED = 42

# Illinois East State Plane, NAD83, US survey feet -> WGS84 lon/lat
to_wgs84 = Transformer.from_crs("EPSG:3435", "EPSG:4326", always_xy=True)


def _to_float(s):
    s = (s or "").strip()
    return float(s) if s else None


def load_signs():
    """Join compliance-flagged sign GT with the detection manifest (confidence, pixel bbox, image link)."""
    manifest = {}
    with open(RURALBENCH / "garp_t1_sign_manifest.csv") as f:
        for row in csv.DictReader(f):
            manifest[row["sign_id"]] = row

    features = []
    with open(RURALBENCH / "pooled_signGT_flagged.csv") as f:
        for row in csv.DictReader(f):
            if row["track"] != TRACK:
                continue
            sign_id = row["sign_id"]
            m = manifest.get(sign_id, {})
            lon, lat = to_wgs84.transform(float(row["sign_E"]), float(row["sign_N"]))

            height_flag = row["height_flag"].strip()
            clearance_flag = row["clearance_flag"].strip()
            flags = [x for x in (height_flag, clearance_flag) if x]
            status = "flagged" if flags else "confirmed"

            crop_path = f"imagery/{TRACK}/crops/{sign_id}.jpg"
            has_crop = (RURALBENCH.parent / "sign_labels_garp_t1" / "crops" / f"{sign_id}.jpg").exists()
            frame_name = f"{TITLE_PREFIX}{m.get('upano', '')}_Img_{m.get('cam', '')}_2048.jpg" if m else None
            frame_path = f"imagery/{TRACK}/frames/{frame_name}" if frame_name else None
            has_frame = bool(frame_name) and (DOWNLOADS / "sign_labels_garp_t1" / "frames" / frame_name).exists()

            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "sign_id": sign_id,
                    "sign_type": row["sign_type"],
                    "face": row["face"],
                    "sign_E_ft": float(row["sign_E"]),
                    "sign_N_ft": float(row["sign_N"]),
                    "review_status": status,
                    "violations": flags,
                    "height_above_pavement_ft": _to_float(row["height_above_pavement"]),
                    "lateral_clearance_ft": _to_float(row["lateral_clearance"]),
                    "range_ft": _to_float(row["range_ft"]),
                    "detection_confidence": float(m["det_conf"]) if m.get("det_conf") else None,
                    "crop_image": crop_path if has_crop else None,
                    "frame_image": frame_path if has_frame else None,
                    "cam_face": m.get("face"),
                    "source": "ruralbench_pilot_boone_garp_t1",
                },
            })
    return {"type": "FeatureCollection", "features": features}


def load_route():
    """Drive path for GarP Track01, plus which capture points have a browsable photo."""
    frames_dir = DOWNLOADS / "sign_labels_garp_t1" / "frames"
    upanos_with_frames = set()
    for p in frames_dir.glob(f"{TITLE_PREFIX}*_Img_*_2048.jpg"):
        # e.g. GarP_T1_283_Img_1_2048.jpg -> upano "283"
        parts = p.stem.split("_")
        upanos_with_frames.add(parts[2])

    points = []
    coords = []
    with open(DOWNLOADS / "Trajectory_Spreadsheet" / "REV_Data_GardenPrarie.csv") as f:
        for raw_row in csv.DictReader(f):
            row = {k.strip(): v for k, v in raw_row.items()}
            if not row["Title"].startswith(TITLE_PREFIX):
                continue
            upano = row["Title"][len(TITLE_PREFIX):]
            lon, lat = to_wgs84.transform(float(row["Easting"]), float(row["Northing"]))
            coords.append([lon, lat])
            if upano in upanos_with_frames:
                cams = sorted(
                    p.stem.split("_")[4]
                    for p in frames_dir.glob(f"{TITLE_PREFIX}{upano}_Img_*_2048.jpg")
                )
                points.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "upano": upano,
                        "heading": float(row["Heading"]),
                        "available_cams": cams,
                        "frame_base": f"imagery/{TRACK}/frames/{TITLE_PREFIX}{upano}_Img_",
                    },
                })

    line = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {"track": TRACK, "name": "GardenPrairie Rd - Track 01"},
    }
    return {"type": "FeatureCollection", "features": [line, *points]}


def load_pavement_synthetic():
    """
    SYNTHETIC placeholder pavement condition, approved 2026-09-17 explicitly as a
    showcase stand-in (no real IRI/PCI sensor data exists in this pipeline). Segments
    the drive path into chunks and assigns a smoothly-varying fake IRI/PCI per chunk
    via a seeded random walk, tagged source="synthetic_placeholder" throughout.
    """
    rng = random.Random(RNG_SEED)
    coords = []
    with open(DOWNLOADS / "Trajectory_Spreadsheet" / "REV_Data_GardenPrarie.csv") as f:
        for raw_row in csv.DictReader(f):
            row = {k.strip(): v for k, v in raw_row.items()}
            if not row["Title"].startswith(TITLE_PREFIX):
                continue
            lon, lat = to_wgs84.transform(float(row["Easting"]), float(row["Northing"]))
            coords.append([lon, lat])

    segment_size = 20
    segments = [coords[i:i + segment_size + 1] for i in range(0, len(coords) - 1, segment_size)]

    iri = 85.0  # start "Good" per FHWA HPMS threshold (<95 in/mi)
    features = []
    for i, seg in enumerate(segments):
        if len(seg) < 2:
            continue
        iri += rng.uniform(-12, 12)
        iri = max(40.0, min(220.0, iri))
        pci = max(0, min(100, 100 - (iri - 40) * 0.35 + rng.uniform(-5, 5)))
        condition_class = "good" if iri < 95 else ("fair" if iri <= 170 else "poor")
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": seg},
            "properties": {
                "segment_id": f"{TRACK}_seg{i:03d}",
                "iri_in_per_mi": round(iri, 1),
                "pci": round(pci, 1),
                "condition_class": condition_class,
                "source": "synthetic_placeholder",
                "note": "Fabricated for demo purposes only -- substitute with real uGRIDD sensor IRI/PCI when available.",
            },
        })
    return {"type": "FeatureCollection", "features": features}


def build_pointcloud():
    d = np.load(DOWNLOADS / f"{TRACK}_reduced.npz")
    n = d["xl"].shape[0]
    rng = np.random.default_rng(RNG_SEED)
    keep = n if n <= POINTCLOUD_MAX_POINTS else POINTCLOUD_MAX_POINTS
    idx = rng.choice(n, size=keep, replace=False)
    idx.sort()  # keep some spatial locality for incremental loading later

    x = d["xl"][idx].astype(np.float32)
    y = d["yl"][idx].astype(np.float32)
    z = d["z"][idx].astype(np.float32)
    # recenter z near 0 too, so all three axes are small floats (x,y already local to E0/N0)
    z0 = float(z.min())
    z = z - z0

    r = (d["r"][idx].astype(np.float32) / 65535.0 * 255).clip(0, 255).astype(np.uint8)
    g = (d["g"][idx].astype(np.float32) / 65535.0 * 255).clip(0, 255).astype(np.uint8)
    b = (d["b"][idx].astype(np.float32) / 65535.0 * 255).clip(0, 255).astype(np.uint8)

    pc_dir = OUT / "pointcloud"
    pc_dir.mkdir(parents=True, exist_ok=True)

    xyz = np.stack([x, y, z], axis=1)  # (N, 3) float32
    rgb = np.stack([r, g, b], axis=1)  # (N, 3) uint8

    with open(pc_dir / f"{TRACK}.bin", "wb") as f:
        f.write(xyz.tobytes())
        f.write(rgb.tobytes())

    meta = {
        "track": TRACK,
        "point_count": int(keep),
        "origin_E": float(d["E0"]),
        "origin_N": float(d["N0"]),
        "origin_z_offset": z0,
        "bounds": {
            "x": [float(x.min()), float(x.max())],
            "y": [float(y.min()), float(y.max())],
            "z": [float(z.min()), float(z.max())],
        },
        "layout": "xyz_f32 then rgb_u8, both length point_count, same order",
        "source": "ruralbench_pilot_boone_garp_t1_lidar_sign_vicinity_crops",
        "note": "Sign-vicinity crops (45ft radius per sign station), not a continuous corridor sweep.",
    }
    with open(pc_dir / f"{TRACK}.json", "w") as f:
        json.dump(meta, f, indent=2)


def copy_imagery(signs_geojson, route_geojson):
    frames_out = OUT / "imagery" / TRACK / "frames"
    crops_out = OUT / "imagery" / TRACK / "crops"
    frames_out.mkdir(parents=True, exist_ok=True)
    crops_out.mkdir(parents=True, exist_ok=True)

    frame_names = set()
    for feat in route_geojson["features"]:
        props = feat["properties"]
        if "available_cams" not in props:
            continue
        for cam in props["available_cams"]:
            frame_names.add(f"{TITLE_PREFIX}{props['upano']}_Img_{cam}_2048.jpg")

    for name in frame_names:
        src = DOWNLOADS / "sign_labels_garp_t1" / "frames" / name
        if src.exists():
            shutil.copy2(src, frames_out / name)

    for feat in signs_geojson["features"]:
        crop = feat["properties"].get("crop_image")
        if crop:
            name = Path(crop).name
            src = DOWNLOADS / "sign_labels_garp_t1" / "crops" / name
            if src.exists():
                shutil.copy2(src, crops_out / name)

    print(f"copied {len(frame_names)} frames, "
          f"{sum(1 for f in signs_geojson['features'] if f['properties'].get('crop_image'))} crops")


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    signs = load_signs()
    with open(OUT / "signs.geojson", "w") as f:
        json.dump(signs, f)
    print(f"signs.geojson: {len(signs['features'])} signs")

    route = load_route()
    with open(OUT / "route.geojson", "w") as f:
        json.dump(route, f)
    print(f"route.geojson: {len(route['features']) - 1} photo waypoints")

    pavement = load_pavement_synthetic()
    with open(OUT / "pavement_synthetic.geojson", "w") as f:
        json.dump(pavement, f)
    print(f"pavement_synthetic.geojson: {len(pavement['features'])} segments (SYNTHETIC)")

    build_pointcloud()
    print("pointcloud built")

    copy_imagery(signs, route)


if __name__ == "__main__":
    main()
