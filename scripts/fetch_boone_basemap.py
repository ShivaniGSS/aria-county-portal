"""
Fetch the real public GIS layers Boone County, IL needs to draw its OWN basemap --
county outline, municipalities, and water -- so the portal never calls an external
tile server.

All four layers come from Census TIGERweb (the same source as the township polygons
in fetch_idot_centerlines.py). Service/layer ids were DISCOVERED against the REST
API, not guessed (listed .../TIGERweb?f=json, then each MapServer's /layers?f=json,
then each candidate layer's ?f=json field list); confirmed 2026-09-24:

County   tigerWMS_Current/MapServer/82 "Counties" -- has STATE/COUNTY, so the plain
         attribute filter STATE='17' AND COUNTY='007' works (1 polygon, "Boone
         County"). Layer 82 is the largest-scale (least generalized) Counties layer
         in that service; State_County/MapServer/1 is the same geometry.

Places   tigerWMS_Current/MapServer/28 "Incorporated Places" + /30 "Census
         Designated Places". These carry STATE and PLACE but NO county field, so
         county membership needs a SPATIAL filter. A plain envelope over the Boone
         bounding box is too loose -- it also caught Harvard, Marengo and Union,
         which are in McHenry County -- so the Boone polygon fetched above is
         POSTed back as an esriGeometryPolygon intersects filter instead. Belvidere,
         Poplar Grove, Capron, Caledonia and Timberlane are incorporated; Garden
         Prairie, Candlewick Lake and Argyle are unincorporated CDPs, hence both
         layers. The merged output tags each feature with PLACE_KIND
         ("incorporated"/"cdp") -- the one derived field here, so the renderer can
         style real municipalities differently from statistical places.

Water    Hydro/MapServer/1 "Areal Hydrography" (lakes/ponds/river polygons) and
         Hydro/MapServer/0 "Linear Hydrography" (creeks/rivers as lines). Neither
         layer has any state/county/GEOID field at all -- hydrography is not a
         jurisdictional geography -- so these are spatial-filter-only, same POSTed
         Boone polygon. Named features include Kishwaukee Riv (+ its North Br),
         Mosquito Crk, Piscasaw Crk, Coon Crk, Beaver Crk, Kinnikinnick Crk;
         most small farm ponds and ditches are unnamed (NAME=null), which is normal
         for TIGER hydro and fine for a basemap. TIGER is inconsistent about
         abbreviating those names -- both "N Kinnikinnick Crk" and "North
         Kinnikinnick Crk" appear, as do "Gervune"/"Geryune" Crk -- so don't group
         stream segments on NAME equality without normalizing first.

Requests are POSTed rather than GET'd where the filter is a polygon -- the Boone
ring is ~25KB of JSON, past what a query string can carry.

Output: raw_data/boone_county.geojson, raw_data/boone_places.geojson,
raw_data/boone_water_area.geojson, raw_data/boone_water_line.geojson (gitignored --
cached pulls of public data, not source code; re-run to refresh).
"""
import json
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.parse import urlencode

TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
COUNTIES = f"{TIGERWEB}/tigerWMS_Current/MapServer/82/query"
INC_PLACES = f"{TIGERWEB}/tigerWMS_Current/MapServer/28/query"
CDPS = f"{TIGERWEB}/tigerWMS_Current/MapServer/30/query"
WATER_AREA = f"{TIGERWEB}/Hydro/MapServer/1/query"
WATER_LINE = f"{TIGERWEB}/Hydro/MapServer/0/query"

RAW = Path(__file__).resolve().parent.parent / "raw_data"
OUT_COUNTY = RAW / "boone_county.geojson"
OUT_PLACES = RAW / "boone_places.geojson"
OUT_WATER_AREA = RAW / "boone_water_area.geojson"
OUT_WATER_LINE = RAW / "boone_water_line.geojson"

STATE_FIPS = "17"
COUNTY_FIPS = "007"

# Boone County, IL -- sanity bounds only (min_lon, min_lat, max_lon, max_lat). Not a
# query filter: every fetch is either attribute- or polygon-filtered. Used to assert
# the geometry we got back is actually where Boone County is. The county's true
# extent measured 2026-09-24 is lon -88.9410..-88.7054, lat 42.1523..42.4950, i.e. it
# does not reach the nominal -88.55 eastern edge and overshoots the western one by
# ~0.001 deg, hence BBOX_TOL.
BOONE_BBOX = (-88.94, 42.15, -88.55, 42.50)
BBOX_TOL = 0.01

PLACE_FIELDS = "OBJECTID,GEOID,NAME,BASENAME,STATE,PLACE,LSADC,FUNCSTAT,AREALAND,AREAWATER"
WATER_FIELDS = "OBJECTID,OID,NAME,BASENAME,MTFCC"

PAGE_SIZE = 1000


def _query(url, params, geometry=None):
    """One page of an ArcGIS query. POSTs when a polygon filter is attached."""
    params = dict(params)
    if geometry is not None:
        params.update({
            "geometry": json.dumps(geometry),
            "geometryType": "esriGeometryPolygon",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
        })
        req = Request(url, data=urlencode(params).encode())
    else:
        req = Request(f"{url}?{urlencode(params)}")
    with urlopen(req, timeout=180) as resp:
        return json.load(resp)


def fetch_paged(url, where, out_fields, geometry=None, f="geojson"):
    """Page through a layer with resultOffset until it stops filling a page.

    orderByFields pins the sort: resultOffset against an unordered result can
    duplicate or skip rows between pages. Every layer here reports
    advancedQueryCapabilities.supportsPagination, and none of them currently
    exceeds one page at PAGE_SIZE, but the loop is what keeps that from mattering.
    """
    all_features = []
    offset = 0
    while True:
        page = _query(url, {
            "where": where,
            "outFields": out_fields,
            "outSR": "4326",
            "orderByFields": "OBJECTID",
            "resultOffset": offset,
            "resultRecordCount": PAGE_SIZE,
            "f": f,
        }, geometry=geometry)
        if "error" in page:
            raise SystemExit(f"ArcGIS error from {url}: {page['error']}")
        feats = page.get("features", [])
        all_features.extend(feats)
        print(f"  fetched page at offset {offset}: {len(feats)} features")
        if len(feats) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return all_features


def _coords(geom):
    """Every [lon, lat] pair in a GeoJSON geometry, at any nesting depth."""
    def walk(node):
        if isinstance(node, (list, tuple)):
            if len(node) >= 2 and all(isinstance(v, (int, float)) for v in node[:2]):
                yield node[0], node[1]
            else:
                for child in node:
                    yield from walk(child)
    return walk((geom or {}).get("coordinates", []))


def _in_bbox(lon, lat):
    min_lon, min_lat, max_lon, max_lat = BOONE_BBOX
    return (min_lon - BBOX_TOL <= lon <= max_lon + BBOX_TOL
            and min_lat - BBOX_TOL <= lat <= max_lat + BBOX_TOL)


def write_geojson(features, out, label, expect_min=1, all_inside=False):
    """Write a FeatureCollection and check it is non-empty and lands in Boone.

    Every feature must have at least one vertex inside the Boone bounding box --
    that is what makes the spatial filter verifiable. Features may extend past the
    box (Rockford and Loves Park only clip Boone's western edge; creeks run on into
    Winnebago and McHenry), so a vertex outside is not by itself a problem. Pass
    all_inside=True for the county polygon, which must fit entirely.
    """
    if not features:
        raise SystemExit(
            f"{label}: 0 features returned -- NOT writing {out.name}. "
            "Check the service/layer is still valid before trusting anything downstream."
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)

    lons, lats, missed, outside = [], [], 0, 0
    for feat in features:
        pts = list(_coords(feat.get("geometry")))
        if not pts:
            raise SystemExit(f"{label}: a feature has no coordinates -- {out.name} is unusable")
        hits = 0
        for lon, lat in pts:
            lons.append(lon)
            lats.append(lat)
            if _in_bbox(lon, lat):
                hits += 1
            else:
                outside += 1
        if hits == 0:
            missed += 1

    size_kb = out.stat().st_size / 1024
    print(f"fetched {len(features)} {label} -> {out} ({size_kb:.0f} KB)")
    print(f"  bounds lon {min(lons):.4f}..{max(lons):.4f}  lat {min(lats):.4f}..{max(lats):.4f}"
          f"  ({len(lons)} vertices, {outside} outside the Boone bbox)")
    if missed:
        print(f"  WARNING: {missed} of {len(features)} {label} have NO vertex inside the Boone "
              "bounding box -- the spatial filter may be wrong; verify before proceeding")
    if all_inside and outside:
        print(f"  WARNING: {outside} of {len(lons)} vertices fall outside the Boone bounding "
              "box, but this layer should fit entirely inside it -- verify before proceeding")
    if len(features) < expect_min:
        print(f"  WARNING: expected at least {expect_min} {label}, got {len(features)} "
              "-- verify before proceeding")


def _names(features, kind_key=None):
    """NAME values for the printed summary, in a stable order."""
    out = []
    for feat in features:
        props = feat.get("properties", {}) or {}
        name = props.get("NAME") or "(unnamed)"
        if kind_key and props.get(kind_key):
            name = f"{name} [{props[kind_key]}]"
        out.append(name)
    return sorted(out)


def fetch_county():
    """Boone County outline. Attribute filter -- this layer does have STATE/COUNTY."""
    where = f"STATE='{STATE_FIPS}' AND COUNTY='{COUNTY_FIPS}'"
    feats = fetch_paged(COUNTIES, where,
                        "OBJECTID,GEOID,NAME,BASENAME,STATE,COUNTY,AREALAND,AREAWATER")
    write_geojson(feats, OUT_COUNTY, "Boone County boundary polygon", all_inside=True)
    print(f"  NAME: {', '.join(_names(feats))}")
    if len(feats) != 1:
        print(f"  WARNING: expected exactly 1 county polygon, got {len(feats)}")
    return feats


def county_filter_geometry(county_features):
    """The Boone polygon, as an Esri geometry to POST as a spatial filter."""
    rings = []
    for feat in county_features:
        geom = feat.get("geometry") or {}
        if geom.get("type") == "Polygon":
            rings.extend(geom["coordinates"])
        elif geom.get("type") == "MultiPolygon":
            for poly in geom["coordinates"]:
                rings.extend(poly)
    if not rings:
        raise SystemExit("county polygon has no rings -- cannot build the spatial filter")
    return {"rings": rings, "spatialReference": {"wkid": 4326}}


def fetch_places(boone):
    """Municipalities + CDPs that intersect Boone. No county field -> spatial filter."""
    where = f"STATE='{STATE_FIPS}'"
    feats = []
    for url, kind in ((INC_PLACES, "incorporated"), (CDPS, "cdp")):
        page = fetch_paged(url, where, PLACE_FIELDS, geometry=boone)
        for feat in page:
            feat.setdefault("properties", {})["PLACE_KIND"] = kind
        feats.extend(page)
    write_geojson(feats, OUT_PLACES, "Boone-intersecting places", expect_min=5)
    print(f"  NAMEs: {', '.join(_names(feats, kind_key='PLACE_KIND'))}")


def fetch_water(boone):
    """Area + linear hydrography clipped to Boone by the same polygon filter."""
    area = fetch_paged(WATER_AREA, "1=1", WATER_FIELDS, geometry=boone)
    write_geojson(area, OUT_WATER_AREA, "Boone area hydrography features", expect_min=10)
    named_area = sorted({(f.get("properties") or {}).get("NAME") for f in area} - {None, ""})
    print(f"  named waterbodies ({len(named_area)}): {', '.join(named_area)}")

    line = fetch_paged(WATER_LINE, "1=1", WATER_FIELDS, geometry=boone)
    write_geojson(line, OUT_WATER_LINE, "Boone linear hydrography features", expect_min=10)
    named_line = sorted({(f.get("properties") or {}).get("NAME") for f in line} - {None, ""})
    print(f"  named streams ({len(named_line)}): {', '.join(named_line)}")


if __name__ == "__main__":
    county = fetch_county()
    boone = county_filter_geometry(county)
    fetch_places(boone)
    fetch_water(boone)
