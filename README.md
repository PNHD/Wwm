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

Open `http://localhost:8080/index.html` (Cloudflare handles `/map` through `_redirects`).

## Cloudflare Pages

Static project. No build step is required.

- Build command: *(empty)*
- Build output directory: `/`
- Production URL target: `https://<project>.pages.dev/map`

For Wrangler direct-upload CI, see `.github/workflows/deploy-cloudflare-pages.yml`.

## Data contract

Personal datasets use GeoJSON `FeatureCollection` with `Point` features. See `docs/DATA_CONTRACT.md`.

## Status

**Production shell complete.** Cloudflare deployment is automated when the repository exposes `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.
