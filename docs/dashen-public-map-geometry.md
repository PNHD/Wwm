# Dashen public map geometry for WWMSync visual localization

Status: public-web/map-geometry investigation only. DD/native IPC investigation remains CLOSED.

## Scope boundary

Inspected only public HTML, JavaScript, CSS, public map metadata, point catalogs and raster-map assets from:

- `https://act.ds.163.com/6edef85118d3037a/`
- `https://act.ds.163.com/563a17016e1c64ab/`

No process memory, binary/native IPC, injection, hooking, MITM, packet interception or private bridge discovery was used.

Primary evidence workflows/runs:

- `inspect-public-map-geometry.yml` — runs `31450389344`, `31450676530`
- `fetch-dashen-map-config.yml` — run `31451060389`
- `register-public-map-atlases.yml` — run `31451171915`
- `inspect-public-poi-schema.yml` — run `31451439295`
- `fit-public-poi-geometry-v2.yml` — run `31451730408`
- `validate-absolute-visual.yml` — run `31452337013`, final successful matcher job `93669682130`
- `validate-vision-integration.yml` — run `31456116734`, job `93670126878`

## Shared world-planar -> Dashen transform

Both public surfaces ship the same coordinate module. The source names the two horizontal inputs `x` and `y`. If project terminology calls the second horizontal engine axis `z`, substitute `z` for source `y`; the public bundle itself does not prove engine vertical-axis naming.

For each `mapSubType`:

```text
r = (worldX * xArrow + xOffset) * realMeter * calMeter
q = (worldY * yArrow + yOffset) * realMeter * calMeter
Leaflet [lat,lng] = isXHorizontal ? [r,q] : [q,r]
```

| mapSubType | mapWidth | mapHeight | calMeter | realMeter | xOffset | yOffset | xArrow | yArrow | isXHorizontal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 19456 | 19456 | 1024/1008 | 256/19456 | 12095.6875 | 12095.6875 | -1 | 1 | false |
| 2 | 9216 | 9216 | 1024/1008 | 256/19456 | 2015.89583 | 2015.8302 | -1 | 1 | false |
| 3 | 16384 | 16384 | 1024/1008 | 0.015625 | 4 | 4036 | -1 | -1 | true |
| 4 | 16384 | 16384 | 1024/1008 | 0.015625 | 2128 | 4156 | -1 | 1 | false |

Subtype 1 reduces to:

```text
lat = (worldY + 12095.6875) * (256/19456) * (1024/1008)
lng = (-worldX + 12095.6875) * (256/19456) * (1024/1008)
```

Inverse:

```text
worldX = (r/(realMeter*calMeter) - xOffset) / xArrow
worldY = (q/(realMeter*calMeter) - yOffset) / yArrow
```

## CRS, pyramid and production raster URLs

Both public maps use a planar Leaflet CRS, not Web Mercator:

```text
L.CRS.Simple
L.Transformation(1, 0, 1, 0)
```

Raster layer:

```text
minZoom = 3
maxZoom = 8
noWrap = true
updateWhenIdle = true
tileSize = 256 (Leaflet default)
```

Bounds are derived from `mapInfo.ext[subtype].width`:

```text
p = width / 128
bounds = [[0,0],[p,p]]
maxBounds = [[-20,-20],[p+20,p+20]]
```

At zoom `z`, planar Leaflet coordinates project to raster pixels by multiplication with `2^z`.

Public bootstrap:

```text
POST https://inf.ds.163.com/v1/web/game-map/map-info/get
{"appKey":"h72"}
```

Observed map id:

```text
676d48a37d299d0811946ff1
```

Production tile config captured from public page config:

```text
main/subtypes 1-2:
https://img.166.net/canonical/h72/tilemap/v15.0/{z}/{x}_{y}.png?imageView&v=1
width = 32768

subtype 3:
https://img.166.net/canonical/h72/tilemap/subType3/v2/{z}/{x}_{y}.png?imageView&v=1
width = 8192

subtype 4:
https://img.166.net/canonical/h72/tilemap/subType4/v2/{z}/{x}_{y}.png?imageView&v=1
width = 8192
```

Public map-zone config maps subtype `1 -> map12`, `2 -> map12`, `3 -> map3`, `4 -> map4`.

## updateMapPos / marker / follow

The public maps expose a dedicated self marker through:

```text
window.map.userMarker.updateMapPos(...)
```

Ordinary updates are throttled to about 500 ms; forced updates execute immediately. For absolute `{x,y}` input the web client:

1. transforms `{x,y,mapSubType}` using the shared planar transform;
2. calls `marker.setLatLng(transformedPosition)`;
3. applies heading/rotation when supplied;
4. follows/recenters when the marker leaves the inner visible bounds or `forcePosition` is true.

The follow helper transforms the same absolute coordinates and calls `map.flyTo(target, zoom)` when forced or sufficiently separated from the current center. Map-subtype changes resubmit the current absolute position with `forcePosition:true`. Therefore `updateMapPos` is an absolute-position consumer, not a delta accumulator.

One public client correction exists for a special region:

```text
if y in [6091.845703125, 8365.1640625]
and x in [-8857.505859375, -5504.01025390625]
then add { x: 3427.4, y: -3781.5 }
```

This is treated only as map geometry compatibility logic.

## Dashen -> current WWMSync map-space bridge

The old WWMSync raster URL set is stale: the atlas-registration run obtained `64/64` live Dashen z3 tiles but `0` usable old Global raster tiles across z8-z13 probes. It is not used as a visual bridge.

Instead, the current public Global point API and Dashen point API were matched using unique exact Chinese POI names, then an affine bridge was fit from Dashen raw world-planar `[x,y]` to the current WWMSync `[lng,lat]` map space.

### Map 1 — Qinghe / Dashen subtype 1

- exact unique POI pairs: `117`
- inliers: `117`
- median residual: `3.79e-6`
- p95 residual: `5.89e-6`

```text
[worldX worldY 1] @
[
  [-0.0008571998713959525,  3.105598492965692e-10],
  [ 2.2578244634162414e-10, -0.0008384564733202777],
  [-2.5356030330799597,     -1.1167063806874027]
]
=> [GlobalLng GlobalLat]
```

### Map 2 — Kaifeng / Dashen subtype 1

- exact pairs: `149`
- inliers: `147`
- p95 residual: `5.66e-6`

```text
[
  [-0.0006786008932376111,  3.202127447520522e-10],
  [-5.090606415136117e-10, -0.0006518996758809071],
  [-1.0806951387375319,      0.5453954425180498]
]
```

### Map 3 — Hexi / Dashen subtype 2

- exact pairs: `81`
- inliers: `71`
- p95 residual: `0.00215184`

This is materially worse than the other regions. The prototype intentionally sets `geometryOk=false` for current WWMSync map 3, so Hexi absolute localization cannot write the marker until a better piecewise/projective correction is verified.

### Map 4 — Kaifeng Palace / Dashen subtype 4

- exact pairs: `49`
- inliers: `48`
- p95 residual: `5.34e-6`

```text
[
  [-0.0018805015482138414, -4.2098541037416125e-09],
  [-4.85819355610425e-10, -0.0018007017851145606],
  [-0.8635958719320187,    -2.492606921960836]
]
```

## Preview visual-reference cache

Real browser GETs to `img.166.net` do not expose usable CORS headers for canvas pixel reads. The prototype therefore does not use `no-cors`, tainted canvases or a generic runtime proxy.

`tools/build_dashen_visual_cache.py` prefetches a bounded fixed set of public z3/z5 tiles during the preview deploy and packages them under `/dashen-cache/`. `dashen-tile-cache.js` rewrites only the exact known Dashen raster URL forms to that same-origin static cache. Current deploy evidence builds `404/404` tiles; browser smoke verifies the rewritten tile can be read by `canvas.getImageData()`.

## Hybrid absolute-localization implementation

Current architecture:

```text
screen-capture ROI
  -> annular terrain/edge descriptor (player-center excluded)
  -> multi-scale + rotation-aware coarse Dashen raster search
  -> normalized photometric NCC + edge ranking
  -> z5 fine search + photometric reranking
  -> structure/NCC/global-separation confidence gate
  -> Dashen planar absolute position
  -> verified Dashen->WWMSync affine bridge
  -> existing Leaflet player marker
  -> reset optical-flow origin and derive 2x2 motion calibration
  -> optical flow between fixes
  -> periodic absolute re-registration to remove drift
```

Implementation details in `vision-sync.js`:

- ROI descriptor uses positive terrain/edge evidence plus negative/quiet-region evidence.
- Coarse search preserves per-scale hypotheses and handles arbitrary minimap rotation.
- Normalized grayscale photometric correlation is used at coarse, fine-rerank and final verification stages; the initial edge-only false positives were not accepted by lowering thresholds.
- Global reacquisition uses a wider search; local periodic fixes use a smaller search window after lock.
- A high-confidence candidate requires a second independent frame before `applyAbsoluteFix` may write the marker.
- `applyAbsoluteFix` reuses the existing Vision marker and optical-flow state; it does not create a second player marker and does not fabricate a Motion `accepted` frame.
- The absolute match derives a 2x2 motion matrix from registration scale/orientation and the current Leaflet projection. Optical flow uses that matrix between absolute fixes; the manual scale/orientation controls remain fallback and clear the auto matrix if the user changes them.
- Low-confidence or out-of-bounds registrations HOLD without moving the marker.
- Hexi HOLDs at the geometry gate by design.
- Manual anchor remains fallback.
- Existing visible Motion diagnostics remain intact: raw terrain dx/dy, corrected player dx/dy, cumulative displacement, marker delta, confidence and HOLD reason.

## Final synthetic validation

### Absolute registration + production gate

`validate-absolute-visual.yml`, run `31452337013`, final job `93669682130`: **PASS**.

The test generates a rotated/scaled ROI from the same public Dashen raster and then calls the production registration stack, including the actual runtime `matchGate`.

Synthetic target:

```text
coarse center = (360, 240)
radius = 18
rotation = 37 degrees
```

Recovered result:

```text
position = (359.875, 239.875)
position error = 0.1767766953 coarse px
radius = 17.885592
rotation = 37.5 degrees
rotation error = 0.5 degrees
NCC = 0.9625964830
combined score = 0.7322161742
global/beam separation margin = 0.1256810433
gateReason = ""
ok = true
```

The winning hypothesis is therefore not merely geometrically close; it also passes the same confidence gate used before a runtime absolute marker write.

### Screen capture -> absolute anchor -> optical flow -> Leaflet marker

A permanent validation workflow was added as `.github/workflows/validate-vision-integration.yml`.

Run `31456116734`, job `93670126878`: **PASS**.

The browser test replaces `getDisplayMedia` with a real `canvas.captureStream(30)` only inside the test page, then uses the normal UI/bridge path:

```text
Start Vision Sync
  -> getDisplayMedia-compatible MediaStream
  -> applyAbsoluteFix(..., motionMatrix=[1,0,0,1])
  -> existing Leaflet player marker
  -> shift captured terrain by (2,1) source px
  -> ordinary Vision optical-flow sampling
```

Observed invariants:

```text
immediately after absolute fix:
absoluteFixes = 1
accepted = 0                 # no fabricated motion success
motionCalibration = absolute-matrix
marker = (0.25, -2.55)

following shifted capture:
raw terrain delta ~= (4.4775, 2.4483) work px
corrected map delta ~= (-2.0149, -1.1017) map px
cumulative ~= (-2.0149, -1.1017)
accepted = 1
marker = (0.2507564815, -2.5513835176)
marker movement ~= 0.0015768276 Leaflet-coordinate units
motionCalibration remains absolute-matrix
Motion diagnostics UI remains present
```

This closes the browser/synthetic E2E propagation chain: an absolute fix can establish the existing marker and auto calibration, and subsequent optical flow can produce a real Leaflet marker delta. `accepted` does not increment merely because an absolute fix occurred.

## Acceptance status

### Implementation / preview architecture

**PASS for synthetic/browser validation** for:

- public Dashen geometry extraction;
- tile pyramid and production raster resolution;
- safe same-origin preview reference cache;
- Dashen world-planar -> current WWMSync map bridge for Qinghe, Kaifeng and Kaifeng Palace;
- scale/rotation-aware absolute raster registration;
- runtime confidence gate;
- absolute marker re-anchor;
- auto 2x2 optical-flow calibration;
- optical flow between absolute fixes;
- marker movement propagation;
- Motion diagnostics preservation;
- manual-anchor fallback.

### Deliberate limitations

- **Hexi is not enabled for absolute marker writes** because its public POI bridge residual remains materially worse (`p95 ~= 0.00215184`).
- **Real WWM / GeForce NOW gameplay E2E is not claimed from CI.** GitHub runners cannot supply an actual live WWM minimap/game-map capture. Final real-game acceptance still requires a captured gameplay sequence where the absolute position lands correctly and periodic fixes demonstrably correct drift while the player moves.
- Until that real gameplay test passes, visible Motion diagnostics and manual anchor remain available exactly as requested.

The implementation does not reopen DD/native IPC investigation and uses no process memory, injection, hooking or packet MITM.
