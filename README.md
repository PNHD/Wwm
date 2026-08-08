# WWM Map — independent prototype

M0 foundation for a self-owned Where Winds Meet exploration map.

## Current state

**M0 / DEMO_ONLY.** The UI and progress system are functional, but the bundled map and POIs are synthetic. This repository intentionally does not mirror `wwmmap.pages.dev`, 17173, the official game map, or any other third-party dataset.

### Implemented

- MapLibre GL JS map shell with a local image source.
- Region registry and normalized GeoJSON POI contract.
- Category filters and search.
- Marker clustering for large future datasets.
- Local completion tracking.
- Hide completed.
- Progress import/export JSON.
- Shareable `#poi=<id>` deep links.
- Responsive desktop/mobile layout.
- No backend, account, Discord or old WWM Map dependency.

## Run locally

Serve the directory with any static HTTP server; do not open `index.html` through `file://` because JSON is loaded with `fetch()`.

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Deployment target

Static hosting such as Cloudflare Pages. Build command: none. Output directory: repository root.

## Data safety rule

Upstream providers must be converted into the normalized contract described in `docs/DATA_CONTRACT.md`. The frontend must not call an undocumented third-party schema directly.

## M1 gate

Before importing real WWM data, establish:

1. map asset/tile provenance and acceptable reuse terms;
2. coordinate transform per region/floor;
3. stable upstream IDs or a deterministic ID strategy;
4. importer fixture tests;
5. a data-source fallback strategy.
