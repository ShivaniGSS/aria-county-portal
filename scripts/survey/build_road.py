"""Build one surveyed road for the portal: a station-by-station road profile and a fully attributed asset inventory.

Inputs (raw_data/survey/<road>/): the engine's COCO annotations (Vaughn's usf-cv-project run; images.source =
reviewed | prelabel) and the survey trajectory CSV (IL East ftUS; Elevation in ft). Public context comes from the
IDOT D2 road extract and the IDOT crash points already used elsewhere in the portal.

Geometry (no imagery needed): cube faces 0-3 are compass-fixed (W, N, E, S), 90 deg FOV, 2048 px, camera 8.25 ft
above the road (scripts/survey/geolocate.py). A pixel below the horizon projects to the road plane at horizontal
distance D = CAM_H * hypot(x - 1024, 1024) / (y - 1024); heights of points on an object at known distance D are
CAM_H + D * (1024 - y) / hypot(x - 1024, 1024).

Every attribute is written as {value, unit, source, method[, spread]} where source is one of
  measured     computed from this survey's detections and geometry
  derived      computed from measured values (widths, offsets, compliance checks)
  public       IDOT inventory / IDOT crash records
  illustrative a placeholder showing what the platform would hold once the data exists (never a measurement)
Outputs: public/data/roads/<slug>/road.json, assets.json; public/data/roads/index.json.
"""

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree

import geolocate as G

ROOT = Path(__file__).resolve().parents[2]
ROAD_KEY = "STONE QUARRY"
CAM_H = G.CAM_H_FT
Z_SHIFT = 0.0  # vertical datum tie to USGS 3DEP, ft (--z-shift); trajectory Elevation is not exactly camera height
FACE_AZ = G.FACE_AZ
BIN_FT = 25
to_ll = Transformer.from_crs("EPSG:3435", "EPSG:4326", always_xy=True).transform
from_ll = Transformer.from_crs("EPSG:4326", "EPSG:3435", always_xy=True).transform
STRIPE = {"LeftLane": "edge_line", "RightLane": "edge_line", "LeftPavementEdge": "pavement_edge",
          "RightPavementEdge": "pavement_edge", "LeftShoulderEdge": "shoulder_edge", "RightShoulderEdge": "shoulder_edge",
          "CenterLine_No_Passing": "centre", "CenterLine_One_Way_Passing": "centre", "CenterLine_Two_Way_Passing": "centre"}
CENTRE_TYPE = {"CenterLine_No_Passing": "double solid (no passing either direction)",
               "CenterLine_One_Way_Passing": "solid + broken (passing one direction)",
               "CenterLine_Two_Way_Passing": "single broken (passing both directions)"}
SIGN_NAMES = {"curve": "Curve warning (W1 series)", "intersection": "Intersection warning (W2 series)",
              "no_passing_zone": "No Passing Zone pennant (W14-3)", "speed_limit": "Speed Limit (R2-1)",
              "stop_ahead": "Stop Ahead (W3-1)", "stop": "Stop (R1-1)", "two_direction_arrow": "Two-direction large arrow (W1-7)",
              "warning_other": "Other warning sign", "regulatory_other": "Other regulatory sign", "street_name": "Street name (D3-1)"}
CLASS_LABEL = {"utility_pole": "Utility pole", "light_pole": "Light pole (utility pole with luminaire)", "mailbox": "Mailbox",
               "driveway": "Driveway / field access", "guardrail": "Guardrail run", "fence": "Fence line"}


def attr(value, unit, source, method, spread=None, **kw):
    if value is None or (isinstance(value, float) and not np.isfinite(value)):
        return None
    if isinstance(value, (float, np.floating)):
        value = round(float(value), 2)
    a = {"value": value, "unit": unit, "source": source, "method": method}
    if spread is not None and np.isfinite(spread):
        a["spread"] = round(float(spread), 2)
    a.update(kw)
    return a


def ground(k, x, y, E0, N0):
    """Road-plane point (E, N, D) of pixel (x, y) in face k seen from (E0, N0); None above the horizon."""
    if y <= 1030:
        return None
    D = CAM_H * np.hypot(x - 1024, 1024) / (y - 1024)
    az = np.radians(FACE_AZ[k] + np.degrees(np.arctan((x - 1024) / 1024)))
    return E0 + D * np.sin(az), N0 + D * np.cos(az), D


class Path_:
    """The surveyed track as a polyline with chainage, smoothed heading, lateral offset lookup."""

    def __init__(self, tg):
        self.P = tg[["Easting", "Northing"]].values.astype(float)
        self.z_cam = tg.Elevation.values.astype(float)
        step = np.hypot(*np.diff(self.P, axis=0).T)
        self.ch = np.r_[0, np.cumsum(step)]
        self.titles = tg.Title.values
        self.tree = cKDTree(self.P)
        # tangent from points +-40 ft away, so GNSS jitter does not swing the heading
        n = len(self.P)
        t = np.zeros((n, 2))
        for i in range(n):
            lo = np.searchsorted(self.ch, self.ch[i] - 40)
            hi = min(np.searchsorted(self.ch, self.ch[i] + 40), n - 1)
            v = self.P[hi] - self.P[lo]
            t[i] = v / (np.linalg.norm(v) + 1e-9)
        self.t = t

    def locate(self, E, N):
        """(chainage ft, signed lateral ft, + = right of travel direction, station index)"""
        _, i = self.tree.query([E, N])
        v = np.array([E, N]) - self.P[i]
        along = v @ self.t[i]
        lat = v[0] * self.t[i][1] - v[1] * self.t[i][0]
        return float(self.ch[i] + along), float(lat), int(i)


def profile(path, ann, pos, idot, crashes_near):
    cat = {c["id"]: c["name"] for c in ann["categories"]}
    img = {i["id"]: i for i in ann["images"]}
    rows = []
    for a in ann["annotations"]:
        name = cat[a["category_id"]]
        if name not in STRIPE or not a.get("segmentation"):
            continue
        im = img[a["image_id"]]
        st, k = im["file_name"].split("/")[-2], int(im["file_name"].split("/")[-1].split("_")[1])
        if st not in pos or k not in FACE_AZ:
            continue
        E0, N0, _ = pos[st]
        s = np.array(a["segmentation"][0], float)
        for x, y in zip(s[0::2], s[1::2]):
            g = ground(k, x, y, E0, N0)
            if g is None or g[2] > 45:
                continue
            ch, lat, _ = path.locate(g[0], g[1])
            rows.append((STRIPE[name], name, ch, lat))
    p = pd.DataFrame(rows, columns=["grp", "name", "ch", "lat"])
    p["bin"] = (p.ch // BIN_FT).astype(int)
    nb = int(path.ch[-1] // BIN_FT) + 1
    out = {}

    def side_med(grp, side):
        q = p[(p.grp == grp) & ((p.lat > 0) if side == "R" else (p.lat < 0))]
        m = q.groupby("bin").lat.median().reindex(range(nb))
        return m.rolling(5, center=True, min_periods=2).median()

    cen = p[p.grp == "centre"].groupby("bin").lat.median().reindex(range(nb)).rolling(5, center=True, min_periods=2).median()
    ctype = p[p.grp == "centre"].groupby("bin").name.agg(lambda s: Counter(s).most_common(1)[0][0]).reindex(range(nb))
    # majority over ~225 ft: passing zones run hundreds of feet, single-bin flips are mask noise
    # (Beaverton photo check 2026-10-30: 19 of 21 locations agree; both misses at transitions near intersections)
    ctype = pd.Series([Counter(ctype.iloc[max(0, i - 4):i + 5].dropna()).most_common(1)[0][0] if ctype.iloc[max(0, i - 4):i + 5].notna().any() else None
                       for i in range(nb)], index=ctype.index)
    for grp in ("edge_line", "pavement_edge", "shoulder_edge"):
        for side in ("L", "R"):
            m = side_med(grp, side)
            ref = m.rolling(41, center=True, min_periods=5).median()
            out[f"{grp}_{side}"] = m.where((m - ref).abs() <= 3.0)  # a 25-ft bin 3 ft off its neighbourhood is a stray mask
    # physical order outward from the centre: edge line, then pavement edge, then shoulder edge
    for side in ("L", "R"):
        e, p_, sh = out[f"edge_line_{side}"], out[f"pavement_edge_{side}"], out[f"shoulder_edge_{side}"]
        out[f"pavement_edge_{side}"] = p_.where(~(p_.abs() < e.abs() - 0.3))
        p_ = out[f"pavement_edge_{side}"]
        out[f"shoulder_edge_{side}"] = sh.where(~(sh.abs() < p_.abs() - 0.3))
    # station-level geometry per bin
    bch = (np.arange(nb) + 0.5) * BIN_FT
    idx = np.clip(np.searchsorted(path.ch, bch), 0, len(path.ch) - 1)
    z_road = path.z_cam - CAM_H + Z_SHIFT
    zb = np.interp(bch, path.ch, pd.Series(z_road).rolling(5, center=True, min_periods=1).median().values)
    grade = np.gradient(zb, BIN_FT) * 100
    grade = pd.Series(grade).rolling(4, center=True, min_periods=1).mean().values
    head = np.degrees(np.arctan2(path.t[idx, 0], path.t[idx, 1])) % 360
    hu = np.unwrap(np.radians(head))
    kappa = pd.Series(np.gradient(hu, BIN_FT)).rolling(6, center=True, min_periods=2).mean().values
    radius = np.where(np.abs(kappa) > 1e-5, 1 / np.abs(kappa), np.inf)
    prof = []
    for b in range(nb):
        c = cen.iloc[b]
        E, N = path.P[idx[b]]
        lon, lat = to_ll(E, N)
        rec = {"chainage_ft": round(float(bch[b]), 1), "station": sta(bch[b]), "x_ft": round(float(E), 2), "y_ft": round(float(N), 2),
               "lon": round(lon, 7), "lat": round(lat, 7), "z_ft": round(float(zb[b]), 2), "grade_pct": round(float(grade[b]), 2),
               "heading_deg": round(float(head[b]), 1),
               "curve_radius_ft": None if not np.isfinite(radius[b]) or radius[b] > 5000 else round(float(radius[b])),
               "curve_dir": None if not np.isfinite(radius[b]) or radius[b] > 5000 else ("right" if kappa[b] > 0 else "left"),
               "centre_offset_ft": None if not np.isfinite(c) else round(float(c), 2),
               "centre_type": None if pd.isna(ctype.iloc[b]) else CENTRE_TYPE[ctype.iloc[b]]}
        for key, s in out.items():
            v = s.iloc[b]
            rec[key + "_ft"] = None if not np.isfinite(v) or not np.isfinite(c) else round(float(v - c), 2)  # from centre line
        el, er = rec["edge_line_L_ft"], rec["edge_line_R_ft"]
        pl, pr = rec["pavement_edge_L_ft"], rec["pavement_edge_R_ft"]
        sl, sr = rec["shoulder_edge_L_ft"], rec["shoulder_edge_R_ft"]
        rec["lane_width_L_ft"] = None if el is None else round(-el, 2)
        rec["lane_width_R_ft"] = None if er is None else round(er, 2)
        rec["paved_width_ft"] = None if pl is None or pr is None else round(pr - pl, 2)
        rec["shoulder_width_L_ft"] = None if sl is None or pl is None else round(pl - sl, 2) if sl < pl else None
        rec["shoulder_width_R_ft"] = None if sr is None or pr is None else round(sr - pr, 2) if sr > pr else None
        rec.update(idot(E, N, ROAD_KEY))
        prof.append(rec)
    return prof, out, cen


def idot_lookup():
    feats = json.load(open(ROOT / "raw_data" / "idot_boone_roads.geojson"))["features"]
    from shapely.geometry import Point, shape
    from shapely.ops import transform
    from shapely.strtree import STRtree
    to_sp = Transformer.from_crs("EPSG:4326", "EPSG:3435", always_xy=True).transform
    geoms = [transform(to_sp, shape(f["geometry"])) for f in feats]
    tree = STRtree(geoms)

    def f(E, N, prefer=None):
        pt = Point(E, N)
        near = [int(i) for i in tree.query(pt.buffer(80))]
        near = sorted(near, key=lambda i: geoms[i].distance(pt))
        own = [i for i in near if prefer and prefer in str(feats[i]["properties"].get("ROAD_NAME", ""))]
        i = (own or near or [None])[0]
        p = feats[i]["properties"] if i is not None else {}
        return {"idot_seg": int(i) if p else None, "road_name": p.get("ROAD_NAME"), "aadt": p.get("AADT"), "aadt_year": p.get("AADT_YR"),
                "functional_class": p.get("FC_NAME"), "surface_type_code": p.get("SURF_TYP"), "surface_year": p.get("SURF_YR"),
                "speed_limit_idot": p.get("SP_LIM") or None, "jurisdiction_code": p.get("JUR_TYPE"), "township": p.get("TOWNSHIP_N"),
                "lanes": p.get("LNS")}
    return f, geoms, feats


def at(prof, ch):
    b = int(np.clip(ch // BIN_FT, 0, len(prof) - 1))
    return prof[b]


def views(g, rows, E, N):
    """Per supporting detection: distance, horizontal angle, image geometry."""
    out = []
    for r in rows:
        d = g.iloc[r]
        D = float(np.hypot(E - d.E, N - d.N))
        x0, y0, x1, y1 = d.bbox
        xc = (x0 + x1) / 2
        q = np.hypot(xc - 1024, 1024)
        out.append({"st": d.st, "face": int(d.face), "D": D, "az": float(d.az), "x0": x0, "y0": y0, "x1": x1, "y1": y1, "q": q,
                    "top_h": CAM_H + D * (1024 - y0) / q if y0 > 8 else np.nan,
                    "bot_h": CAM_H - D * (y1 - 1024) / q if y1 < 2040 else np.nan,
                    "width": D * (np.arctan((x1 - 1024) / 1024) - np.arctan((x0 - 1024) / 1024)) if 4 < x0 and x1 < 2044 else np.nan,
                    "poly": d.poly, "reviewed": bool(d.reviewed), "score": d.score, "image": d.image, "bbox": d.bbox})
    return pd.DataFrame(out)


def med(v):
    v = np.asarray(v, float)
    v = v[np.isfinite(v)]
    if not len(v):
        return np.nan, np.nan, 0
    return float(np.median(v)), float(np.subtract(*np.percentile(v, [75, 25]))) if len(v) > 1 else np.nan, len(v)


def pole_lean(v):
    """Least-squares horizontal lean vector from the image slope of the pole axis in each view (a level camera keeps
    vertical lines vertical, so a slope is lean seen across the line of sight). Returns (deg, toward bearing, n views)."""
    A, b = [], []
    for r in v.itertuples():
        if r.poly is None or len(r.poly) < 8:
            continue
        P = r.poly
        ys = P[:, 1]
        if ys.max() - ys.min() < 200:
            continue
        bands = np.linspace(ys.min(), ys.max(), 9)
        mids = [(P[(ys >= lo) & (ys < hi), 0].min() + P[(ys >= lo) & (ys < hi), 0].max()) / 2
                for lo, hi in zip(bands[:-1], bands[1:]) if ((ys >= lo) & (ys < hi)).sum() >= 2]
        yc = [(lo + hi) / 2 for lo, hi in zip(bands[:-1], bands[1:]) if ((ys >= lo) & (ys < hi)).sum() >= 2]
        if len(mids) < 5:
            continue
        slope = np.polyfit(yc, mids, 1)[0]  # dx/dy, y down
        az = np.radians(r.az)
        A.append([np.cos(az), -np.sin(az)])  # image-right axis in (E, N)
        b.append(-slope)
    if len(A) < 2:
        return np.nan, np.nan, len(A)
    A, b = np.array(A), np.array(b)
    if np.linalg.matrix_rank(A, tol=0.3) < 2:
        return np.nan, np.nan, len(A)
    l, *_ = np.linalg.lstsq(A, b, rcond=None)
    return float(np.degrees(np.arctan(np.hypot(*l)))), float(np.degrees(np.arctan2(l[0], l[1])) % 360), len(A)


def coming(unit, why):
    """A value we can't stand behind yet: shown as "Coming up" with what it needs, never as a number."""
    return {"value": None, "unit": unit, "source": "coming", "method": why}


CAM_U = 0.25  # ft, uncertainty of the per-road camera-height calibration; added to every camera-height-based spread


def hspread(s):
    return float(np.hypot(s if s is not None and np.isfinite(s) else 0.0, CAM_U))


_DEM = {}


def dem_ground(lon, lat, cache_file):
    """USGS 3DEP 1 m lidar bare-earth elevation (NAVD88 ft) at a point, from a cache, fetching what's missing."""
    import urllib.request
    if not _DEM and cache_file.exists():
        _DEM.update({tuple(map(float, k.split(","))): v for k, v in json.load(open(cache_file)).items()})
    near = [v for (x, y), v in _DEM.items() if abs(x - lon) < 2e-5 and abs(y - lat) < 2e-5]
    if near:
        return near[0]
    for _ in range(4):
        try:
            u = f"https://epqs.nationalmap.gov/v1/json?x={lon}&y={lat}&units=Feet&wkid=4326"
            v = float(json.load(urllib.request.urlopen(u, timeout=40))["value"])
            _DEM[(lon, lat)] = v
            json.dump({f"{x:.7f},{y:.7f}": w for (x, y), w in _DEM.items()}, open(cache_file, "w"), indent=0)
            return v
        except Exception:
            pass
    return None


def gated(at, limit, unit_word):
    """Keep a measured value only when its views agree within `limit`; otherwise say why it isn't shown."""
    if at is None or at.get("spread", 0) <= limit:
        return at
    return coming(at["unit"], f"the views disagree by ±{at['spread']:.1f} {unit_word} (we only show values within ±{limit:g}); "
                              "will firm up with more views or the survey LiDAR")


def estimate(lo, hi, unit, method, views, scale=1.0, nd=0):
    """A range, not a point: shown as "lo–hi" with source "estimate"."""
    lo, hi = round(float(lo) * scale, nd), round(float(hi) * scale, nd)
    if nd == 0:
        lo, hi = int(lo), int(hi)
    return {"value": round((lo + hi) / 2, 1), "range": [lo, hi], "unit": unit, "source": "estimate", "method": method, "views": int(views)}


def illustrative(cls, rng):
    if cls.startswith("sign:"):
        sheeting = rng.choice(["Type IV prismatic", "Type I engineering grade", "Type XI microprismatic"], p=[.6, .25, .15])
        yr = int(rng.integers(2006, 2023))
        ra = {"Type IV prismatic": 250, "Type I engineering grade": 70, "Type XI microprismatic": 400}[sheeting] * float(rng.uniform(.45, 1.1))
        return {"sheeting": attr(sheeting, None, "illustrative", "synthetic example of a county sign-inventory field"),
                "install_year": attr(yr, None, "illustrative", "placeholder for the county sign inventory"),
                "retroreflectivity": attr(round(ra), "cd/lx/m²", "illustrative", "placeholder for a handheld retroreflectometer reading"),
                "post": attr(rng.choice(["U-channel steel", "square perforated steel", "wood 4x4"]), None, "illustrative", "placeholder")}
    if cls in ("utility_pole", "light_pole"):
        return {"owner": attr("utility (not identified)", None, "illustrative", "placeholder for the utility's pole attachment records"),
                "material": attr("wood", None, "illustrative", "typical for rural distribution poles; not observed")}
    if cls == "guardrail":
        return {"end_treatment": attr(rng.choice(["turned-down end", "MASH-tested terminal", "unknown"]), None, "illustrative", "needs image review"),
                "rail_height": attr(round(float(rng.uniform(26, 31)), 1), "in", "illustrative", "placeholder; MASH systems are 31 in")}
    return {}


def build(a):
    tr = pd.read_csv(a.trajectory)
    tr.columns = [c.strip() for c in tr.columns]
    pos = {r.Title: (r.Easting, r.Northing, r.Heading) for r in tr.itertuples()}
    ann = json.load(open(a.annotations))
    det = G.detections(ann, pos)
    tr["track"] = tr.Title.str.extract(r"_(T\d+)_")[0]
    tg = tr[tr.track == a.track].assign(n=lambda d: d.Panorama.str.extract(r"(\d+)\.jpg")[0].astype(int)).sort_values("n")
    path = Path_(tg)
    idot, igeoms, ifeats = idot_lookup()
    prof, edges, cen = profile(path, ann, {k: v for k, v in pos.items() if k in set(tg.Title)}, idot, None)
    inv_f = Path(a.raw) / "idot_inventory.geojson"
    if inv_f.exists():  # IDOT roadway inventory (D2_Roads_2017, State Plane ft): recorded widths, the public check on ours
        from shapely.geometry import Point, shape
        inv = [(shape(f["geometry"]), f["properties"]) for f in json.load(open(inv_f))["features"]]
        for r in prof:
            pt = Point(r["x_ft"], r["y_ft"])
            g, q = min(inv, key=lambda t: t[0].distance(pt))
            ok = g.distance(pt) < 80
            r["idot_surface_width_ft"] = q["SURF_WTH"] or None if ok else None
            r["idot_lane_width_ft"] = q["LN_WTH"] or None if ok else None
            r["idot_shoulder_width_ft"] = q["O_SHD1_WTH"] or None if ok else None
    for r in prof:  # our shoulder edge disagrees with IDOT's recorded shoulders on the audited road: not shown
        r["shoulder_width_L_ft"] = r["shoulder_width_R_ft"] = None
    prof = sanitize(prof, cross_streets(path, igeoms, ifeats))
    rng = np.random.default_rng(11)

    det = det[det.st.isin(set(tg.Title))]
    assets = []
    for cls, g in det.groupby("cls"):
        g = g.reset_index(drop=True)
        if cls in G.LINEAR.values():
            continue
        for k, x in enumerate(G.triangulate(g, ground=cls in G.GROUND)):
            E, N = x["E"], x["N"]
            ch, lat, si = path.locate(E, N)
            pr = at(prof, ch)
            v = views(g, x["rows"], E, N)
            lon, latd = to_ll(E, N)
            c = pr["centre_offset_ft"] or 0.0
            off_c = lat - c  # from centre line, + right of travel
            side = "right" if off_c > 0 else "left"
            el = pr["edge_line_R_ft"] if side == "right" else pr["edge_line_L_ft"]
            pe = pr["pavement_edge_R_ft"] if side == "right" else pr["pavement_edge_L_ft"]
            se = pr["shoulder_edge_R_ft"] if side == "right" else pr["shoulder_edge_L_ft"]
            from_tw = abs(off_c) - abs(el) if el is not None else np.nan
            from_pe = abs(off_c) - abs(pe) if pe is not None else np.nan
            from_se = abs(off_c) - abs(se) if se is not None else np.nan
            bot, bot_s, nb = med(v.bot_h)
            top, top_s, nt = med(v.top_h)
            wid, wid_s, nw = med(v.width)
            z_road = pr["z_ft"]
            zg = dem_ground(round(to_ll(E, N)[0], 7), round(to_ll(E, N)[1], 7), Path(a.raw) / "usgs_3dep_ground.json") if a.z_shift else None
            A = {
                "x_ft": attr(E, "ft", "measured", "multi-station bearing triangulation, IL State Plane East (NAD83, US ft)", spread=x["ray_residual_ft"]),
                "y_ft": attr(N, "ft", "measured", "as x", spread=x["ray_residual_ft"]),
                "z_ft": attr(zg, "ft", "public", "ground elevation at this x,y from USGS 3DEP 1 m lidar (NAVD88)") if zg is not None else
                        attr(z_road, "ft", "derived", "road surface elevation at this chainage"),
                "chainage_ft": attr(ch, "ft", "derived", "distance along the surveyed track from its start"),
                "station": attr(sta(ch), None, "derived", "engineering station (hundreds of feet + feet) from the start of the survey"),
                "side": attr(side, None, "derived", "side of the centre line, relative to the survey direction"),
                "offset_centre_ft": attr(abs(off_c), "ft", "derived", "lateral distance from the detected centre line"),
                "offset_travelled_way_ft": attr(from_tw, "ft", "derived", "lateral distance beyond the white edge line (edge of travelled way)"),
                "offset_pavement_edge_ft": attr(from_pe, "ft", "derived", "lateral distance beyond the pavement edge"),
                "offset_shoulder_edge_ft": coming("ft", "our detected shoulder edge disagrees with IDOT's recorded 4-5 ft shoulders, so it isn't shown until checked"),
                "seen_from_stations": attr(x["n_stations"], None, "measured", "survey stations whose bearing passes within 5 ft"),
                "detections": attr(x["n_detections"], None, "measured", "image detections supporting this asset"),
                "position_residual_ft": attr(x["ray_residual_ft"], "ft", "measured", "median miss distance of the supporting bearings"),
                "detector_confidence": attr(x["mean_score"], None, "measured", "mean model score of the supporting detections"),
                "human_reviewed": attr(x["reviewed_share"] > 0, None, "measured", "at least one supporting image was checked in CVAT"),
            }
            if cls.startswith("sign:"):
                t = cls.split(":")[1]
                A["sign_type"] = attr(SIGN_NAMES.get(t, t), None, "measured", "engine coarse sign class")
                A["bottom_height_ft"] = gated(attr(bot, "ft", "measured", "height of the sign's lower edge above the road surface", spread=hspread(bot_s), views=nb), 1.0, "ft")
                A["top_height_ft"] = gated(attr(top, "ft", "measured", "height of the sign's upper edge above the road surface", spread=hspread(top_s), views=nt), 1.0, "ft")
                A["panel_width_in"] = coming("in", "the detection box can include a plate mounted beside or under the sign; needs a sign-face outline")
                A["panel_height_in"] = coming("in", "as panel width")
                A["serves_traffic"] = coming(None, "which road a sign faces needs the sign-face orientation; signs at intersections often face the cross street")
                if (A.get("bottom_height_ft") or {}).get("value") is not None:
                    tol = max(0.5, hspread(bot_s))
                    A["mutcd_2A15_height"] = attr(verdict(bot - 5, tol, "meets", "below minimum"), None, "derived",
                                                  "MUTCD 11th ed. 2A.15: rural roadside signs, bottom >= 5 ft above the near pavement edge",
                                                  margin_ft=round(bot - 5, 2))
                A["mutcd_2A16_lateral"] = coming(None, "MUTCD 2A.16 (>= 12 ft from the travelled way) is measured from the road the sign serves; waits on sign orientation")
            elif cls in ("utility_pole", "light_pole"):
                # Audited 2026-10-30 against the photos: pole masks often stop short of the top and the base is hidden in
                # grass, so height, base and lean from the masks are not shown as numbers.
                vis = v[np.isfinite(v.top_h) & (v.D > 25)]
                if len(vis):
                    dz = (z_road - zg) if zg is not None else 0.0  # pole tops are measured from the road; the pole stands on the ground beside it
                    tops = vis.top_h.values + dz
                    lo, hi = np.percentile(tops, 50) - CAM_U, max(np.percentile(tops, 90), np.percentile(tops, 50) + 1.0) + CAM_U
                    A["height_ft"] = estimate(lo, hi, "ft", "top of the pole above the ground at its base (USGS lidar), from views more than 25 ft away. "
                                              "Low end: median view; high end: the views whose outline reaches highest. Outlines sometimes stop below the "
                                              "top, so the true height is more likely in the upper part of the range", len(vis))
                else:
                    A["height_ft"] = coming("ft", "the pole top isn't inside any view far enough away to measure")
                A["base_vs_road_ft"] = coming("ft", "the pole base is usually hidden in grass; needs the survey LiDAR")
                A["lean_deg"] = coming("deg", "needs full-length pole outlines (see height); the current outlines are too short to trust a lean angle")
            elif cls == "mailbox":
                vis = v[np.isfinite(v.top_h)]
                if len(vis) >= 2:
                    q1, q3 = np.percentile(vis.top_h, [25, 75])
                    A["top_height_in"] = estimate(q1 - CAM_U, q3 + CAM_U, "in", "top of the box above the road surface, middle half of the views "
                                                  "widened by the camera-height uncertainty", len(vis), scale=12)
                else:
                    A["top_height_in"] = coming("in", "seen in too few views to estimate")
            elif cls == "driveway":
                A["width_ft"] = attr(wid, "ft", "measured", "angular width x distance of the access mask", spread=wid_s, views=nw)
            A.update(illustrative(cls, rng))
            assets.append({"id": f"{a.slug}-{cls.replace(':', '-')}-{k:03d}", "class": "sign" if cls.startswith("sign:") else cls,
                           "subclass": cls.split(":")[1] if cls.startswith("sign:") else None,
                           "label": SIGN_NAMES.get(cls.split(":")[1], cls) if cls.startswith("sign:") else CLASS_LABEL[cls],
                           "lon": round(lon, 7), "lat": round(latd, 7), "attrs": {k2: v2 for k2, v2 in A.items() if v2 is not None},
                           "evidence": [{"image": r.image, "bbox": [round(b) for b in r.bbox], "station": r.st, "face": r.face,
                                         "distance_ft": round(r.D, 1), "reviewed": r.reviewed}
                                        for r in v[(v.x1 - v.x0 >= 10) & (v.y1 - v.y0 >= 10)].sort_values("D").head(6).itertuples()]})
    # linear assets
    for cls, g in det.groupby("cls"):
        if cls not in G.LINEAR.values():
            continue
        g = g.reset_index(drop=True)
        for k, r in enumerate(G.linear_runs(g, path.P)):
            coords = r["coords"]
            ch0, _, _ = path.locate(*coords[0])
            ch1, _, _ = path.locate(*coords[-1])
            pr = at(prof, (ch0 + ch1) / 2)
            side = r["side"]
            pe = pr["pavement_edge_R_ft"] if side == "right" else pr["pavement_edge_L_ft"]
            # draw the run offset to its side of the road: a few ft beyond the pavement edge
            offs = (abs(pe) if pe is not None else 12) + 4
            sgn = 1 if side == "right" else -1
            i0 = np.searchsorted(path.ch, ch0)
            i1 = max(np.searchsorted(path.ch, ch1), i0 + 1)
            line = [list(to_ll(*(path.P[i] + sgn * offs * np.array([path.t[i][1], -path.t[i][0]])))) for i in range(i0, min(i1 + 1, len(path.P)))]
            A = {"start_chainage_ft": attr(ch0, "ft", "derived", "first station seeing the run"),
                 "end_chainage_ft": attr(ch1, "ft", "derived", "last station seeing the run"),
                 "length_ft": attr(r["length_ft"], "ft", "measured", "along-track extent of consecutive stations seeing it on this side"),
                 "side": attr(side, None, "measured", "side relative to the survey direction"),
                 "seen_from_stations": attr(r["n_stations"], None, "measured", "stations with a detection on this side"),
                 "human_reviewed": attr(r["reviewed_share"] > 0, None, "measured", "at least one supporting image checked in CVAT")}
            A.update(illustrative(cls, rng))
            assets.append({"id": f"{a.slug}-{cls}-{k:03d}", "class": cls, "subclass": None, "label": CLASS_LABEL[cls],
                           "line": [[round(x, 7), round(y, 7)] for x, y in line], "lon": line[len(line) // 2][0], "lat": line[len(line) // 2][1],
                           "attrs": {k2: v2 for k2, v2 in A.items() if v2 is not None}, "evidence": []})
    return path, prof, assets, igeoms, ifeats


def sta(ft):
    """Engineering station notation: 2381.8 ft -> 23+82."""
    ft = int(round(ft))
    return f"{ft // 100}+{ft % 100:02d}"


def verdict(margin, tol, ok, bad):
    """Three-way check: a margin inside the measurement tolerance is 'borderline', not a pass or a fail."""
    if abs(margin) < tol:
        return "borderline (within measurement spread)"
    return ok if margin > 0 else bad


def G_pos(pos, st):
    return pos[st][0], pos[st][1]


def compass(deg):
    return ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"][int(((deg + 22.5) % 360) // 45)]


def sanitize(prof, xs):
    """Physical plausibility for a two-lane rural road, applied after detection; failing values become gaps, not numbers.
    Found by overlaying the profile on the photos (2026-10-30): at intersections the side road's paint and corner flares
    were read as this road's centre line and edges."""
    near_x = lambda ch: any(abs(ch - x["chainage_ft"]) < 70 for x in xs)
    for r in prof:
        c = r["centre_offset_ft"]
        if c is not None and not (-7 <= c <= 3):  # observed: the survey path runs ~1.7 ft right of the centre line (median); 17 ft is a side road
            for k in [k for k in r if k.endswith(("_L_ft", "_R_ft")) or k == "centre_offset_ft" or k == "paved_width_ft"]:
                r[k] = None
            r["centre_type"] = None
            continue
        for side, sg in (("L", -1), ("R", 1)):
            e, pe, se = (r[f"{g}_{side}_ft"] for g in ("edge_line", "pavement_edge", "shoulder_edge"))
            if e is not None and not (6 <= sg * e <= 15):
                r[f"edge_line_{side}_ft"] = e = None
            if pe is not None and (not (7 <= sg * pe <= 16) or near_x(r["chainage_ft"])):
                r[f"pavement_edge_{side}_ft"] = pe = None
            if se is not None and (pe is None or not (0.3 <= sg * (se - pe) <= 6)):
                r[f"shoulder_edge_{side}_ft"] = None
        el, er, pl, pr = r["edge_line_L_ft"], r["edge_line_R_ft"], r["pavement_edge_L_ft"], r["pavement_edge_R_ft"]
        r["lane_width_L_ft"] = None if el is None else round(-el, 2)
        r["lane_width_R_ft"] = None if er is None else round(er, 2)
        r["paved_width_ft"] = None if pl is None or pr is None else round(pr - pl, 2)
    return prof


def cross_streets(path, igeoms, ifeats):
    """Roads that cross or meet the surveyed track (IDOT centrelines), as station + name, for labelling drawings."""
    from shapely.geometry import LineString
    track = LineString(path.P)
    out = []
    for g, f in zip(igeoms, ifeats):
        name = str(f["properties"].get("ROAD_NAME") or "").strip()
        if not name or (ROAD_KEY and ROAD_KEY in name.upper()):
            continue
        if g.distance(track) > 40:
            continue
        pt = g.intersection(track.buffer(40)).centroid
        ch, lat, _ = path.locate(pt.x, pt.y)
        if 0 < ch < path.ch[-1] and not any(o["name"] == name.title() and abs(o["chainage_ft"] - ch) < 300 for o in out):
            out.append({"name": name.title(), "chainage_ft": round(float(ch), 1)})
    return sorted(out, key=lambda o: o["chainage_ft"])


def crashes_along(path, prof):
    f = ROOT.parent / "pavement-eval" / "data" / "public" / "idot_crashes" / "boone_crashes_2014_2020.json"
    if not f.exists():
        return []
    c = pd.DataFrame(json.load(open(f)))
    out = []
    for r in c.itertuples():
        E, N = from_ll(r.lon, r.lat)
        d, i = path.tree.query([E, N])
        if d > 75 or i in (0, len(path.P) - 1):
            continue
        ch, lat, _ = path.locate(E, N)
        out.append({"chainage_ft": round(ch, 1), "lon": round(r.lon, 7), "lat": round(r.lat, 7), "date": str(r.CrashDate)[:10] if r.CrashDate else None,
                    "year": r.CrashYr, "hour": r.CrashHour, "type": r.TypeOfFirstCrash, "severity": r.CrashInjurySeverity,
                    "light": r.LightingCond, "surface": r.RoadSurfaceCond, "weather": r.WeatherCond, "alignment": r.RoadAlignment,
                    "cause": r.Cause1, "vehicles": r.NumberOfVehicles, "intersection": r.IntersectionRelated, "source": "public"})
    return sorted(out, key=lambda x: x["chainage_ft"])


def panos(path, a):
    """Street-view stops along the track: position, heading, chainage, and which panorama folder to show.
    With --imagery-from, each stop borrows the panorama at the same fraction of the way along the other road."""
    titles = list(path.titles)
    own = ROOT / "public" / "data" / "roads" / a.slug / "pano"
    borrowed = None
    if a.imagery_from:
        d = ROOT / "public" / "data" / "roads" / a.imagery_from / "pano"
        borrowed = sorted((p.name for p in d.iterdir() if p.is_dir()), key=lambda n: int(n.split("_")[-1]))
    out = []
    for i, t in enumerate(titles):
        if borrowed:
            src = f"{a.imagery_from}/pano/{borrowed[int(i * len(borrowed) / len(titles))]}"
        elif (own / t).exists():
            src = f"{a.slug}/pano/{t}"
        else:
            continue
        E, N = path.P[i]
        lon, lat = to_ll(E, N)
        out.append({"title": t, "ch": round(float(path.ch[i]), 1), "x": round(float(E), 2), "y": round(float(N), 2),
                    "lon": round(lon, 7), "lat": round(lat, 7), "z": round(float(path.z_cam[i] - CAM_H + Z_SHIFT), 2),
                    "heading": round(float(np.degrees(np.arctan2(path.t[i][0], path.t[i][1])) % 360), 1), "pano": src})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", default="stone-quarry")
    ap.add_argument("--name", default="Stone Quarry Rd")
    ap.add_argument("--raw", default=str(ROOT / "raw_data" / "survey" / "stonequarry"))
    ap.add_argument("--track", default="T1")
    ap.add_argument("--idot-name", default="STONE QUARRY")
    ap.add_argument("--annotations", default="stonequarry-rd_annotations.json", help="file name inside --raw")
    ap.add_argument("--source", default="ARIA mobile survey (Pegasus panorama), engine run 2026-10-28 (yolo26-6fd545-e72d5a)")
    ap.add_argument("--sparse", action="store_true",
                    help="survey stops ~50 ft apart: pair stops up to 170 ft and accept objects seen from 2 stops")
    ap.add_argument("--imagery-from", default=None,
                    help="slug of another road whose panoramas stand in for this road's (shown as representative imagery)")
    ap.add_argument("--drop-classes", default="",
                    help="comma list of asset classes to remove, with --drop-reason (field knowledge that overrides the detector)")
    ap.add_argument("--drop-reason", default="")
    ap.add_argument("--cam-height", type=float, default=None,
                    help="camera height above the road (ft), calibrated per vehicle; default the geolocate constant")
    ap.add_argument("--z-shift", type=float, default=0.0,
                    help="ft added to road elevations: median (USGS 3DEP 1 m DEM - our road z) at sampled stations")
    a = ap.parse_args()
    global ROAD_KEY, Z_SHIFT, CAM_H
    Z_SHIFT = a.z_shift
    if a.cam_height:
        CAM_H = G.CAM_H_FT = a.cam_height
    ROAD_KEY = a.idot_name
    if a.sparse:
        G.PAIR_MAX_FT, G.MIN_SAMPLES, G.MIN_STATIONS = 170, 2, 2
        G.GROUND.discard("driveway")  # turnout masks run off the bottom of the frame, so no ground-contact range
    a.annotations = str(Path(a.raw) / a.annotations)
    a.trajectory = str(Path(a.raw) / "trajectory.csv")
    path, prof, assets, _, _ = build(a)
    _, igeoms, ifeats = idot_lookup()
    xs = cross_streets(path, igeoms, ifeats)
    crashes = crashes_along(path, prof)
    corrections = []
    drops = {c: a.drop_reason for c in filter(None, a.drop_classes.split(","))}
    rv_f = Path(a.raw) / "review.json"
    rv = json.load(open(rv_f)) if rv_f.exists() else {}
    drops.update(rv.get("drop_classes", {}))
    for c, why in drops.items():
        n = sum(1 for x in assets if x["class"] == c)
        assets = [x for x in assets if x["class"] != c]
        corrections.append({"class": c, "removed": n, "reason": why})
    for r in rv.get("reject", []):  # matched by location (within ~10 ft) so ids can change between builds
        hit = [x for x in assets if x["class"] == r["class"] and abs(x["lon"] - r["lon"]) < 4e-5 and abs(x["lat"] - r["lat"]) < 3e-5]
        assets = [x for x in assets if x not in hit]
        corrections.append({"class": r["class"], "removed": len(hit), "reason": r["reason"]})
    for x in assets:
        if x["class"] in rv.get("verified_classes", []):
            x["attrs"]["visually_verified"] = attr(True, None, "measured", f"checked by eye in the survey photos on {rv['reviewed_on']}")
    ann = json.load(open(a.annotations))
    n_rev = sum(1 for i in ann["images"] if i.get("source") == "reviewed")
    out = ROOT / "public" / "data" / "roads" / a.slug
    out.mkdir(parents=True, exist_ok=True)
    line = [[p["lon"], p["lat"]] for p in prof]
    widths = pd.DataFrame(prof)
    road = {"slug": a.slug, "name": a.name, "track": a.track, "length_ft": round(float(path.ch[-1]), 1),
            "stations": len(path.P), "line": line, "profile": prof, "crashes": crashes,
            "panos": panos(path, a), "imagery": {"representative": bool(a.imagery_from), "from": a.imagery_from or a.slug},
            "corrections": corrections,
            "cross_streets": xs,
            "quality": json.load(open(Path(a.raw) / "quality.json")) if (Path(a.raw) / "quality.json").exists() else None,
            "survey": {"source": a.source,
                       "faces": len(ann["images"]), "faces_reviewed": n_rev, "camera_height_ft": CAM_H, "review": {k: rv[k] for k in ("reviewed_on", "method") if k in rv}, "z_shift_ft": a.z_shift,
                       "crs": "IL State Plane East, NAD83, US survey ft (EPSG:3435); " + (f"elevations from the survey trajectory, tied to USGS 3DEP 1 m lidar (NAVD88 ft; shift {a.z_shift:+.2f} ft)" if a.z_shift else "elevations from the survey trajectory (ft)")},
            "summary": {"paved_width_ft_median": float(widths.paved_width_ft.median()),
                        "lane_width_ft_median": float(pd.concat([widths.lane_width_L_ft, widths.lane_width_R_ft]).median())}}
    json.dump(road, open(out / "road.json", "w"), separators=(",", ":"))
    json.dump(assets, open(out / "assets.json", "w"), separators=(",", ":"))
    idx_f = ROOT / "public" / "data" / "roads" / "index.json"
    idx = json.load(open(idx_f)) if idx_f.exists() else []
    idx = [r for r in idx if r["slug"] != a.slug] + [{"slug": a.slug, "name": a.name, "length_ft": road["length_ft"], "assets": len(assets)}]
    json.dump(idx, open(idx_f, "w"), indent=1)
    print(a.name, len(prof), "profile bins;", len(assets), "assets;", len(crashes), "crashes")
    print(Counter(x["class"] for x in assets))
    print(widths[["edge_line_L_ft", "edge_line_R_ft", "pavement_edge_L_ft", "pavement_edge_R_ft", "shoulder_edge_L_ft", "shoulder_edge_R_ft",
                  "lane_width_L_ft", "lane_width_R_ft", "paved_width_ft", "shoulder_width_L_ft", "shoulder_width_R_ft", "grade_pct", "z_ft"]].describe().round(2).to_string())


if __name__ == "__main__":
    main()
