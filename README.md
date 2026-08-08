# WWM Atlas — Where Winds Meet Auto-Sync Map

WWM Atlas is a fan-made **Where Winds Meet** companion map focused on one job: restore game progress onto the map automatically so a player does not have to manually re-mark hundreds of completed locations.

## Current product

- **Game progress auto-sync** through a narrowly scoped compatibility adapter.
- Existing completion state is matched to map marker IDs automatically.
- Vietnamese and English UI.
- Search, map switching, completion count and **Hide completed**.
- Flat raster renderer for the main world maps plus marker rendering for additional map IDs.
- Cloudflare Pages Functions for same-origin sync calls.
- No MapGenie or 17173 provider UI.
- No embedded third-party map iframe.

## Compatibility architecture

The Global game does not expose a documented public progress API for this use case. The current implementation interoperates with the publicly reachable WWM Map sync bridge:

- `/api/sync/gameauth` forwards only the supported UID/link/reset authentication contract.
- `/api/sync/client-method` allows only `start_game_sync`; it is not a generic RPC proxy.
- `/api/sync/relay-servers` returns a sanitized relay registry.
- The browser receives progress from the selected relay over WebSocket and maps completion IDs such as `cs_*`, `kv_*`, `ma_*`, `vst_*`, `bv_*`, `t_*` and `rw_*` to markers.
- `/api/map/markers` streams/cache-proxies the compatibility marker dataset at runtime.

Sync credentials are not persisted server-side. They stay in browser session storage by default and are stored in local storage only when the user explicitly chooses **Remember on this device**. API responses containing auth/sync state use `Cache-Control: no-store`.

## Data and rights boundary

WWM Atlas does **not** commit or mirror the upstream marker database, game artwork, or raster tile set into this repository. Marker metadata and tiles are loaded from compatibility sources at runtime. This keeps the project from republishing a third-party dataset whose reuse rights are not established.

Because auto-sync currently depends on the compatibility bridge, an upstream protocol or service change can break syncing even while the WWM Atlas frontend remains online. Replacing that bridge with a fully independent game-side integration is a separate future engineering problem, not something this project claims to have solved.

## Cloudflare Pages

Canonical deployment is `production/wwm-atlas` to Cloudflare Pages project `wwm-atlas-pnhd` using `.github/workflows/deploy-cloudflare-pages.yml`.

The workflow:

1. validates browser and Pages Function JavaScript;
2. builds a clean public `dist/`;
3. deploys `dist/` together with the root `functions/` bundle;
4. verifies `/`, `/map`, sync routing, relay discovery, marker data and security headers.

Required GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Never commit or paste those values into source files.

## Local development

A plain static server can render the shell, but Pages Functions are required for live compatibility sync. For complete local behavior, use a Cloudflare Pages/Wrangler development environment that serves the root `functions/` directory.

## Production

Canonical URL: `https://wwm-atlas-pnhd.pages.dev/`

Production is considered healthy only when both **Validate WWM Atlas** and **Deploy WWM Atlas to Cloudflare Pages** pass for the same production HEAD.
