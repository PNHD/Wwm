# Dashen public map geometry for WWMSync visual localization

Status: static public-web investigation only. DD/native IPC investigation remains closed.

## Scope boundary

Inspected only public HTML, JavaScript, CSS, public map metadata and raster-map configuration from:

- `https://act.ds.163.com/6edef85118d3037a/`
- `https://act.ds.163.com/563a17016e1c64ab/`

No process memory, binary/native IPC, injection, hooking, MITM, packet interception, or private bridge discovery was used.

Evidence workflow: `.github/workflows/inspect-public-map-geometry.yml`.
Successful geometry runs include `31450389344` and `31450676530` on `feature/wwm-native-sync-v2`.

## Shared world-planar -> Dashen map transform

Both public surfaces ship the same coordinate module and constants.

The source names the two horizontal inputs `x` and `y`. If WWMSync/game terminology names the second horizontal world axis `z`, substitute `z` for the source's `y`; the static web bundle itself does not establish the engine vertical-axis naming convention.

For each `mapSubType`, let:

```text
r = (worldX * xArrow + xOffset) * realMeter * calMeter
q = (worldY * yArrow + yOffset) * realMeter * calMeter
```

The Leaflet `[lat,lng]` output is:

```text
isXHorizontal ? [r,q] : [q,r]
```

Constants:

| mapSubType | mapWidth | mapHeight | calMeter | realMeter | xOffset | yOffset | xArrow | yArrow | isXHorizontal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 19456 | 19456 | 1024/1008 | 256/19456 | 12095.6875 | 12095.6875 | -1 | 1 | false |
| 2 | 9216 | 9216 | 1024/1008 | 256/19456 | 2015.89583 | 2015.8302 | -1 | 1 | false |
| 3 | 16384 | 16384 | 1024/1008 | 0.015625 | 4 | 4036 | -1 | -1 | true |
| 4 | 16384 | 16384 | 1024/1008 | 0.015625 | 2128 | 4156 | -1 | 1 | false |

For subtype 1 this reduces to:

```text
lat = (worldY + 12095.6875) * (256/19456) * (1024/1008)
lng = (-worldX + 12095.6875) * (256/19456) * (1024/1008)
```

The inverse shipped by the same module is algebraically exact:

```text
worldX = (horizontalA / (realMeter*calMeter) - xOffset) / xArrow
worldY = (horizontalB / (realMeter*calMeter) - yOffset) / yArrow
```

where `horizontalA/horizontalB` are selected from `[lat,lng]` according to `isXHorizontal`.

## Leaflet CRS and tile pyramid

Both public surfaces create the map with a simple planar CRS, not Web Mercator:

```text
L.CRS.Simple
L.Transformation(1, 0, 1, 0)
```

The public raster layer is configured with:

```text
minZoom = 3
maxZoom = 8
noWrap = true
updateWhenIdle = true
```

No custom tile size is set, so Leaflet's 256 px tile size applies.

The map bounds are derived from public config `mapInfo.ext[subtype].width`:

```text
p = 256 / (32768 / width) = width / 128
bounds = [[0,0],[p,p]]
maxBounds = [[-20,-20],[p+20,p+20]]
```

The production tile URL template is loaded dynamically from:

```text
mapInfo.ext[subtype].url
```

The public metadata bootstrap resolves the map id using:

```text
POST https://inf.ds.163.com/v1/web/game-map/map-info/get
{"appKey":"h72"}
```

Observed response during the evidence run:

```json
{"result":{"mapId":"676d48a37d299d0811946ff1"},"code":200,"errmsg":"OK"}
```

The production tile host/template itself is supplied by dynamic public page configuration; do not substitute the bundle's dormant/test URL as the production URL until that config value is captured directly.

With this CRS and identity transformation, at zoom `z` the projected pixel coordinate is the planar Leaflet coordinate multiplied by `2^z`. At zoom 8, one Leaflet map unit equals 256 rendered pixels.

## Player marker and follow behavior

The public maps create a dedicated player/self marker and expose:

```text
window.map.userMarker.updateMapPos(...)
```

The updater is throttled to approximately 500 ms for ordinary updates. A forced update cancels the throttle and executes immediately.

For an absolute `{x,y}` update the public client:

1. converts `{x,y,mapSubType}` through the shared planar transform above;
2. calls `marker.setLatLng(transformedPosition)`;
3. applies heading/rotation when supplied;
4. follows/recenters when the marker is outside the inner visible map bounds or when `forcePosition` is set.

The follow helper transforms the same absolute `{x,y}` and uses `map.flyTo(target, zoom)` when forced or when the target is sufficiently separated from the current center.

Map-subtype changes re-submit the current absolute player position using `forcePosition:true`, confirming that `updateMapPos` consumes an absolute position rather than an accumulated visual delta.

## Geometry correction observed in public web client

A static client-side correction exists for one special region in the Hexi/subtype-specific path:

```text
if y in [6091.845703125, 8365.1640625]
and x in [-8857.505859375, -5504.01025390625]
then add { x: 3427.4, y: -3781.5 }
```

Treat this as a map-geometry compatibility correction, not as a transport/native discovery.

## Visual-localization consequence

A safe hybrid architecture is therefore feasible in principle:

```text
captured minimap ROI
  -> rotation/scale-aware raster registration
  -> absolute planar/map position
  -> reset optical-flow origin and derived scale/orientation
  -> optical flow between fixes
  -> periodic absolute re-registration to remove drift
```

The current WWMSync map and the Dashen map do not currently use the same Leaflet CRS. WWMSync renders the Global official raster using its existing web-map coordinate space, while Dashen uses `L.CRS.Simple`. Therefore the first integrated prototype should either:

- register against the same Global official raster already displayed by WWMSync, yielding a position directly in WWMSync's current Leaflet projection; or
- register against Dashen tiles and then apply a separately verified Dashen-to-WWMSync map-space transform before moving the existing Leaflet marker.

The first path is lower-risk for the prototype because it avoids introducing an unverified cross-map affine transform. Dashen geometry remains useful for recovering absolute world-planar coordinates and for later direct Dashen-reference localization.

## Acceptance rule

Absolute registration must be confidence-gated. A low-confidence match must never overwrite a good marker position. Until an absolute fix is accepted, the existing manual anchor remains available as fallback. Existing visible Motion diagnostics must remain until actual end-to-end marker movement is verified.
