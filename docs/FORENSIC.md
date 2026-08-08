# M0 forensic notes — 2026-08-08

## Confirmed observations

1. `https://wwmmap.pages.dev/` advertises a WebGL interactive map with 15,000+ POIs, local/community progress features, underground floors, comments and video.
2. `https://wwmmap.pages.dev/legacy-map` states that its data is sourced from 17173 and that the site does not hold rights to that data.
3. `https://wwmmap.pages.dev/map` currently exposes the UI shell to crawlers but does not expose a usable map dataset through the rendered HTML.
4. Third-party community discussion describes the newer WWM Map as using character verification/sync behavior and notes that its server can fail.
5. 17173's WWM interactive map is still publicly referenced by 17173 and community sources.
6. The official Where Winds Meet website also exposes an official interactive map tool.

## M0 decision

Do **not** make the new site depend on `wwmmap.pages.dev` APIs, its account flow, Discord verification, or any undocumented sync endpoint.

Do **not** bundle 17173 map artwork, POIs, screenshots, or other third-party assets until usage rights and an acceptable ingestion method are established.

Freeze a normalized local data contract first. Upstream data enters only through an explicit adapter/importer with provenance fields.

## Still unresolved

- Exact 17173 tile/image coordinate system.
- Exact 17173 endpoint(s) used for region metadata and POIs.
- Licensing/reuse terms for 17173 map data and imagery.
- Whether the official map exposes an authorized reusable dataset/API.
- Multi-floor representation and floor-coordinate relationship.

These are M1 forensic targets. They do not block validating the M0 frontend architecture.
