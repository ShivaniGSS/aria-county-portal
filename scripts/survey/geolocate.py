"""Place engine detections on the map without images: every detection is a compass bearing from its survey station
(cube faces are compass-fixed: face 0 W, 1 N, 2 E, 3 S, 90 deg FOV, 2048 px; established from lane lines + right-hand
driving, see orient_side.py), and an object seen from several stations sits where those bearings cross.

Point assets (poles, light poles, mailboxes, signs, driveways):
  0. each detection also gets a ground-contact range where its base is visible below the horizon:
     D = CAM_H_FT * sqrt((x - 1024)^2 + 1024^2) / (y_base - 1024); rays whose range disagrees with the triangulated
     point by > 35% (and > 6 ft) do not support it. This removes "ghost" crossings of rays from different objects.
  1. pairwise ray intersections between stations 15-80 ft apart (crossing angle >= 5 deg, 5-150 ft in front of both)
  2. DBSCAN on the intersection points (eps 6 ft)
  3. each cluster -> least-squares point of the rays passing within 5 ft of it; kept only if >= MIN_STATIONS stations
     support it; a ray is used by at most one asset (strongest cluster first)
Linear assets (guard rail, fence): runs of stations that see the class on the same side of the road, as
start/end positions offset to that side.

Inputs: COCO annotations from the engine (images.source prelabel/reviewed) + trajectory CSV (IL East ft).
Output: GeoJSON (WGS84) with per-asset class, n_stations, n_detections, reviewed share, offset from the path.
"""

import argparse
import json
from collections import defaultdict

import numpy as np
import pandas as pd
from pyproj import Transformer
from sklearn.cluster import DBSCAN

FACE_AZ = {0: 270.0, 1: 0.0, 2: 90.0, 3: 180.0}
POINT = {"UtilityPole": "utility_pole", "UtilityPole_light": "light_pole", "Mail Box": "mailbox", "access": "driveway"}
LINEAR = {"Guard Rail": "guardrail", "Fence Line": "fence"}
MIN_STATIONS = 3
PAIR_MAX_FT = 80  # stops paired for intersection; raise for surveys with sparse stops
MIN_SAMPLES = 4  # DBSCAN core size on the intersection points
GROUND = {"utility_pole", "mailbox", "driveway"}  # masks reach the ground; sign boxes and light-pole masks often do not
CAM_H_FT = 8.25  # panorama height above the road, from 18 well-seen mailboxes (est_height.py: median 8.22 ft, same on all faces)
to_ll = Transformer.from_crs("EPSG:3435", "EPSG:4326", always_xy=True).transform  # IL East NAD83 ftUS


def detections(ann, pos):
    cat = {c["id"]: (c["name"], c["supercategory"]) for c in ann["categories"]}
    img = {i["id"]: i for i in ann["images"]}
    rows = []
    for a in ann["annotations"]:
        name, sup = cat[a["category_id"]]
        im = img[a["image_id"]]
        parts = im["file_name"].split("/")
        st, k = parts[-2], int(parts[-1].split("_")[1])
        if st not in pos or k not in FACE_AZ:
            continue
        if a.get("segmentation"):
            s = np.array(a["segmentation"][0], float)
            xs, ys = s[0::2], s[1::2]
        else:
            x, y, w, h = a["bbox"]
            xs, ys = np.array([x, x + w]), np.array([y, y + h])
        cls = "sign:" + name if sup == "signs_coarse" else POINT.get(name) or LINEAR.get(name)
        if cls is None:
            continue
        xm = float(np.median(xs)) if a.get("segmentation") else float(xs.mean())
        az = FACE_AZ[k] + np.degrees(np.arctan((xm - 1024) / 1024))
        E, N, H = pos[st]
        rows.append({"st": st, "face": k, "cls": cls, "az": az % 360, "E": E, "N": N, "H": H,
                     "reviewed": im.get("source") == "reviewed", "score": (a.get("attributes") or {}).get("score"),
                     "image": im["file_name"], "bbox": [float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())],
                     "poly": np.c_[xs, ys] if a.get("segmentation") else None, "name": name})
    return pd.DataFrame(rows)


def triangulate(g, ground=True):
    E, N = g.E.values, g.N.values
    yb = np.array([b[3] for b in g.bbox])
    xc = np.array([(b[0] + b[2]) / 2 for b in g.bbox])
    base_ok = (yb > 1060) & (yb < 2040) & ground
    rng = np.where(base_ok, CAM_H_FT * np.hypot(xc - 1024, 1024) / np.maximum(yb - 1024, 1), np.nan)
    a = np.radians(g.az.values)
    ux, uy = np.sin(a), np.cos(a)
    pts, pairs = [], []
    for i in range(len(g)):
        dx, dy = E - E[i], N - N[i]
        dist = np.hypot(dx, dy)
        j = np.where((dist > 15) & (dist < PAIR_MAX_FT))[0]
        if not len(j):
            continue
        det = -ux[i] * uy[j] + uy[i] * ux[j]
        ok = np.abs(det) > np.sin(np.radians(5))
        t = (-dx[j] * uy[j] + dy[j] * ux[j]) / np.where(ok, det, 1)
        s = (ux[i] * dy[j] - uy[i] * dx[j]) / np.where(ok, det, 1)
        h = ok & (t > 5) & (s > 5) & (t < 150) & (s < 150)
        for jj, tt in zip(j[h], t[h]):
            pts.append((E[i] + tt * ux[i], N[i] + tt * uy[i]))
            pairs.append((i, jj))
    if not pts:
        return []
    pts = np.array(pts)
    lab = DBSCAN(eps=6, min_samples=MIN_SAMPLES).fit_predict(pts)
    order = sorted({l for l in lab if l >= 0}, key=lambda l: -(lab == l).sum())
    used = np.zeros(len(g), bool)
    out = []
    for l in order:
        c = pts[lab == l].mean(axis=0)
        for _ in range(3):  # least squares point of the supporting rays
            vx, vy = c[0] - E, c[1] - N
            along = vx * ux + vy * uy
            perp = np.abs(vx * uy - vy * ux)
            dist = np.hypot(vx, vy)
            rng_bad = base_ok & (np.abs(rng - dist) > np.maximum(0.35 * dist, 6))
            sup = (~used) & (along > 3) & (along < 160) & (perp < 5) & ~rng_bad
            if sup.sum() < 2:
                break
            A = np.zeros((2, 2))
            b = np.zeros(2)
            for i in np.where(sup)[0]:
                nrm = np.array([uy[i], -ux[i]])
                A += np.outer(nrm, nrm)
                b += np.outer(nrm, nrm) @ np.array([E[i], N[i]])
            c = np.linalg.solve(A + 1e-6 * np.eye(2), b)
        if sup.sum() < 2 or g.st.values[sup].size == 0:
            continue
        n_st = len(set(g.st.values[sup]))
        n_rng = len(set(g.st.values[sup & base_ok]))
        if n_st < (MIN_STATIONS if ground else MIN_STATIONS + 1) or (ground and n_rng < 2):
            continue
        used |= sup
        gg = g[sup]
        resid = float(np.median(perp[sup]))
        best = gg.sort_values("reviewed", ascending=False).iloc[0]
        out.append({"E": float(c[0]), "N": float(c[1]), "n_stations": n_st, "n_detections": int(sup.sum()),
                    "range_checked_stations": n_rng,
                    "reviewed_share": round(float(gg.reviewed.mean()), 2), "ray_residual_ft": round(resid, 1),
                    "mean_score": None if gg.score.isna().all() else round(float(gg.score.mean()), 3),
                    "example_image": best.image, "example_bbox": best.bbox, "rows": np.where(sup)[0].tolist()})
    return out


def path_offset(E, N, P):
    """Signed lateral offset (ft, + = right of travel) and station chainage from the trajectory polyline."""
    d = np.hypot(P[:, 0] - E, P[:, 1] - N)
    i = int(np.argmin(d))
    j = min(i + 1, len(P) - 1) if i < len(P) - 1 else i - 1
    t = P[j] - P[i] if j > i else P[i] - P[j]
    t = t / (np.linalg.norm(t) + 1e-9)
    v = np.array([E, N]) - P[i]
    return float(v[0] * t[1] - v[1] * t[0]), float(d[i])


def linear_runs(g, P, gap_ft=60):
    """Runs of stations seeing a linear asset on the same side (left/right of travel) of the van."""
    out = []
    for side in ("left", "right"):
        rel = (g.az - g.H + 360) % 360
        s = g[(rel > 200) & (rel < 340)] if side == "left" else g[(rel > 20) & (rel < 160)]
        st = s.drop_duplicates("st")
        if st.empty:
            continue
        ch = np.array([np.argmin(np.hypot(P[:, 0] - e, P[:, 1] - n)) for e, n in zip(st.E, st.N)])
        order = np.argsort(ch)
        ch, st = ch[order], st.iloc[order]
        cum = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]
        start = 0
        for k in range(1, len(ch) + 1):
            if k == len(ch) or cum[ch[k]] - cum[ch[k - 1]] > gap_ft:
                if k - start >= MIN_STATIONS:
                    seg = P[ch[start]:ch[k - 1] + 1]
                    out.append({"side": side, "coords": seg, "length_ft": float(cum[ch[k - 1]] - cum[ch[start]]),
                                "n_stations": int(k - start), "reviewed_share": round(float(st.iloc[start:k].reviewed.mean()), 2)})
                start = k
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("annotations")
    ap.add_argument("trajectory")
    ap.add_argument("out")
    ap.add_argument("--road", required=True)
    a = ap.parse_args()
    tr = pd.read_csv(a.trajectory)
    tr.columns = [c.strip() for c in tr.columns]
    pos = {r.Title: (r.Easting, r.Northing, r.Heading) for r in tr.itertuples()}
    ann = json.load(open(a.annotations))
    d = detections(ann, pos)
    feats, summary = [], defaultdict(dict)
    for track, tg in tr.groupby(tr.Title.str.extract(r"_(T\d+)_")[0]):
        tg = tg.assign(n=tg.Panorama.str.extract(r"(\d+)\.jpg")[0].astype(int)).sort_values("n")
        P = tg[["Easting", "Northing"]].values
        dt = d[d.st.isin(set(tg.Title))]
        for cls, g in dt.groupby("cls"):
            g = g.reset_index(drop=True)
            if cls in LINEAR.values():
                for r in linear_runs(g, P):
                    ll = [list(to_ll(e, n)) for e, n in r.pop("coords")]
                    feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": ll},
                                  "properties": {"road": a.road, "track": track, "class": cls, **r}})
                summary[track][cls] = sum(1 for f in feats if f["properties"]["class"] == cls and f["properties"]["track"] == track)
                continue
            assets = triangulate(g, ground=cls in GROUND)
            for x in assets:
                off, dist = path_offset(x["E"], x["N"], P)
                lon, lat = to_ll(x.pop("E"), x.pop("N"))
                x.pop("rows")
                feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                              "properties": {"road": a.road, "track": track, "class": cls, "offset_ft": round(off, 1), **x}})
            summary[track][cls] = (len(g), len(assets))
    json.dump({"type": "FeatureCollection", "features": feats}, open(a.out, "w"))
    for t, s in summary.items():
        print(t, json.dumps(s))


if __name__ == "__main__":
    main()
