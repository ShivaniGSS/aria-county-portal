"""
Build the county planning segments -- the unit the portal is organised around.

Scope
-----
The county engineer manages the COUNTY HIGHWAY system, not every road in the county.
In IDOT's Boone extract that is JUR_TYPE '3': 93.3 miles across 207 inventory records.
That matches the "100 centerline miles" figure in ARIA's own pitch deck, and both
surveyed pilot corridors sit inside it. JUR_TYPE 9 (366 mi, township/road district)
and JUR_TYPE 4 (199 mi, municipal streets) are somebody else's to maintain.

Segmentation
------------
IDOT's native records average a quarter mile -- far too fine to plan against. Grouping
them by ROAD_NAME instead is also wrong: the county system is a connected NETWORK, not
a list of roads. Name-grouping splits a corridor wherever the name changes mid-run
(Stone Quarry becomes S. Appleton), and leaves 0.1-mile orphans that are really the tail
of a five-mile corridor.

So this works on the graph:

  1. Every inventory record is an edge between its two endpoints, snapped to a grid.
  2. Maximal CHAINS are walked through degree-2 nodes, breaking only at dead ends and
     junctions. A chain is a contiguous run you could drive without turning off --
     exactly how a county engineer scopes a job. Boone has 26 of them.
  3. Chains shorter than MIN_SEGMENT_MILES are merged into a neighbour at a shared
     junction, preferring one that carries the same road name.
  4. Chains longer than MAX_SEGMENT_MILES are cut into equal runs at record boundaries.

Breaks therefore land at real intersections rather than at arbitrary mileage, and each
segment is named for the cross-roads it runs between.

Output: public/data/county_segments.geojson
"""
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw_data" / "idot_boone_roads.geojson"
DATA = ROOT / "public" / "data"

COUNTY_JUR_CODE = "3"
TARGET_SEGMENT_MILES = 6.0
MIN_SEGMENT_MILES = 4.0
MAX_SEGMENT_MILES = 8.0

# Endpoints within this distance are treated as the same intersection. IDOT's records
# do not share exact vertices where they meet -- gaps of a few metres are routine -- and
# rounding to a grid leaves those joins broken, stranding real corridors as orphan stubs.
NODE_TOLERANCE_DEG = 0.00025  # ~25 m at this latitude
# How close another road must pass to an endpoint to be named as the cross street.
CROSS_STREET_TOLERANCE_DEG = 0.0006  # ~65 m at this latitude


def normalise_road_name(name: str) -> str:
    """
    IDOT's ROAD_NAME is free text and inconsistent: 'ANGLING RD' vs 'ANGLING ROAD',
    'GRANGE HALL RD' vs 'GRANGE HALL RD.', and truncations like 'CHERRY VALLEY R'.
    """
    n = " ".join((name or "").upper().split()).rstrip(".")
    for long, short in ((" ROAD", " RD"), (" STREET", " ST"), (" AVENUE", " AVE")):
        if n.endswith(long):
            n = n[: -len(long)] + short
    if n.endswith(" R"):  # truncated "RD" in the source
        n += "D"
    return n


def canonicalise(names):
    """
    Fold a name that is a prefix of a longer one into that longer name, so IDOT's
    truncated 'CHERRY VALLEY' and its full 'CHERRY VALLEY RD' are one road rather
    than two, and don't produce two separately-named segments of the same corridor.
    """
    ordered = sorted(names, key=len, reverse=True)
    return {n: next((c for c in ordered if c != n and c.startswith(n)), n) for n in names}


def title_case(name: str) -> str:
    """'GARDEN PRAIRIE RD' -> 'Garden Prairie Rd', leaving 'US 20' and 'IL 76' alone."""
    out = []
    for w in name.split():
        out.append(w if (w.isdigit() or (len(w) <= 3 and not w.isalpha()) or w in {"US", "IL", "N", "S", "E", "W"}) else w.capitalize())
    return " ".join(out)


class NodeIndex:
    """Clusters endpoints that are within NODE_TOLERANCE_DEG into one shared node id."""

    def __init__(self):
        self.cells = defaultdict(list)  # coarse grid cell -> [(lon, lat, node_id)]
        self.coords = {}                # node id -> the coordinate it stands for
        self.count = 0

    def id_for(self, coord):
        lon, lat = coord[0], coord[1]
        cell = (round(lon, 3), round(lat, 3))
        for dx in (-0.001, 0.0, 0.001):
            for dy in (-0.001, 0.0, 0.001):
                for nlon, nlat, nid in self.cells.get((round(cell[0] + dx, 3), round(cell[1] + dy, 3)), ()):
                    if math.hypot(nlon - lon, nlat - lat) <= NODE_TOLERANCE_DEG:
                        return nid
        self.count += 1
        nid = self.count
        self.cells[cell].append((lon, lat, nid))
        self.coords[nid] = (lon, lat)
        return nid


def coords_of(feature):
    g = feature["geometry"]
    parts = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
    return [c for part in parts for c in part]


def miles_of(props) -> float:
    return float(props.get("SEG_LENGTH") or 0)


# --------------------------------------------------------------------- the graph

def build_chains(records):
    """
    Decompose the network into maximal chains: runs of records joined end to end
    through degree-2 nodes, breaking at dead ends and junctions.
    """
    nodes = NodeIndex()
    ends = []
    for f in records:
        cs = coords_of(f)
        ends.append((nodes.id_for(cs[0]), nodes.id_for(cs[-1])))

    adjacency = defaultdict(list)
    for i, (a, b) in enumerate(ends):
        adjacency[a].append(i)
        adjacency[b].append(i)
    degree = {n: len(v) for n, v in adjacency.items()}

    used = set()

    def walk(start_node, first_edge):
        """Returns the ordered edges and the ordered nodes they pass through."""
        order, path, node, edge = [], [start_node], start_node, first_edge
        while True:
            used.add(edge)
            order.append(edge)
            a, b = ends[edge]
            node = b if a == node else a
            path.append(node)
            if degree.get(node, 0) != 2:
                break
            nxt = [e for e in adjacency[node] if e not in used]
            if not nxt:
                break
            edge = nxt[0]
        return order, path

    chains = []
    # Start every chain at a node that is not a simple pass-through, so chains are
    # maximal and their ends land on junctions or dead ends.
    for node in [n for n, d in degree.items() if d != 2]:
        for edge in adjacency[node]:
            if edge in used:
                continue
            order, path = walk(node, edge)
            chains.append({"edges": order, "path": path, "ends": (path[0], path[-1])})
    # Anything left is a closed loop with no junction to start from.
    for edge in range(len(records)):
        if edge not in used:
            order, path = walk(ends[edge][0], edge)
            chains.append({"edges": order, "path": path, "ends": (path[0], path[-1])})

    for ch in chains:
        ch["miles"] = sum(miles_of(records[i]["properties"]) for i in ch["edges"])
    return chains, nodes.coords


def merge_short_chains(chains, records):
    """
    Fold every chain below MIN_SEGMENT_MILES into a neighbour it actually touches,
    preferring one carrying the same road name, so a 0.9-mile stub of Hunter Rd joins
    the rest of Hunter Rd instead of becoming its own "planning segment".
    """
    def dominant(ch):
        names = Counter()
        for i in ch["edges"]:
            names[normalise_road_name(records[i]["properties"].get("ROAD_NAME") or "")] += \
                miles_of(records[i]["properties"])
        return names.most_common(1)[0][0] if names else ""

    chains = [dict(ch) for ch in chains]
    changed = True
    while changed:
        changed = False
        chains.sort(key=lambda c: c["miles"])
        for ch in chains:
            if ch["miles"] >= MIN_SEGMENT_MILES:
                break
            neighbours = [o for o in chains if o is not ch and set(o["ends"]) & set(ch["ends"])]
            # A stub of the SAME road is part of that corridor, so rejoin it however long
            # the result is -- the split step re-cuts the whole run evenly, which beats
            # leaving a 2.5-mile orphan beside a 7-mile segment. A stub of a DIFFERENT
            # road only joins if the combined run still fits a single segment; otherwise
            # it stays its own, rather than manufacturing a long L-shaped corridor.
            same_name = [o for o in neighbours if dominant(o) == dominant(ch)]
            other_road = [o for o in neighbours
                          if o["miles"] + ch["miles"] <= MAX_SEGMENT_MILES]
            candidates = same_name or other_road
            if not candidates:
                continue
            target = min(candidates, key=lambda o: o["miles"])
            shared = set(target["ends"]) & set(ch["ends"])
            join = next(iter(shared))
            a, b = target["path"], ch["path"]
            if a[-1] != join:
                a = a[::-1]; target["edges"] = target["edges"][::-1]
            if b[0] != join:
                b = b[::-1]; ch["edges"] = ch["edges"][::-1]
            target["edges"] = target["edges"] + ch["edges"]
            target["path"] = a + b[1:]
            target["miles"] += ch["miles"]
            target["ends"] = (target["path"][0], target["path"][-1])
            chains.remove(ch)
            changed = True
            break
    return chains


def split_long_chains(chains, records):
    """Cut anything over MAX_SEGMENT_MILES into equal runs, at record boundaries."""
    out = []
    for ch in chains:
        if ch["miles"] <= MAX_SEGMENT_MILES:
            out.append(ch)
            continue
        pieces = max(2, math.ceil(ch["miles"] / TARGET_SEGMENT_MILES))
        per_piece = ch["miles"] / pieces
        current, current_miles, start = [], 0.0, 0
        made = 0
        for i, edge in enumerate(ch["edges"]):
            current.append(edge)
            current_miles += miles_of(records[edge]["properties"])
            if current_miles >= per_piece and made < pieces - 1:
                # A piece's ends are the nodes it actually runs between, not the
                # parent chain's -- otherwise every piece takes the same name.
                out.append({"edges": current, "miles": current_miles,
                            "path": ch["path"][start:i + 2],
                            "ends": (ch["path"][start], ch["path"][i + 1])})
                made += 1
                start, current, current_miles = i + 1, [], 0.0
        if current:
            out.append({"edges": current, "miles": current_miles,
                        "path": ch["path"][start:],
                        "ends": (ch["path"][start], ch["path"][-1])})
    return out


# ------------------------------------------------------------------ cross streets

def cross_street_index(all_records):
    """
    Every road in the county, county-maintained or not, indexed by its vertices, so a
    segment's endpoints can be named for the road they meet. A segment called
    "Caledonia Rd: Capron Rd to Poplar Grove Rd" tells an engineer where it is;
    "CALEDONIA RD (1 of 2)" does not.
    """
    index = defaultdict(set)
    for f in all_records:
        name = normalise_road_name(f["properties"].get("ROAD_NAME") or "")
        if not name:
            continue
        for c in coords_of(f):
            # Bucket on a coarse grid so a lookup only scans nearby roads.
            index[(round(c[0], 3), round(c[1], 3))].add((name, round(c[0], 6), round(c[1], 6)))
    return index


def cross_street_at(node, own_names, index):
    lon, lat = node
    best, best_d = None, CROSS_STREET_TOLERANCE_DEG
    for dx in (-0.001, 0, 0.001):
        for dy in (-0.001, 0, 0.001):
            for name, nlon, nlat in index.get((round(lon + dx, 3), round(lat + dy, 3)), ()):
                if name in own_names:
                    continue
                d = math.hypot(nlon - lon, nlat - lat)
                if d < best_d:
                    best, best_d = name, d
    return best


# ------------------------------------------------------------------------- main

def main():
    raw = json.loads(RAW.read_text())
    all_records = raw["features"]
    records = [
        f for f in all_records
        if str(f["properties"].get("JUR_TYPE") or "").strip() == COUNTY_JUR_CODE
    ]

    # Resolve truncated road names across the WHOLE network before anything groups or
    # names by them -- the cross-street index reads every road, not just county ones,
    # so a truncation left there resurfaces as "Garden Prairie to Spring Rd".
    canon = canonicalise({normalise_road_name(f["properties"].get("ROAD_NAME") or "UNNAMED")
                          for f in all_records})
    for f in all_records:
        f["properties"]["ROAD_NAME"] = canon[
            normalise_road_name(f["properties"].get("ROAD_NAME") or "UNNAMED")]

    chains, node_coords = build_chains(records)
    n_chains = len(chains)
    chains = merge_short_chains(chains, records)
    n_merged = len(chains)
    chains = split_long_chains(chains, records)

    index = cross_street_index(all_records)

    # Order segments north to south, then west to east, so segment ids follow the map.
    def northing(ch):
        pts = [c for e in ch["edges"] for c in coords_of(records[e])]
        return (-sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts))
    chains.sort(key=northing)

    features = []
    for ch in chains:
        props = [records[e]["properties"] for e in ch["edges"]]
        members = [records[e] for e in ch["edges"]]

        names = Counter()
        for p in props:
            names[normalise_road_name(p.get("ROAD_NAME") or "UNNAMED")] += miles_of(p)
        road = names.most_common(1)[0][0]

        # Name the segment for the cross streets at its two ends.
        own = set(names)
        crosses = [c for c in (cross_street_at(node_coords[n], own, index) for n in ch["ends"]) if c]
        if len(crosses) == 2 and crosses[0] != crosses[1]:
            extent = f"{title_case(crosses[0])} to {title_case(crosses[1])}"
        elif crosses:
            extent = f"at {title_case(crosses[0])}"
        else:
            extent = None
        label = f"{title_case(road)} · {extent}" if extent else title_case(road)

        def weighted(field):
            num = sum((p.get(field) or 0) * miles_of(p) for p in props)
            den = sum(miles_of(p) for p in props if p.get(field))
            return round(num / den, 1) if den else None

        classes, townships = defaultdict(float), defaultdict(float)
        for p in props:
            classes[p.get("FC_NAME") or "Unknown"] += miles_of(p)
            tw = (p.get("TOWNSHIP_N") or "").strip()
            if tw:
                townships[tw] += miles_of(p)

        measured = [p for p in props if (p.get("CRS_WITH") or 0) > 0 or (p.get("IRI_WITH") or 0) > 0]
        years = [int(str(p.get("SURF_YR")).strip()) for p in props
                 if str(p.get("SURF_YR") or "").strip().isdigit()]

        # Roll the constituent readings up into one length-weighted condition for the
        # planning segment, on the same 0-100 index the portal uses throughout.
        num = den = 0.0
        for p in measured:
            crs, iri = p.get("CRS_WITH") or 0, p.get("IRI_WITH") or 0
            cond = ((crs - 1) / 8 * 100) if crs > 0 else (100 * (1 - (iri - 40) / 180))
            cond = max(0.0, min(100.0, cond))
            w = miles_of(p) or 0.01
            num += cond * w
            den += w

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "MultiLineString",
                "coordinates": [
                    m["geometry"]["coordinates"] for m in members
                    if m["geometry"]["type"] == "LineString"
                ],
            },
            "properties": {
                "segment_id": None,  # assigned below, after the final ordering
                "road_name": title_case(road),
                "extent": extent,
                "label": label,
                "length_mi": round(ch["miles"], 2),
                "functional_class": max(classes, key=classes.get),
                "township": max(townships, key=townships.get) if townships else None,
                "aadt": weighted("AADT"),
                "surface_year_median": sorted(years)[len(years) // 2] if years else None,
                "inventory_records": len(members),
                "measured_records": len(measured),
                "measured_condition": round(num / den, 1) if den else None,
                "measured_miles": round(den, 2) if den else 0.0,
                "source": "real",
                "source_detail": "IDOT District 2 Roads (2017 IRIS extract), JUR_TYPE 3 (county highway)",
            },
        })

    # Number labels only where two segments would otherwise read identically. A lone
    # "Manchester Rd (1)" with no (2) anywhere just implies a series that isn't there.
    duplicated = {lab for lab, n in Counter(f["properties"]["label"] for f in features).items() if n > 1}
    seen = Counter()
    for i, f in enumerate(features, start=1):
        p = f["properties"]
        p["segment_id"] = f"cty_{i:03d}"
        if p["label"] in duplicated:
            seen[p["label"]] += 1
            p["label"] = f"{p['label']} ({seen[p['label']]})"

    out = {"type": "FeatureCollection", "features": features}
    (DATA / "county_segments.geojson").write_text(json.dumps(out))

    total_mi = sum(f["properties"]["length_mi"] for f in features)
    lengths = [f["properties"]["length_mi"] for f in features]
    print(f"county_segments.geojson: {len(features)} planning segments, {total_mi:.1f} mi")
    print(f"  {len(records)} IDOT records -> {n_chains} corridor chains -> "
          f"{n_merged} after merging stubs -> {len(features)} after splitting long runs")
    print(f"  segment length: min {min(lengths):.1f} / median "
          f"{sorted(lengths)[len(lengths)//2]:.1f} / max {max(lengths):.1f} mi")
    named = sum(1 for f in features if f["properties"]["extent"])
    print(f"  {named} of {len(features)} named by their cross streets")
    print()
    for f in features:
        p = f["properties"]
        print(f"  {p['segment_id']}  {p['label'][:48]:48s} {p['length_mi']:5.1f} mi  "
              f"{p['measured_records']:3d}/{p['inventory_records']:3d} measured  {p['functional_class']}")


if __name__ == "__main__":
    main()
