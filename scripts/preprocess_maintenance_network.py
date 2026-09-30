"""
Build the county-wide maintenance road-segment network for the ARIA maintenance
heatmap: reconcile the real GarP_T1 pilot corridor with the real IDOT Boone County
centerlines (avoiding duplicate geometry where they overlap), assign each segment to
a real township zone, and spatial-join existing point assets (signs) to their
nearest segment.

Inputs:
  raw_data/idot_boone_roads.geojson   (from fetch_idot_centerlines.py)
  raw_data/boone_townships.geojson    (from fetch_idot_centerlines.py)
  public/data/route.geojson           (GarP_T1 real pilot corridor, from preprocess_garp_t1.py)
  public/data/signs.geojson           (real sign detections, from preprocess_garp_t1.py)

Outputs:
  public/data/maintenance_segments.geojson  one LineString per road segment, with
    segment_id, road_name, functional_class, aadt, township/zone_id, and a
    pavement_condition sub-object tagged source: 'real' (IRI_WITH/CRS_WITH present
    and nonzero) or 'synthetic_placeholder' (fallback -- most local roads have no
    real IRI/CRS on file, matching the exact data gap ARIA's pitch deck is built
    around).
  public/data/maintenance_zones.geojson     one Polygon per township, real geometry.
  public/data/signs_with_segment.geojson    signs.geojson + a stamped segment_id
    (join done once here rather than client-side).
"""
import json
import random
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import shape, mapping, LineString
from shapely.ops import transform as shp_transform

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw_data"
DATA = ROOT / "public" / "data"

GARP_BUFFER_FT = 100  # exclude IDOT centerline points this close to the real GarP_T1 route
RNG_SEED = 42

to_wgs84 = Transformer.from_crs("EPSG:3435", "EPSG:4326", always_xy=True)
to_statefeet = Transformer.from_crs("EPSG:4326", "EPSG:3435", always_xy=True)


def load_geojson(path):
    with open(path) as f:
        return json.load(f)


def build_zones():
    townships = load_geojson(RAW / "boone_townships.geojson")
    features = []
    for feat in townships["features"]:
        name = feat["properties"]["NAME"]
        zone_id = name.lower().replace(" township", "").replace(" ", "_")
        features.append({
            "type": "Feature",
            "geometry": feat["geometry"],
            "properties": {
                "zone_id": zone_id,
                "name": name,
                "source": "real",
                "source_detail": "US Census TIGERweb County Subdivisions, Boone County IL",
            },
        })
    out = {"type": "FeatureCollection", "features": features}
    with open(DATA / "maintenance_zones.geojson", "w") as f:
        json.dump(out, f)
    print(f"maintenance_zones.geojson: {len(features)} zones")
    return features


def point_in_which_zone(lon, lat, zone_features):
    from shapely.geometry import Point
    pt = Point(lon, lat)
    for zf in zone_features:
        if shape(zf["geometry"]).contains(pt):
            return zf["properties"]["zone_id"]
    # fall back to nearest zone centroid if a point sits just outside all polygons
    # (edge-of-county slivers, projection rounding)
    best, best_d = None, float("inf")
    for zf in zone_features:
        d = shape(zf["geometry"]).centroid.distance(pt)
        if d < best_d:
            best, best_d = zf["properties"]["zone_id"], d
    return best


def build_county_segments(zone_features, garp_route_line_ft):
    roads = load_geojson(RAW / "idot_boone_roads.geojson")
    garp_buffer = garp_route_line_ft.buffer(GARP_BUFFER_FT)

    features = []
    excluded = 0
    for feat in roads["features"]:
        geom = shape(feat["geometry"])
        geom_ft = shp_transform(lambda x, y: to_statefeet.transform(x, y), geom)
        if geom_ft.intersects(garp_buffer):
            excluded += 1
            continue  # GarP_T1's own real corridor is authoritative for this stretch

        p = feat["properties"]
        iri = p.get("IRI_WITH") or 0
        crs = p.get("CRS_WITH") or 0
        has_real_condition = iri > 0 or crs > 0

        mid = geom.interpolate(0.5, normalized=True)
        zone_id = point_in_which_zone(mid.x, mid.y, zone_features)

        features.append({
            "type": "Feature",
            "geometry": feat["geometry"],
            "properties": {
                "segment_id": f"boone_{p['OBJECTID']}",
                "road_name": (p.get("ROAD_NAME") or "").strip(),
                "functional_class": p.get("FC_NAME"),
                "aadt": p.get("AADT"),
                "aadt_year": p.get("AADT_YR"),
                "speed_limit": p.get("SP_LIM"),
                "lanes": p.get("LNS"),
                "township": (p.get("TOWNSHIP_N") or "").strip(),
                "zone_id": zone_id,
                "seg_length_mi": p.get("SEG_LENGTH"),
                "pavement_condition": {
                    "iri": iri if has_real_condition else None,
                    "crs": crs if has_real_condition else None,
                    "source": "real" if has_real_condition else "synthetic_placeholder",
                },
                "source": "real",
                "source_detail": "IDOT District 2 Roads (2017 IRIS extract), gis-idot.opendata.arcgis.com",
            },
        })
    print(f"county segments: {len(features)} kept, {excluded} excluded as GarP_T1 overlap")
    return features


def build_garp_segments(zone_features):
    """Chunk the real GarP_T1 corridor into segments matching the county granularity."""
    route = load_geojson(DATA / "route.geojson")
    line = next(f for f in route["features"] if f["geometry"]["type"] == "LineString")
    coords = line["geometry"]["coordinates"]

    chunk = 20  # matches the granularity used for the original pavement_synthetic.geojson
    features = []
    for i in range(0, len(coords) - 1, chunk):
        seg_coords = coords[i:i + chunk + 1]
        if len(seg_coords) < 2:
            continue
        mid = seg_coords[len(seg_coords) // 2]
        zone_id = point_in_which_zone(mid[0], mid[1], zone_features)
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": seg_coords},
            "properties": {
                "segment_id": f"garp_t1_seg{i // chunk:03d}",
                "road_name": "GARDEN PRAIRIE RD",
                "functional_class": "Minor Collector",
                "aadt": None,
                "aadt_year": None,
                "speed_limit": None,
                "lanes": None,
                "township": None,
                "zone_id": zone_id,
                "seg_length_mi": None,
                "pavement_condition": {"iri": None, "crs": None, "source": "synthetic_placeholder"},
                "source": "real",
                "source_detail": "RuralBench/CV-Code pilot corridor (real vehicle trajectory)",
            },
        })
    print(f"GarP_T1 segments: {len(features)}")
    return features


def stamp_signs_with_segment(garp_segments):
    signs = load_geojson(DATA / "signs.geojson")
    seg_lines = [(f["properties"]["segment_id"], shape(f["geometry"])) for f in garp_segments]

    for feat in signs["features"]:
        pt = shape(feat["geometry"])
        best_id, best_d = None, float("inf")
        for seg_id, line in seg_lines:
            d = line.distance(pt)
            if d < best_d:
                best_id, best_d = seg_id, d
        feat["properties"]["segment_id"] = best_id

    with open(DATA / "signs_with_segment.geojson", "w") as f:
        json.dump(signs, f)
    print(f"signs_with_segment.geojson: {len(signs['features'])} signs joined to segments")


def main():
    zone_features = build_zones()

    route = load_geojson(DATA / "route.geojson")
    garp_line_wgs = next(f for f in route["features"] if f["geometry"]["type"] == "LineString")
    garp_line_ft = shp_transform(
        lambda x, y: to_statefeet.transform(x, y), shape(garp_line_wgs["geometry"])
    )

    county_segments = build_county_segments(zone_features, garp_line_ft)
    garp_segments = build_garp_segments(zone_features)
    all_segments = county_segments + garp_segments

    out = {"type": "FeatureCollection", "features": all_segments}
    with open(DATA / "maintenance_segments.geojson", "w") as f:
        json.dump(out, f)
    print(f"maintenance_segments.geojson: {len(all_segments)} total segments")

    stamp_signs_with_segment(garp_segments)


if __name__ == "__main__":
    main()
