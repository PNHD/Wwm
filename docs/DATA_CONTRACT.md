# Data contract v1

M0 freezes the frontend-facing shape before any upstream importer is written.

## Region registry

`data/regions.json` contains stable region IDs and the assets needed to render a region.

Required fields:

- `id`: stable lowercase identifier.
- `name`: display name.
- `geojson`: local normalized POI file.
- `mapImage`: local image or later adapter-owned raster asset.
- `mapCoordinates`: MapLibre image-source corners, ordered top-left, top-right, bottom-right, bottom-left.
- `bounds`: navigation bounds.

The current `qinghe-demo` entry is synthetic and must not be treated as game truth.

## POI contract

Every POI is a GeoJSON `Feature<Point>` with a globally stable string `id`.

```json
{
  "type": "Feature",
  "id": "qinghe-chest-000123",
  "properties": {
    "id": "qinghe-chest-000123",
    "category": "chest",
    "name": "Treasure Chest",
    "description": "Optional guide text",
    "floor": 0,
    "source": "approved-source-key",
    "sourceId": "upstream-id",
    "updatedAt": "2026-08-08T00:00:00Z"
  },
  "geometry": {
    "type": "Point",
    "coordinates": [0, 0]
  }
}
```

The frontend must never depend on a third-party upstream schema directly. An importer/adapter converts upstream data to this contract.

## Progress contract

Browser progress uses localStorage key `wwm-map-progress:v1`:

```json
{
  "schemaVersion": 1,
  "completedIds": ["qinghe-chest-000123"]
}
```

Export files add `exportedAt`. Completion is keyed only by normalized POI ID, so a future backend sync can reuse the same identifier without changing the UI.
