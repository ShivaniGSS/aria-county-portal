# ARIA County Portal

AI-assisted infrastructure asset management for rural county highway departments.
Pilot: **Boone County, Illinois**.

uGRIDD Inc. · University of San Francisco · Illinois Association of County Engineers

**Live demo:** https://shivanigss.github.io/aria-county-portal/

---

## Read this before interpreting anything on the map

This is a **pre-survey demonstration build.** Most of the condition data in it is
synthetic, and the portal is built so you can always tell which is which.

| Tier | What it is |
|---|---|
| `measured` | A real IDOT CRS/IRI reading, or a real ARIA survey detection |
| `synthetic` | An openly fabricated stand-in for a survey that has not happened |

Synthetic values are placeholders typical of a road class. They are **not** estimates of
that specific road. On the map they carry a white dotted centreline; in charts they are
dashed with an uncertainty band; everywhere else they carry a `synthetic` badge.

Concretely: **24 of 535 assets are real**, and pavement condition is a real reading on
**5 of 19** planning segments. Treatment costs are illustrative unit rates, not Boone
County bid prices.

See [DASHBOARD.md](DASHBOARD.md) for the full as-built documentation.

## Data sources and attribution

| Source | Used for | Attribution |
|---|---|---|
| IDOT District 2 Roads (2017 IRIS extract) | Centrelines, functional class, AADT, jurisdiction, CRS/IRI condition | Illinois Department of Transportation |
| US Census TIGERweb | County, township, place and hydrography boundaries | US Census Bureau |
| Esri World Light Gray Canvas / World Imagery | Basemap tiles | Esri, HERE, Garmin, Maxar, Earthstar Geographics, USDA FSA, USGS, © OpenStreetMap contributors |
| USGS National Map | Topographic basemap | USGS The National Map |
| OpenStreetMap | Street basemap | © OpenStreetMap contributors |
| ARIA pilot survey | 24 sign detections, imagery, LiDAR | uGRIDD / USF |

Basemap tiles are fetched from public services at their published endpoints. If those
services cannot be reached, the portal falls back to a backdrop built from TIGER and
IDOT data that ships with it, and says so on screen.

## Running locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
```

The Python pipeline under `scripts/` rebuilds every derived dataset from the public
sources. `raw_data/` is a gitignored cache of those pulls, not source.

## Stack

React 18 · TypeScript · Vite · MapLibre GL · Three.js. No backend — the whole portal is
static files.
