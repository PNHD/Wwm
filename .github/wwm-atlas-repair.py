from pathlib import Path
from textwrap import dedent


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing repair anchor: {label}")
    return text.replace(old, new, 1)


# app.js: repair registry parsing, category toggle semantics, imported-region selection,
# and external provider loading while preserving the existing architecture.
p = Path("app.js")
s = p.read_text(encoding="utf-8")
s = replace_once(s, "  categories: [],\n", "  categories: [],\n  categoryRegistry: [],\n", "category registry state")
s = replace_once(
    s,
    "function t(key) { return i18n[state.lang]?.[key] || i18n.vi[key] || key; }\n\nasync function loadJson(url) {",
    "function t(key) { return i18n[state.lang]?.[key] || i18n.vi[key] || key; }\n\nfunction registryItems(value, key) {\n  const items = Array.isArray(value) ? value : value?.[key];\n  if (!Array.isArray(items)) throw new Error(`Invalid ${key} registry`);\n  return items;\n}\n\nasync function loadJson(url) {",
    "registryItems helper",
)
s = replace_once(
    s,
    "function loadExternalSource(source) {\n  els.frameLoading.hidden = false;\n  els.mapFrame.src = 'about:blank';\n  els.openSource.href = source.url;\n  requestAnimationFrame(() => { els.mapFrame.src = source.url; });\n}",
    "function loadExternalSource(source) {\n  els.frameLoading.hidden = false;\n  els.openSource.href = source.url;\n  els.mapFrame.src = source.url;\n}",
    "external source load",
)
s = replace_once(
    s,
    "  const configured = new Map(state.categories.map((c) => [c.id, c]));",
    "  const configured = new Map(state.categoryRegistry.map((c) => [c.id, c]));",
    "effective category registry",
)
s = replace_once(
    s,
    "function renderCategories() {\n  state.categories = effectiveCategories();\n  const current = new Set(state.enabledCategories);\n  if (!current.size) state.categories.forEach((c) => state.enabledCategories.add(c.id));\n  else state.categories.forEach((c) => { if (!current.has(c.id)) state.enabledCategories.add(c.id); });\n\n  els.categoryList.replaceChildren();",
    "function renderCategories() {\n  state.categories = effectiveCategories();\n  const validIds = new Set(state.categories.map((category) => category.id));\n  state.enabledCategories = new Set([...state.enabledCategories].filter((id) => validIds.has(id)));\n\n  els.categoryList.replaceChildren();",
    "hide/show all semantics",
)
s = replace_once(
    s,
    "  if (state.importedDataset) {\n    const option = document.createElement('option'); option.value = '__imported__'; option.textContent = state.lang === 'vi' ? 'Dataset đã nhập' : 'Imported dataset';\n    els.regionSelect.prepend(option);\n  }\n}",
    "  if (state.importedDataset) {\n    const option = document.createElement('option'); option.value = '__imported__'; option.textContent = state.lang === 'vi' ? 'Dataset đã nhập' : 'Imported dataset';\n    els.regionSelect.prepend(option);\n  }\n  if (state.region?.id && [...els.regionSelect.options].some((option) => option.value === state.region.id)) {\n    els.regionSelect.value = state.region.id;\n  }\n}",
    "region selection preservation",
)
s = replace_once(
    s,
    "  const [sources, regions, categories] = await Promise.all([loadJson('/data/sources.json'), loadJson('/data/regions.json'), loadJson('/data/categories.json')]);\n  state.sources = sources; state.regions = regions; state.categories = categories;",
    "  const [sources, regions, categories] = await Promise.all([loadJson('/data/sources.json'), loadJson('/data/regions.json'), loadJson('/data/categories.json')]);\n  state.sources = registryItems(sources, 'sources');\n  state.regions = registryItems(regions, 'regions');\n  state.categoryRegistry = registryItems(categories, 'categories');\n  state.categories = [...state.categoryRegistry];",
    "boot registry normalization",
)
p.write_text(s, encoding="utf-8")


# Service worker: cache only successful responses and use the HTML shell fallback only
# for navigation requests, avoiding index.html responses for missing JS/data assets.
Path("sw.js").write_text(
    dedent(
        """\
        const CACHE = 'wwm-atlas-shell-v3';
        const SHELL = ['/', '/map', '/index.html', '/styles.css', '/app.js', '/bootstrap.mjs', '/manifest.webmanifest', '/data/sources.json', '/data/regions.json', '/data/categories.json', '/data/qinghe-demo.geojson', '/assets/map-placeholder.svg'];

        self.addEventListener('install', (event) => {
          event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
        });

        self.addEventListener('activate', (event) => {
          event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
        });

        self.addEventListener('fetch', (event) => {
          const url = new URL(event.request.url);
          if (url.origin !== location.origin || event.request.method !== 'GET') return;

          event.respondWith((async () => {
            try {
              const response = await fetch(event.request);
              if (response.ok) {
                const cache = await caches.open(CACHE);
                await cache.put(event.request, response.clone());
              }
              return response;
            } catch (error) {
              const cached = await caches.match(event.request);
              if (cached) return cached;
              if (event.request.mode === 'navigate') {
                const shell = await caches.match('/index.html');
                if (shell) return shell;
              }
              throw error;
            }
          })());
        });
        """
    ),
    encoding="utf-8",
)


Path("_headers").write_text(
    dedent(
        """\
        /*
          Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: blob:; connect-src 'self' https://unpkg.com; frame-src https://www.wherewindsmeetgame.com https://*.wherewindsmeetgame.com https://map.17173.com https://*.17173.com https://mapgenie.io https://*.mapgenie.io; worker-src 'self' blob:; manifest-src 'self';
          X-Content-Type-Options: nosniff
          Referrer-Policy: strict-origin-when-cross-origin
          Permissions-Policy: camera=(), microphone=(), geolocation=()
          Cross-Origin-Opener-Policy: same-origin-allow-popups

        /manifest.webmanifest
          Cache-Control: public, max-age=3600

        /sw.js
          Cache-Control: no-cache
        """
    ),
    encoding="utf-8",
)


# Strengthen CI so the wrapped region/category registry shape is enforced.
v = Path(".github/workflows/validate-wwm-map.yml")
vs = v.read_text(encoding="utf-8")
old = """          files = list(Path('data').glob('*.json')) + list(Path('data').glob('*.geojson'))
          for path in files:
              with path.open(encoding='utf-8') as handle:
                  doc = json.load(handle)
              if path.suffix == '.geojson':
                  assert doc.get('type') == 'FeatureCollection', f'{path}: expected FeatureCollection'
                  ids = [str(feature.get('id') or feature.get('properties', {}).get('id')) for feature in doc.get('features', [])]
                  assert len(ids) == len(set(ids)), f'{path}: duplicate POI ids'
              print('valid', path)
"""
new = """          files = list(Path('data').glob('*.json')) + list(Path('data').glob('*.geojson'))
          docs = {}
          for path in files:
              with path.open(encoding='utf-8') as handle:
                  doc = json.load(handle)
              docs[str(path)] = doc
              if path.suffix == '.geojson':
                  assert doc.get('type') == 'FeatureCollection', f'{path}: expected FeatureCollection'
                  ids = [str(feature.get('id') or feature.get('properties', {}).get('id')) for feature in doc.get('features', [])]
                  assert len(ids) == len(set(ids)), f'{path}: duplicate POI ids'
              print('valid', path)

          regions = docs['data/regions.json']
          categories = docs['data/categories.json']
          sources = docs['data/sources.json']
          assert isinstance(regions, dict) and isinstance(regions.get('regions'), list) and regions['regions'], 'regions registry invalid'
          assert isinstance(categories, dict) and isinstance(categories.get('categories'), list) and categories['categories'], 'categories registry invalid'
          assert isinstance(sources, list) and sources, 'sources registry invalid'
          for region in regions['regions']:
              assert region.get('id') and region.get('geojson'), f'invalid region entry: {region}'
          for category in categories['categories']:
              assert category.get('id') and category.get('name') and category.get('color'), f'invalid category entry: {category}'
"""
vs = replace_once(vs, old, new, "validation registry contract")
marker = "      - name: Validate routing and HTML\n"
insert = """      - name: Validate production security and bundle contract
        run: |
          set -euo pipefail
          grep -F "Content-Security-Policy:" _headers
          grep -F "frame-ancestors 'none'" _headers
          grep -F 'rel="noopener noreferrer"' index.html
          grep -F "const CACHE = 'wwm-atlas-shell-v3'" sw.js
          if grep -RInE '(AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z]{20,}|sk-[0-9A-Za-z]{20,})' index.html app.js bootstrap.mjs sw.js data assets; then
            echo 'Potential credential committed in production source.' >&2
            exit 1
          fi

"""
vs = replace_once(vs, marker, insert + marker, "validation security step")
v.write_text(vs, encoding="utf-8")


# Deployment validation mirrors the registry contract before preparing dist/.
d = Path(".github/workflows/deploy-cloudflare-pages.yml")
ds = d.read_text(encoding="utf-8")
old = """          for path in list(Path('data').glob('*.json')) + list(Path('data').glob('*.geojson')):
              with path.open(encoding='utf-8') as handle:
                  json.load(handle)
              print('valid', path)
"""
new = """          docs = {}
          for path in list(Path('data').glob('*.json')) + list(Path('data').glob('*.geojson')):
              with path.open(encoding='utf-8') as handle:
                  docs[str(path)] = json.load(handle)
              print('valid', path)
          assert isinstance(docs['data/regions.json'].get('regions'), list), 'regions registry invalid'
          assert isinstance(docs['data/categories.json'].get('categories'), list), 'categories registry invalid'
          assert isinstance(docs['data/sources.json'], list), 'sources registry invalid'
"""
ds = replace_once(ds, old, new, "deployment registry contract")
d.write_text(ds, encoding="utf-8")


# Bring documentation in line with the actual production contract.
r = Path("README.md")
rs = r.read_text(encoding="utf-8")
rs = replace_once(
    rs,
    "Open `http://localhost:8080/index.html` (Cloudflare handles `/map` through `_redirects`).",
    "Open `http://localhost:8080/`. The `/map` rewrite is a Cloudflare Pages routing rule; Python's basic HTTP server does not interpret `_redirects`.",
    "README local route",
)
rs = replace_once(
    rs,
    "- Build command: *(empty)*\n- Build output directory: `/`\n- Production URL target: `https://<project>.pages.dev/map`\n\nFor Wrangler direct-upload CI, see `.github/workflows/deploy-cloudflare-pages.yml`.",
    "- Canonical deployment: Wrangler direct upload from `.github/workflows/deploy-cloudflare-pages.yml`.\n- The workflow creates a clean `dist/` containing only public static files, then deploys `dist/`.\n- Do not publish the repository root as the production artifact.\n- Production URL target: `https://<project>.pages.dev/map`.\n\nThe workflow requires repository Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` when no authenticated Cloudflare connector is available.",
    "README deployment contract",
)
rs = replace_once(
    rs,
    "**Production shell complete.** Cloudflare deployment is automated when the repository exposes `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.",
    "**Production candidate.** Validation and deployment status are authoritative only after the GitHub Actions checks and live Cloudflare smoke test pass.",
    "README status",
)
r.write_text(rs, encoding="utf-8")


dc = Path("docs/DATA_CONTRACT.md")
dcs = dc.read_text(encoding="utf-8")
dcs = replace_once(
    dcs,
    "`data/regions.json` contains stable region IDs and the assets needed to render a region.",
    "`data/regions.json` is a versioned registry object with a `regions` array containing stable region IDs and the assets needed to render a region. `data/categories.json` follows the same pattern with a `categories` array.",
    "data contract registries",
)
dcs = replace_once(
    dcs,
    "Browser progress uses localStorage key `wwm-map-progress:v1`:\n\n```json\n{\n  \"schemaVersion\": 1,\n  \"completedIds\": [\"qinghe-chest-000123\"]\n}\n```\n\nExport files add `exportedAt`. Completion is keyed only by normalized POI ID, so a future backend sync can reuse the same identifier without changing the UI.",
    "Browser state uses localStorage key `wwm-atlas-state:v2`:\n\n```json\n{\n  \"schemaVersion\": 2,\n  \"lang\": \"vi\",\n  \"activeSource\": \"personal\",\n  \"notes\": \"\",\n  \"completedIds\": [\"qinghe-chest-000123\"],\n  \"hideCompleted\": false\n}\n```\n\nImported user GeoJSON is stored separately under `wwm-atlas-dataset:v1`. Export files add `exportedAt`. Completion is keyed only by normalized POI ID, so a future backend sync can reuse the same identifier without changing the UI.",
    "data contract persistence",
)
dc.write_text(dcs, encoding="utf-8")
