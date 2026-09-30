"""
Build the portal's own basemap, so the county map does not depend on a tile server.

Why not raster tiles
--------------------
The portal was drawing OpenStreetMap raster tiles. That fails in two ways: the tiles
carry Rockford, Beloit and Harvard at the same visual weight as Boone's own roads,
which buries the thing the page is actually about; and anywhere outbound requests are
blocked (a sandboxed embed, an air-gapped county office) the map renders as bare lines
on white with no error.

Everything here is real public GIS, shipped with the portal and drawn as vector layers
the map styles itself, so the county's own network stays the figure and the surroundings
stay ground.

Sources
-------
  county, places, water   Census TIGERweb (see scripts/fetch_boone_basemap.py)
  townships               Census TIGERweb County Subdivisions
  context roads           IDOT District 2 Roads, everything NOT JUR_TYPE 3

Geometry is simplified -- context roads hard, boundaries lightly -- because this is a
backdrop at county zoom, not a survey product. The county highway system itself is
never simplified; it ships at full precision in county_segments.geojson.

Output: public/data/basemap.json
"""
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw_data"
DATA = ROOT / "public" / "data"

COUNTY_JUR_CODE = "3"
# Douglas-Peucker tolerances in degrees. ~0.0002 is about 20 m. Minor roads are
# simplified harder than major ones: at county zoom they are texture, not routes.
MAJOR_ROAD_TOLERANCE = 0.0002
MINOR_ROAD_TOLERANCE = 0.0006
BOUNDARY_TOLERANCE = 0.0001
WATER_TOLERANCE = 0.0004
# The backdrop is clipped to the county plus a small margin, so roads visibly continue
# across the county line without dragging the whole Rockford conurbation onto the map --
# which reads heavier than Boone itself and buries the thing the page is about.
CLIP_MARGIN_DEG = 0.015  # ~1.5 km

# How far around Boone the neighbouring counties are carried. Without them the county
# reads as a white cut-out floating on a blank mat -- the boundary looks like the edge of
# the world rather than a line drawn across continuous landscape.
CONTEXT_MARGIN_DEG = 0.22
NEIGHBOUR_TOLERANCE = 0.002

# Roads that carry through traffic and orient the reader; everything else is texture.
MAJOR_CLASSES = {"Interstate", "Other Fwys & Expressways", "Other Principal Arterial", "Minor Arterial"}

# Who maintains what, from IDOT's JUR_TYPE. The county engineer answers for '3' only;
# the rest is shown so the county's network can be read in the context it sits in.
JURISDICTIONS = {
    "1": "State", "3": "County", "4": "Municipal",
    "7": "Other agency", "8": "Other agency", "9": "Township / road district",
}

# Synthetic condition by functional class, mean and spread -- the same distributions the
# asset model uses. Seeded per ROAD, never per record, so a road reads as one coherent
# run of colour instead of a quarter-mile confetti of independent draws.
SYNTHETIC_CONDITION = {
    "Interstate": (74, 10), "Other Fwys & Expressways": (73, 10),
    "Other Principal Arterial": (71, 12), "Minor Arterial": (67, 13),
    "Major Collector": (61, 14), "Minor Collector": (56, 15),
    "Local Road or Street": (52, 16),
}


def measured_condition(p):
    """IDOT's CRS (1-9) or IRI, expressed on the portal's shared 0-100 index."""
    crs, iri = p.get("CRS_WITH") or 0, p.get("IRI_WITH") or 0
    if crs <= 0 and iri <= 0:
        return None
    cond = ((crs - 1) / 8 * 100) if crs > 0 else (100 * (1 - (iri - 40) / 180))
    return round(max(0.0, min(100.0, cond)), 1)


def synthetic_condition(road_name, fc):
    """
    A fabricated stand-in for a road nobody has surveyed. Deterministic in the road's
    name, so the same road always draws the same value and the map is stable between
    builds -- and openly labelled as synthetic everywhere it is shown.
    """
    mean, sd = SYNTHETIC_CONDITION.get(fc, (58, 14))
    digest = hashlib.sha256(f"{road_name}|{fc}".encode()).digest()
    # Two bytes -> a roughly normal deviate in [-1, 1] without pulling in numpy.
    unit = (digest[0] + digest[1] + digest[2] - 382.5) / 382.5
    return round(max(18.0, min(92.0, mean + unit * sd)), 1)


def simplify(geom, tolerance):
    return mapping(shape(geom).simplify(tolerance, preserve_topology=True))


def load(name):
    path = RAW / name
    if not path.exists():
        print(f"  ! {name} missing -- layer omitted")
        return None
    return json.loads(path.read_text())


def feature(geometry, props):
    return {"type": "Feature", "geometry": geometry, "properties": props}


def clip_to(geom, boundary):
    """Trim a geometry to the clip boundary; returns None if nothing survives."""
    g = shape(geom)
    if boundary is None or boundary.contains(g):
        return geom
    if not g.intersects(boundary):
        return None
    clipped = g.intersection(boundary)
    return mapping(clipped) if not clipped.is_empty else None


def main():
    layers = {}

    county_src = load("boone_county.geojson")
    clip = None
    if county_src:
        clip = unary_union([shape(f["geometry"]) for f in county_src["features"]]).buffer(CLIP_MARGIN_DEG)

    # --- context roads: every road the county does NOT maintain ------------------
    roads = json.loads((RAW / "idot_boone_roads.geojson").read_text())
    context = []
    for f in roads["features"]:
        p = f["properties"]
        if str(p.get("JUR_TYPE") or "").strip() == COUNTY_JUR_CODE:
            continue
        trimmed = clip_to(f["geometry"], clip)
        if trimmed is None:
            continue
        fc = p.get("FC_NAME") or ""
        major = fc in MAJOR_CLASSES
        name = (p.get("ROAD_NAME") or "Unnamed").title()
        # Every road carries a condition so the whole county can be read at a glance:
        # a real IDOT reading where one exists, an openly synthetic stand-in where the
        # survey has not happened. `tier` is what the map must encode -- 366 miles of
        # township road sit at 1.4% real coverage, and that gap is the point.
        real = measured_condition(p)
        props = {
            "major": major,
            "name": name,
            "jurisdiction": JURISDICTIONS.get(str(p.get("JUR_TYPE") or "").strip(), "Other agency"),
            "condition": real if real is not None else synthetic_condition(name, fc),
            "tier": "measured" if real is not None else "synthetic",
        }
        context.append(feature(
            simplify(trimmed, MAJOR_ROAD_TOLERANCE if major else MINOR_ROAD_TOLERANCE),
            props,
        ))
    layers["roads"] = {"type": "FeatureCollection", "features": context}
    n_major = sum(1 for f in context if f["properties"]["major"])
    n_measured = sum(1 for f in context if f["properties"]["tier"] == "measured")
    print(f"  roads: {len(context)} context roads ({n_major} major), "
          f"{n_measured} with a real reading, {len(context) - n_measured} synthetic")
    per_jur = defaultdict(lambda: [0, 0])
    for f in context:
        j = f["properties"]["jurisdiction"]
        per_jur[j][0] += 1
        per_jur[j][1] += f["properties"]["tier"] == "measured"
    for j, (n, m) in sorted(per_jur.items(), key=lambda kv: -kv[1][0]):
        print(f"      {j:26s} {m:4d} of {n:4d} measured ({100 * m / n:4.1f}%)")

    # --- the outside-the-county mask ----------------------------------------------
    # A heavy stroke around a rectangular county reads as a picture frame rather than a
    # jurisdiction -- the boundary IS a rectangle, so outlining it draws a box. Every
    # professional study-area map solves this the other way round: knock back everything
    # outside the area and let the boundary emerge at the edge of the mask.
    if county_src:
        boone = unary_union([shape(f["geometry"]) for f in county_src["features"]])
        outer = box(*boone.buffer(3.0).bounds)  # well past any view the portal allows
        holes = [list(p.exterior.coords) for p in
                 (boone.geoms if boone.geom_type == "MultiPolygon" else [boone])]
        layers["mask"] = {"type": "FeatureCollection", "features": [{
            "type": "Feature",
            "geometry": {"type": "Polygon",
                         "coordinates": [list(outer.exterior.coords)] + holes},
            "properties": {},
        }]}
        print("  mask: 1 polygon (everything outside Boone)")

    # --- neighbouring counties ----------------------------------------------------
    neighbours = load("boone_neighbours.geojson")
    if neighbours and county_src:
        window = box(*unary_union([shape(f["geometry"]) for f in county_src["features"]])
                     .buffer(CONTEXT_MARGIN_DEG).bounds)
        feats, lines = [], []
        for f in neighbours["features"]:
            name = (f["properties"].get("NAME") or "").replace(" County", "")
            if name == "Boone":
                continue  # drawn separately, as the subject
            whole = shape(f["geometry"])
            g = whole.intersection(window)
            if g.is_empty:
                continue
            props = {"name": name, "state": f["properties"].get("STATE")}
            feats.append(feature(mapping(g.simplify(NEIGHBOUR_TOLERANCE, preserve_topology=True)), props))
            # The OUTLINE comes from the county's real boundary clipped to the window,
            # never from the clipped polygon's exterior. Cutting a polygon with a box
            # adds the box's own edges to that exterior -- about half a degree of them
            # per county -- and stroking those draws a large false rectangle around
            # Boone that looks like a county line and is not one.
            edge = whole.boundary.intersection(window)
            if not edge.is_empty:
                lines.append(feature(mapping(edge.simplify(NEIGHBOUR_TOLERANCE, preserve_topology=True)), props))
        layers["neighbours"] = {"type": "FeatureCollection", "features": feats}
        layers["neighbour_lines"] = {"type": "FeatureCollection", "features": lines}
        print(f"  neighbours: {len(feats)} counties -- "
              + ", ".join(sorted(f["properties"]["name"] for f in feats)))

    # --- boundaries and water ----------------------------------------------------
    for key, filename, tol, keep in (
        ("county", "boone_county.geojson", BOUNDARY_TOLERANCE, ("NAME",)),
        ("townships", "boone_townships.geojson", BOUNDARY_TOLERANCE, ("NAME",)),
        ("places", "boone_places.geojson", BOUNDARY_TOLERANCE, ("NAME",)),
        ("water_area", "boone_water_area.geojson", WATER_TOLERANCE, ("NAME",)),
        ("water_line", "boone_water_line.geojson", WATER_TOLERANCE, ("NAME",)),
    ):
        src = load(filename)
        if not src:
            continue
        feats = []
        for f in src["features"]:
            if not f.get("geometry"):
                continue
            # The county layer defines the clip, so it is never clipped by itself.
            geometry = f["geometry"] if key == "county" else clip_to(f["geometry"], clip)
            if geometry is None:
                continue
            props = {k.lower(): f["properties"].get(k) for k in keep}
            # TIGER suffixes every name with its legal class. The portal says
            # "Spring" and "Belvidere", not "Spring township" and "Belvidere city".
            if props.get("name"):
                name = props["name"]
                for suffix in (" township", " city", " village", " town", " CDP"):
                    if name.endswith(suffix):
                        name = name[: -len(suffix)]
                props["name"] = name.strip()
            feats.append(feature(simplify(geometry, tol), props))
        layers[key] = {"type": "FeatureCollection", "features": feats}
        names = [f["properties"].get("name") for f in feats if f["properties"].get("name")]
        print(f"  {key}: {len(feats)} features"
              + (f" -- {', '.join(sorted(set(names))[:8])}" if names and len(names) <= 20 else ""))

    # --- label anchors -----------------------------------------------------------
    # MapLibre's own text rendering needs a glyph server, which is exactly the outbound
    # dependency this basemap exists to avoid. So ship anchor points and let the page
    # draw the labels as HTML over the canvas.
    labels = []
    for key, kind in (("townships", "township"), ("places", "place"), ("neighbours", "county")):
        for f in layers.get(key, {}).get("features", []):
            name = f["properties"].get("name")
            if not name:
                continue
            g = shape(f["geometry"])
            pt = g.representative_point()
            labels.append({"name": name if kind != "county" else f"{name} Co.",
                           "kind": kind,
                           "lon": round(pt.x, 5), "lat": round(pt.y, 5),
                           "area": round(g.area * 1e4, 2)})
    layers["labels"] = labels
    print(f"  labels: {len(labels)} anchors")

    out = DATA / "basemap.json"
    out.write_text(json.dumps(layers))
    print(f"\nbasemap.json: {len(layers)} layers, {out.stat().st_size / 1000:.0f} KB")


if __name__ == "__main__":
    main()
