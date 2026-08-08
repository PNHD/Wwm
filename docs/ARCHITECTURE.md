# Architecture

## Goals

1. The site must remain usable if the old community developer disappears.
2. No authentication is required for the core experience.
3. Third-party map data must not be silently mirrored without permission.
4. Personal state must be exportable and portable.
5. A failed external map source must not take down the site shell.

## Runtime layers

### WWM Atlas shell
Owned static HTML/CSS/JS. Provides source switching, language, notes, backups, responsive layout and `/map` routing.

### External real-map sources
Official Map, 17173 and MapGenie load directly in an iframe. A persistent “open in new tab” action remains available when a provider blocks embedding.

### Personal Overlay
MapLibre-powered local map. Accepts normalized GeoJSON Point features. Completion state is stored separately by stable feature ID.

## Persistence

- `wwm-atlas-state:v2`: language, selected source, notes, completion IDs, UI flags.
- `wwm-atlas-dataset:v1`: optional imported GeoJSON dataset.

No server-side user database is required.
