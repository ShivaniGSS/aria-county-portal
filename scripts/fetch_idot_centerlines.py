"""
Fetch real public GIS data for Boone County, IL: road centerlines (IDOT) and
township boundaries (Census TIGERweb) -- the two real spatial layers the
maintenance network is built on.

Roads: IDOT District 2 Roads (2017 IRIS extract), a standard Esri FeatureServer on
gis-idot.opendata.arcgis.com. Boone County sits in IDOT District 2. Each record is
already a natural LRS segment (IDOT's own inventory breaks roads at intersections/
mile-fractions, typically 0.05-0.5 mi) -- no custom chunking needed. Confirmed via
direct query 2026-09-17: COUNTY_NAM='BOONE' returns 3,295 records. Useful fields:
ROAD_NAME, FC_NAME (functional class), AADT, IRI_WITH/CRS_WITH (pavement condition
-- mostly 0/unmeasured on local roads, real where present), SP_LIM (speed limit),
LNS (lane count), TOWNSHIP_N (real township), JUR_TYPE/MAINT_TYPE (jurisdiction/
maintenance codes -- kept as opaque codes, not decoded, since the code-value legend
isn't in the public field metadata).

Townships: Census TIGERweb County Subdivisions layer, STATE='17' COUNTY='007'
(Boone County FIPS, confirmed 2026-09-17) -- these are the real, named jurisdictional
polygons used as the maintenance-zone unit (matches TOWNSHIP_N on the road layer
1:1: Belvidere, Bonus, Boone, Caledonia, Flora, LeRoy, Manchester, Poplar Grove,
Spring).

Output: raw_data/idot_boone_roads.geojson, raw_data/boone_townships.geojson
(gitignored -- cached pulls of public data, not source code; re-run to refresh).
"""
import json
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlencode

FEATURE_SERVER = "https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/D2_Roads_2017/FeatureServer/0/query"
TIGERWEB_COUSUB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/22/query"
OUT = Path(__file__).resolve().parent.parent / "raw_data" / "idot_boone_roads.geojson"
OUT_TOWNSHIPS = Path(__file__).resolve().parent.parent / "raw_data" / "boone_townships.geojson"

FIELDS = [
    "OBJECTID", "ROAD_NAME", "FC_NAME", "AADT", "AADT_YR", "IRI_WITH", "CRS_WITH",
    "SP_LIM", "LNS", "SURF_TYP", "SURF_YR", "TOWNSHIP_N", "JUR_TYPE", "MAINT_TYPE",
    "KEY_RT_NBR", "SEG_LENGTH", "HCV",
]


def fetch():
    all_features = []
    offset = 0
    page_size = 2000
    while True:
        params = {
            "where": "COUNTY_NAM='BOONE'",
            "outFields": ",".join(FIELDS),
            "outSR": "4326",
            "resultOffset": offset,
            "resultRecordCount": page_size,
            "f": "geojson",
        }
        url = f"{FEATURE_SERVER}?{urlencode(params)}"
        with urlopen(url, timeout=60) as resp:
            page = json.load(resp)
        feats = page.get("features", [])
        all_features.extend(feats)
        print(f"  fetched page at offset {offset}: {len(feats)} features")
        if len(feats) < page_size:
            break
        offset += page_size

    data = {"type": "FeatureCollection", "features": all_features}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f)

    n = len(all_features)
    print(f"fetched {n} Boone County road segments -> {OUT}")
    if n == 0:
        raise SystemExit("expected >0 features -- check the query/service is still valid")


def fetch_townships():
    params = {
        "where": "STATE='17' AND COUNTY='007'",
        "outFields": "NAME,COUSUB,FUNCSTAT",
        "outSR": "4326",
        "f": "geojson",
    }
    url = f"{TIGERWEB_COUSUB}?{urlencode(params)}"
    with urlopen(url, timeout=60) as resp:
        data = json.load(resp)

    OUT_TOWNSHIPS.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_TOWNSHIPS, "w") as f:
        json.dump(data, f)

    n = len(data.get("features", []))
    print(f"fetched {n} Boone County townships -> {OUT_TOWNSHIPS}")
    if n != 9:
        print(f"  WARNING: expected 9 townships, got {n} -- verify before proceeding")


if __name__ == "__main__":
    fetch()
    fetch_townships()
