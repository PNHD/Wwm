# WWM Atlas — Where Winds Meet map hub

Production-oriented, self-owned map companion for **Where Winds Meet**.

## What this project is

WWM Atlas avoids depending on the abandoned `wwmmap.pages.dev` application architecture. Instead it provides one stable shell with:

- **Official Map** as the primary real map source.
- **17173 CN** as a dense Chinese fallback.
- **MapGenie** as an English fallback.
- **Personal Overlay** for user-owned GeoJSON, filtering and completion tracking.
- Local-only quick notes and progress backup/restore.
- Vietnamese and English UI.
- `/map` routing for Cloudflare Pages.
- PWA shell caching.

The project intentionally **does not copy or mirror third-party marker databases, game artwork or map tiles**. Real map content is loaded from the selected provider, while personal state belongs to this site and stays in the browser.

## Run locally

```bash
python -m http.server 8080
```

Open `http://localhost:8080/`. The `/map` rewrite is a Cloudflare Pages routing rule; Python's basic HTTP server does not interpret `_redirects`.

## Cloudflare Pages

Static project. No build step is required.

- Canonical deployment: Wrangler direct upload from `.github/workflows/deploy-cloudflare-pages.yml`.
- The workflow creates a clean `dist/` containing only public static files, then deploys `dist/`.
- Do not publish the repository root as the production artifact.
- Production URL target: `https://<project>.pages.dev/map`.

The workflow requires repository Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` when no authenticated Cloudflare connector is available.

## Data contract

Personal datasets use GeoJSON `FeatureCollection` with `Point` features. See `docs/DATA_CONTRACT.md`.

## Status

**Production candidate.** Validation and deployment status are authoritative only after the GitHub Actions checks and live Cloudflare smoke test pass.
