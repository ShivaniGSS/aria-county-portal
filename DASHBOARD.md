# ARIA County Portal — what it is and what it does

As-built documentation for the dashboard in `~/aria-county-portal`.
Pilot county: **Boone County, Illinois**. Generated 2026-09-29.

uGRIDD Inc. · University of San Francisco · Illinois Association of County Engineers

---

## 1. The one rule this portal is built around

**Fabricated data is never presented as real.** Every condition value, every curve, every
cost carries a provenance tier, and that tier is visible wherever the value is:

| Tier | Meaning | How it is drawn |
|---|---|---|
| `measured` | A real IDOT CRS/IRI reading, or a real ARIA survey detection | Solid line, solid chart line, green **measured** badge |
| `synthetic` | An openly fabricated stand-in for a survey that has not happened | White dotted centreline on the map, dashed chart line with an uncertainty band, grey **synthetic** badge |

Synthetic values are *placeholders typical of a road class* — they are not estimates of
that specific road, and the interface says so in those words. They exist so the product
can be demonstrated end-to-end before survey, and are meant to be replaced wholesale.

Two fabrication incidents during development shaped this. Both are recorded in
`~/Downloads/ARIA/ARIA_Dashboard_Design.md`; the short version is that deriving condition
from `SURF_YR` alone produced 854 local roads reported as "condition 0, rebuild now",
and the corrected version then claimed 1,229 segments were "fine" on no evidence. The
tier system exists because of those.

---

## 2. What is real and what is not

### Real data, from public sources

| Source | What it gives | Volume |
|---|---|---|
| **IDOT District 2 Roads** (2017 IRIS extract, ArcGIS FeatureServer) | Road centrelines, functional class, AADT, jurisdiction, surface type/year, township, CRS/IRI condition | 3,295 records, 777 mi |
| **Census TIGERweb** | County boundary, 9 township polygons, 11 places, 211 water polygons, 340 water lines, 6 neighbouring counties | — |
| **ARIA pilot survey** | 24 sign detections with real MUTCD compliance measurements and image crops | 24 signs, 6 flagged |
| **Mobile LiDAR** (Garden Prairie Rd Track 01) | Decimated point cloud, 106 frame images | 5.7 MB cloud, 38 MB imagery |

### The measurement gap — the project's core finding

Of Boone's 777 road miles, condition coverage by jurisdiction:

| Jurisdiction | Records | Measured | Coverage |
|---|---|---|---|
| State | 437 | 433 | **99.1%** |
| Municipal | 1,375 | 166 | 12.1% |
| County highway | 207 | 57 | 27.5% |
| Township / road district | 1,060 | 15 | **1.4%** |

IDOT measures its own roads almost completely. The 366 miles of township road that
local government actually answers for sit at 1.4%. The county map has a
**"only roads with a real reading"** toggle that makes this visible in one click — tick
it and the county empties out.

Only **one** of six functional classes supports a deterioration curve fitted from Boone's
own measurements (Other Principal Arterial, r = −0.62, n = 405). The rest use documented
defaults and say so. Major Collector shows r = −0.002 on n = 53; Local Road shows
r = +0.84 on n = 6 — neither is a curve, and neither is used as one.

### Synthetic data, clearly labelled

- Pavement condition on **14 of 19** county planning segments
- Condition on the 2,453 non-county road records with no IDOT reading
- **511 of 535** assets (all culverts and guardrail, and signs outside the two surveyed corridors)
- 510 maintenance tasks, 286 work orders, 8 resource crews, 3 programs
- All treatment unit costs

Synthetic road condition is seeded deterministically from the road's name, so a road
reads as one coherent run of colour rather than quarter-mile confetti, and the map is
stable between builds.

---

## 3. How the county is divided

**19 planning segments, 93.3 centreline miles** — the county highway system
(IDOT `JUR_TYPE 3`), which is what a county engineer is responsible for. Township
(366 mi), municipal (199 mi) and state (51 mi) roads are shown but are somebody else's
to maintain.

Segments are built on the road **graph**, not by grouping road names:

1. Every inventory record is an edge; endpoints within 25 m are one node.
2. Maximal chains are walked through pass-through nodes, breaking only at junctions and
   dead ends — 36 contiguous corridors. A chain is a run you could drive without turning.
3. Stubs under 4 mi rejoin their corridor (same road however long the result; a different
   road only if the total still fits one segment).
4. Anything over 8 mi is cut into equal runs at record boundaries.

Result: min 0.95 mi, **median 5.33 mi**, max 6.9 mi. Breaks land at real intersections,
and 15 of 19 segments are named for the cross-roads they run between — *"Beaverton Rd ·
Manchester Rd to Hunter Rd"*, not *"Caledonia Rd (1 of 2)"*.

The three short segments are genuine: Cherry Valley Rd (0.95 mi) and Logan Ave (1.5 mi)
are isolated corridors with nothing to merge into.

### The asset hierarchy

**County → segment → asset class → individual asset**, 535 assets across four classes:

| Class | Assets | Real |
|---|---|---|
| Pavement | 19 | 0 (5 segments carry real rolled-up IDOT condition) |
| Signs | 273 | **24** |
| Culverts | 177 | 0 |
| Guardrail | 66 | 0 |

Every level carries a condition value and a deterioration curve, so the same chart renders
a 6-mile segment, its sign inventory, or one individual sign.

---

## 4. Pages

### Surveyed roads (new, the landing page)

One page per surveyed road, built by `scripts/survey/build_road.py` from the detection engine's output and the survey
trajectory (inputs in `raw_data/survey/<road>/`, outputs in `public/data/roads/<slug>/`). Stone Quarry Rd is the first.

- **Three layouts to choose between** (engineers rate each with "Rate this layout"; ratings export with the
  Feedback button): *Map* (map first, diagram underneath, street-view inset), *Street view* (360° panorama first with
  assets pinned in the photo, locator map, road timeline), *Plan sheet* (straight-line diagram first, photos and map
  beside it).
- **Street view:** the survey's own cube-face panoramas (`scripts/survey/export_panoramas.py`, 768 px faces) in a
  three.js viewer; drag to look, arrows to move. Roads without their own imagery borrow another road's panoramas and
  say so ("representative").
- **Map:** satellite or street basemap (Esri World Imagery, OpenFreeMap; both keyless), 3D tilt, every asset
  drawn as its own icon (signs in their MUTCD shapes), road coloured by centre-line type, paved width, grade, curvature
  or traffic, crashes, and rings on anything that needs attention. Under it, a straight-line diagram by station, grouped by decision (geometry, safety, signs, utilities,
  access, IDOT), collapsible, density bars when zoomed out, symbols when zoomed in, and an "issues only" switch.
- **Asset record:** x, y, z (IL State Plane East ft), station, side, clearances, dimensions, MUTCD checks written as
  verdicts with margins, detection confidence, evidence views, the road at that spot, and a feedback box for engineers.
  Every value says whether it is measured, derived, public or a placeholder.
- **Work lists:** sign placement (MUTCD 2A.15/2A.16), fixed objects in a clear zone the county sets, curves without
  warning signs, narrow pavement, leaning poles, mailbox height, passing zones, crashes; each exportable as CSV.
- **Inventory:** every asset, filterable and sortable, export CSV or GeoJSON.

How assets are located: cube faces 0–3 are compass-fixed (W, N, E, S); each detection is a bearing from its survey
stop; bearings from several stops are intersected and checked against the distance implied by where the object meets
the ground (camera 8.25 ft above the road). See `scripts/survey/geolocate.py`.


### Planning

**County map** — the landing page. All 19 segments on a real basemap, coloured by
condition, clickable to drill in. Right-hand rail lists every segment worst-first with
mileage, asset count and provenance badge. Controls:

- **Basemap picker**: Esri Light Gray Canvas (default, built for thematic overlay), USGS
  National Map topographic, Esri World Imagery (aerial), OpenStreetMap, and a built-in
  offline backdrop drawn from TIGER + IDOT that ships with the portal.
- **County system / All jurisdictions** — colour only the 93 miles the engineer owns, or
  all 777.
- **Only roads with a real reading** — the coverage view.
- Legend states centreline miles per condition band, not just the colour key.
- Scale bar, north arrow, route labels, township and place names.

**Condition** — the graphs, at whichever level is selected:

- *County*: mile-weighted network condition over 30 years, and miles by condition band
  split measured/synthetic. Ranked table of segments by years-to-rebuild.
- *Segment*: pavement curve, plus asset-class cards.
- *Asset class*: class curve and every asset in it, worst first.
- *Asset*: individual curve, plus the detection crop and MUTCD violations for real signs.

Each chart shows **do-nothing vs maintained**: the do-nothing curve decays; the maintained
curve shows a sawtooth of interventions whenever condition would fall below the desired
minimum, with 30-year cost.

**Programming** — enter a budget, get a greedy cost-effectiveness allocation across
segments (benefit weighted by condition gain × length × traffic), split into funded and
deferred with the rebuild liability of deferring.

### Operations

**Survey corridors** — the original pilot view: route, sign detections with image crops,
pavement condition, waypoints, and a 3D point-cloud viewer.

**Overview** — top-priority tasks and upcoming work orders in the selected period.

**Table** — all 510 tasks, filterable and sortable.

**Resources** — the 8 crews, their zones and their load in the selected period.

### Always present

- **Time-period control**, top-left: Day / Week / Month / All with prev-next and a date
  popover. It is the primary filter, not a page — a county engineer makes decisions
  daily, so every operations view is scoped by it.
- **Stat tiles**: Critical, Watch, Completed this period, Crews active, Estimated cost.
- **Floating locator map** — once you drill into a segment, a draggable, collapsible panel
  pins to the corner of every other page showing where in the county you are. It always
  frames the whole county and never zooms to the segment; it is a locator, not a second
  map.

---

## 5. The condition model

`index(age) = 100 / (1 + exp((age − L) / s))` per functional class, where `L` is the
service-life midpoint and `s` the transition sharpness.

**Curves are anchored by age, not by a vertical offset.** The model asks "at what age
would this class be in this condition?" and projects from there. An additive offset makes
the curve asymptote to the offset instead of to zero, so an old road never deteriorates
further and a rebuilt road reads as permanently near-new — both false, and both flatter
the projection. A treatment moves a road back along its own curve; it does not exempt it
from that curve.

Thresholds: desired minimum **55**, full replacement **25**. These come from pavement
practice and are applied to every asset class as a stated working assumption.

### Treatments (illustrative unit rates, not Boone's bid prices)

Priced **per mile** for pavement and **per unit** for counted assets — without that split
the portal quotes six figures to replace one street-name sign.

| Pavement | Restores | $/mi |
|---|---|---|
| Crack sealing | 8 | 4,000 |
| Seal coat | 18 | 18,000 |
| Thin overlay | 34 | 95,000 |
| Resurfacing | 55 | 240,000 |
| Reconstruction | 100 | 850,000 |

| Signs | $/ea | | Culverts | $/ea | | Guardrail | $/ea |
|---|---|---|---|---|---|---|---|
| Reset post | 180 | | Clean out | 900 | | Re-tension | 1,400 |
| Reface sheeting | 320 | | Slipline / repair end | 7,500 | | Replace panels | 6,200 |
| Replace sign + post | 620 | | Replace structure | 32,000 | | Replace run + end | 24,000 |

---

## 6. Cartography

The map is built to engineering-deliverable standards, and the choices were tested rather
than eyeballed.

**Condition ramp** — `#1B6E3C` Good / `#E8C547` Fair / `#BF5B18` Poor / `#6E1414` Failed.
Chosen by simulating deuteranopia and protanopia in OKLab: the previous
green/amber/salmon/red ramp put Fair and Poor at ΔE 13.6 normal and 11.4 deuteranopic,
below the 15 / 8 thresholds — and those are the two bands a pavement map most needs to
separate. This ramp steps lightness as well as hue; worst adjacent pair is **ΔE 23.9**
under both simulations, and the order survives greyscale and print.

**Cased lines, not dashes.** Segments are drawn as a white halo, a hairline dark casing
(so the pale Fair band stays legible), then the band colour. Provenance is a fine white
dotted centreline *inside* the line. Dashing a 6px line breaks each road into slabs and
reads as highlighter.

**Study-area mask, not a frame.** Boone is genuinely rectangular — 12.05 × 23.67 mi,
confirmed independently against OpenStreetMap at 99.7% overlap, with a maximum departure
from its bounding rectangle of 0.216 mi. Outlining a rectangular county with a heavy
stroke reads as a picture frame, so instead everything *outside* the county is dimmed and
the boundary drops to a hairline.

**Subordination by lightness, not transparency.** Roads outside the county's jurisdiction
use a lighter step of the same band. Transparency muddied every colour it crossed.

---

## 7. Architecture

```
src/
  App.tsx                   shell: header, stat strip, sidebar, page switch
  lib/
    AppStateContext.tsx     page, drill-down selection, period, filters
    dateMath.ts             local-date parsing and period ranges
    assetTypes.ts           CurveEntity, condition bands
    conditionModel.ts       curves, treatments, scenarios, liability
    basemaps.ts             basemap catalogue + reachability probe
    countyMapSource.ts      map style, layer stack, condition expressions
    useMaintenanceData.ts   single cached load of every dataset
  components/               one file per page or panel
scripts/                    Python data pipeline (fetch → build → public/data)
```

**Data pipeline** — each script is re-runnable and prints what it produced:

| Script | Output |
|---|---|
| `fetch_idot_centerlines.py` | IDOT roads + townships → `raw_data/` |
| `fetch_boone_basemap.py` | County, places, water → `raw_data/` |
| `build_county_segments.py` | 19 planning segments |
| `build_segment_assets.py` | 535-asset drill-down |
| `build_basemap.py` | Offline vector basemap |
| `build_condition_model.py` | Per-class curve fitting |
| `generate_synthetic_tasks.py` | Tasks, work orders, crews, programs |
| `preprocess_garp_t1.py`, `make_web_pointcloud.py` | Survey imagery and point cloud |

Stack: React 18 + TypeScript + Vite, MapLibre GL v6, Three.js. No backend — everything is
static files, which is why it deploys to a bucket and runs in a county office.

---

## 8. Known limits

- **Only 24 assets of 535 are real.** Everything else awaits survey.
- **One fitted curve** across six functional classes; the rest are documented defaults.
- **Treatment costs are illustrative** and need Boone's actual bid history.
- **Thresholds are pavement-derived** and applied to signs, culverts and guardrail as an
  assumption, not a finding.
- **Tile basemaps need outbound network.** In a sandboxed embed the portal falls back to
  its built-in backdrop and says so; the offline map is honest but noticeably plainer.
- The older 3,295-segment `condition.json` still backs the Programming page, while the
  county map and Condition page use the newer 19-segment model. These should converge.

## 9. Not yet built

From the approved design document:

- **Status page** — work status entry and review
- **Schedule** with swimlanes and in-house vs contractor **conflict detection**
- **Status update forms** for field crews (Daily Work Report schema)
- **Print worksheets** — crew sheets, segment reports
- **Board report** — the decision-maker output
- **Data-source register** on Programming
- **IDOT Multi-Year Program** and live-construction layers — 17 programmed projects
  intersect Boone; 0 of 753 active statewide construction projects are in Boone, and the
  `Road_Construction_Public` layer carries contractor, dates, lane closures and detour
  route

---

## 10. Running it

```bash
cd ~/aria-county-portal
npm install
npm run dev      # http://localhost:5173 (real basemaps)
npm run build    # static bundle in dist/
```

Re-run any pipeline script from the repo root; each writes to `public/data/` and prints a
summary. `raw_data/` is gitignored — cached pulls of public data, not source.
