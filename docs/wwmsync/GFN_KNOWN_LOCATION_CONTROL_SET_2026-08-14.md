# WWMSync — GFN Known-Location Control Set Design

Date: 2026-08-14

Status: **FROZEN PRE-ACQUISITION**

Scope: replay/data-design only. No new owner HUD recording existed or was inspected during selection. No matcher experiment was run. The production structural gate remains `0.58`.

Machine-readable source of truth:

`docs/wwmsync/gfn-known-location-control-set.json`

Committed semantic SHA-256:

`1a234c15aa9ba69049372c786153ab1a345cdc2144813d9db6c7310ba74e82d1`

## 1. Starting state and guardrails

Verified starting HEAD before any write:

`4b5faf35eafe8fc058e398609f961a9c31b75d87`

Protected production files are unchanged relative to that starting HEAD:

- `vision-sync.js`
- `dashen-tile-cache.js`
- `tools/build_dashen_visual_cache.py`

Protected starting blob SHAs:

- `vision-sync.js`: `58b5a1babf6a12b944f9b745b8bf7f7df573bf9b`
- `dashen-tile-cache.js`: `9388960a8bff53a9cfc7471372af144b7a28c34f`
- `tools/build_dashen_visual_cache.py`: `1a227d06ae41660ea3e3b832e7f1921cc507c0d7`

Forbidden production changes were not performed: matcher architecture, structural gate, intensity gate, beam width, preprocessing, learned models, `main`, and `production/wwsync` are untouched.

## 2. Source-catalog provenance

The control set uses the already established Dashen/first-party metadata lineage rather than matcher output.

Dashen main-map catalog:

- mapId: `676d48a37d299d0811946ff1`
- catalog endpoint: `https://inf.ds.163.com/v1/web/game-map/point/list-by-sub-types`
- selected family: `mapSubType=1`, `layer=0`, teleport series `2`

First-party Global catalogs used for independent lineage confirmation:

- Qinghe: Global `mapId=1`
- Kaifeng: Global `mapId=2`
- Chinese catalog is exact-name joined to Dashen.
- English catalog supplies the acquisition-facing localized name.
- Global encoded coordinates are decoded independently and checked against the established affine bridge.
- Maximum accepted bridge residual: `5e-5`.

Reference raster family:

`dashen-main-v15-z5`

Tile template:

`https://img.166.net/canonical/h72/tilemap/v15.0/5/{x}_{y}.png?imageView&v=1`

Catalog digests at design time:

| Catalog | SHA-256 |
|---|---|
| Dashen map12 | `22f614f1101b78f818bd02ef24a28dd23f93bd98067212bf5866cd358eb76b6e` |
| Global Qinghe zh-CN | `61aa081e87056309fe84e3cb4cbbea878fd6dfbf56b2066642d313e0e62590dc` |
| Global Qinghe en-US | `6fe321fe2be5cad595bb6d0ac5fc305f8e50fd793dcd22b8f9c98f1f49d27b1c` |
| Global Kaifeng zh-CN | `dbd52d3725c30b835441d2e021fc98a289b6d6fcf3016a69a58a3061555a02bf` |
| Global Kaifeng en-US | `06e7951b938068b325dc0f2a86a3d320fa7a06502635261e7b026f970a580c20` |

Reference tile set: 424 tiles; digest `c0bf561a14a5710d8e7f3945f9a4ba4423d3efd74bd07db1ffd1d3dcf1e1407c`.

## 3. Candidate pool

- Independent main-map lineage eligible before existing-control exclusions: **109**.
- After East/General/Fang neighborhood exclusion and unambiguous acquisition-name filtering: **62**.
- Generic English acquisition labels excluded: **5**.
- Rejected lineage records after the residual/name checks: **0**.

Generic labels excluded before freezing included `Boundary Stone`, `Waystone`, `Teleport`, and `Teleport Point`. This was an acquisition-identity rule applied before any new owner HUD data existed.

## 4. Reference-only morphology descriptor

Every eligible candidate uses a 256×256 reference patch centered on the independently computed z5 GT coordinate.

Metrics are bounded reference-only measurements:

- `edgeDensity`: Canny edge occupancy.
- `featureDensity`: ORB keypoint count normalized/clipped at 450.
- `entropy`: grayscale Shannon entropy divided by 8.
- `quietSpaceOccupancy`: fraction with Sobel magnitude < 18.
- `orientationEntropy`: 12-bin magnitude-weighted gradient-orientation entropy normalized by `log2(12)`.
- `lineDensity`: Hough segment length normalized by patch area.
- `radialEdgeImbalance`: coefficient of variation of edge density over four radial annuli, clipped to [0,1].
- `localSelfSimilarity`: maximum normalized translated-edge autocorrelation for fixed 32/48/64 px shifts.
- `nearestNeighborAmbiguity`: maximum cosine similarity of the fixed 4×4×8 HOG-like descriptor to another eligible teleport neighborhood.
- `wrongNeighborhoodAmbiguity`: maximum descriptor cosine to deterministic sampled wrong neighborhoods at least 384 z5 px away.
- `structuralUniqueness`: `1 - max(nearestNeighborAmbiguity, wrongNeighborhoodAmbiguity)`.

No future owner HUD pixels are involved.

## 5. Frozen selection rule

Pre-acquisition constraints:

- Existing East Cross / General's Shrine exact point IDs excluded.
- Any candidate within 320 z5 px of East Cross, General's Shrine, or independent Fang Xu GT excluded.
- English acquisition identity must be unambiguous.
- Selected same-region pair distance must be at least 360 z5 px.
- Selected descriptor cosine must not exceed 0.965.

Stratified optimization:

1. maximize bounded structural-uniqueness composite;
2. maximize the same composite in the other Qinghe/Kaifeng region context;
3. select moderate urban density with catalog-semantic support;
4. select a water/boundary identity and boundary-oriented reference morphology;
5. maximize quiet/sparse morphology;
6. maximize ambiguity/repetition while excluding water/boundary semantics already represented by Control 4.

The six controls below cannot be swapped because later HUD results are inconvenient.

## 6. Frozen controls

### GFN-KL-01 — Encircling Lake / 抱山湖

- pointId: `20143`
- region: Qinghe
- mapId: `676d48a37d299d0811946ff1`
- mapSubType: `1`
- world: `(-938.510009765625, -1920.80004882812)`
- z5: `(5575.19559314954, 4352.165726817045)`
- nearby disambiguator: Back Mountain / 别馆后山 (`20124`)
- stratum: **high-uniqueness / structurally distinctive**
- uniqueness: `0.19382566`
- edge / feature: `0.05191040 / 1.00000000`
- line density: `0.03195104`
- quiet occupancy: `0.65827942`
- nearest / wrong ambiguity: `0.79015410 / 0.80617434`

Rationale: strongest selected high-uniqueness control with substantial feature support; independent metadata lineage, not matcher-derived GT.

### GFN-KL-02 — Bloodscale Hall / 赤龙堂

- pointId: `20218`
- region: Kaifeng
- mapId: `676d48a37d299d0811946ff1`
- mapSubType: `1`
- world: `(403.9825, -2660.5408)`
- z5: `(5000.96320802005, 4035.751971929824)`
- nearby disambiguator: Heavenfall Crossing / 天上来渡 (`20217`)
- stratum: **high-uniqueness / different region-context**
- uniqueness: `0.14274520`
- edge / feature: `0.09596252 / 1.00000000`
- line density: `0.18776356`
- quiet occupancy: `0.56884766`
- nearest / wrong ambiguity: `0.85348743 / 0.85725480`

Rationale: the independent high-information control in the other region context; notably higher road/line density than the other selected points.

### GFN-KL-03 — North Wansheng Town / 万胜镇北

- pointId: `20223`
- region: Kaifeng
- mapId: `676d48a37d299d0811946ff1`
- mapSubType: `1`
- world: `(768.8906, -1603.545)`
- z5: `(4844.878874519632, 4487.867134502923)`
- nearby disambiguator: South Wansheng Town / 万胜镇南 (`20224`)
- stratum: **moderate-density urban**
- edge / feature: `0.05400085 / 1.00000000`
- entropy: `0.83749163`
- line density: `0.04218415`
- quiet occupancy: `0.51136780`
- uniqueness: `0.10360777`

Rationale: urban/building-density proxy without simply taking the absolute densest reference patch.

### GFN-KL-04 — Harborlink Crossing / 临津渡

- pointId: `20254`
- region: Kaifeng
- mapId: `676d48a37d299d0811946ff1`
- mapSubType: `1`
- world: `(-638.0265, -585.2726)`
- z5: `(5446.667976608187, 4923.41890459482)`
- nearby disambiguator: Sorrowfield Village / 达安村 (`20250`)
- stratum: **water / strong boundary geometry**
- quiet occupancy: `0.67451477`
- radial edge imbalance: `0.65488667`
- self-similarity: `0.10430181`
- uniqueness: `0.15405619`

Rationale: independently named crossing/water-associated point with a strong boundary-like radial distribution.

### GFN-KL-05 — Thousand-Buddha Vale / 千佛谷

- pointId: `20114`
- region: Qinghe
- mapId: `676d48a37d299d0811946ff1`
- mapSubType: `1`
- world: `(-1232.8174, -3897.604)`
- z5: `(5701.081460985797, 3506.615498746867)`
- nearby disambiguator: Path of Void / 缘尽去路 (`20121`)
- stratum: **quiet / sparse geometry**
- edge density: `0.01252747`
- feature density: `0.72000000`
- line density: `0.00000000`
- quiet occupancy: `0.69107056`
- uniqueness: `0.12476021`

Rationale: sparse tail control, intended to stress low-information recall and acceptance behavior.

### GFN-KL-06 — Emperor Chai Temple / 柴王庙

- pointId: `20135`
- region: Qinghe
- mapId: `676d48a37d299d0811946ff1`
- mapSubType: `1`
- world: `(-1002.71997070312, -3024.9599609375)`
- z5: `(5602.66050543024, 3879.876775271512)`
- nearby disambiguator: Moonveil Stream / 隐月山涧 (`20139`)
- stratum: **repetitive / ambiguous geometry**
- self-similarity: `0.04592135`
- nearest-neighbor ambiguity: `0.91051227`
- wrong-neighborhood ambiguity: `0.89168298`
- structural uniqueness: `0.08948773`
- radial edge imbalance: `1.00000000`

Rationale: ambiguity-tail control with a specific acquisition-facing name. A generic `Boundary Stone` candidate was intentionally rejected before freezing because its identity was not sufficiently actionable for the owner.

## 7. Morphology diversity matrix

Values are pairwise cosine similarities of the fixed reference descriptor. All selected off-diagonal pairs remain below the preregistered 0.965 cap.

| | KL-01 | KL-02 | KL-03 | KL-04 | KL-05 | KL-06 |
|---|---:|---:|---:|---:|---:|---:|
| KL-01 | 1.000000 | 0.642834 | 0.635584 | 0.666530 | 0.683979 | 0.673117 |
| KL-02 | 0.642834 | 1.000000 | 0.763489 | 0.635868 | 0.842418 | 0.853487 |
| KL-03 | 0.635584 | 0.763489 | 1.000000 | 0.769045 | 0.729343 | 0.773134 |
| KL-04 | 0.666530 | 0.635868 | 0.769045 | 1.000000 | 0.634468 | 0.672333 |
| KL-05 | 0.683979 | 0.842418 | 0.729343 | 0.634468 | 1.000000 | 0.814422 |
| KL-06 | 0.673117 | 0.853487 | 0.773134 | 0.672333 | 0.814422 | 1.000000 |

Same-region z5 separations relevant to the frozen diversity rule:

- KL-01 ↔ KL-05: `854.870`
- KL-01 ↔ KL-06: `473.087`
- KL-05 ↔ KL-06: `386.019`
- KL-02 ↔ KL-03: `478.300`
- KL-02 ↔ KL-04: `993.280`
- KL-03 ↔ KL-04: `742.870`

## 8. Evidence the six are not East / General / Fang

Existing controls are explicitly excluded from the new set:

- East Cross Street: pointId `20212`, Kaifeng z5 `(5219.931321637427, 4648.817136173768)`.
- General's Shrine: pointId `20102`, Qinghe z5 `(6015.017126148705, 3889.360588972433)`.
- Steam Fang Xu independent non-owner GT: Qinghe z5 `(5983.1277673350005, 3862.4348370927314)`.

The selection additionally excludes a 320 z5-pixel neighborhood around each applicable existing control, so the new controls are not merely nearby morphological duplicates of the existing GTs.

## 9. Frozen one-video acquisition order

Record the points in this exact order:

1. **Encircling Lake** — Qinghe — near Back Mountain.
2. **Emperor Chai Temple** — Qinghe — near Moonveil Stream.
3. **Thousand-Buddha Vale** — Qinghe — near Path of Void.
4. **Bloodscale Hall** — Kaifeng — near Heavenfall Crossing.
5. **North Wansheng Town** — Kaifeng — near South Wansheng Town.
6. **Harborlink Crossing** — Kaifeng — near Sorrowfield Village.

This groups the three Qinghe controls followed by the three Kaifeng controls for a practical continuous recording while preserving the frozen IDs.

## 10. Exact owner recording protocol

Use **one continuous original GFN recording**. High graphics settings are acceptable and preferred for consistency with previous owner controls. No fixed screen resolution is required.

At each frozen point:

1. Open the world map.
2. Find the exact named teleport point above; use the nearby landmark only to disambiguate.
3. Visibly select the frozen teleport point.
4. Keep that selection visibly on screen for about 1 second.
5. Teleport.
6. Close the world map.
7. Do **not** move the character/camera intentionally.
8. Wait until the HUD/minimap has visibly settled.
9. Remain stationary for about 2–3 seconds.
10. Open the map and continue to the next frozen point in the listed order.

Do not repeat East Cross Street, General's Shrine, or Fang Xu in this acquisition.

## 11. Preregistered later classification

Every future owner GFN control must be replayed through the same frozen production forensic pipeline and classified as one of:

- `RCL-1` — coarse recall failure
- `RCL-2` — beam/NMS/dedupe failure
- `RCL-3` — fine-ranking / pose-survival failure
- `RCL-4` — final-gate failure
- `RCL-5` — local discrimination failure
- `RCL-MIXED`

A new failure class must not be invented simply to improve narrative fit. If later evidence truly requires a new class, that exception must be documented explicitly.

## 12. Sample-size and uncertainty preregistration

Six new owner controls plus existing East Cross and General's Shrine produce **8 owner GFN known-location controls**.

Fang Xu remains an independent non-owner control and is not included in the owner-frequency denominator.

For every failure class the later audit must report:

- count / 8;
- Wilson 95% interval or equivalent descriptive uncertainty;
- morphology association;
- whether the class occurs across multiple morphology strata.

No population-prevalence claim may be made from `n=8`; this is architecture-selection evidence only.

## 13. Architecture decision preregistration

**A1 — Dominant recall/pose class**  
If a common recall/pose-survival class appears across multiple new independent controls and materially dominates the other mechanisms, a bounded architecture round targeting that class becomes justified.

**A2 — Dominant local-discrimination class**  
If `RCL-5` dominates across diverse controls, candidate beam/search changes are deprioritized and representation/scoring becomes the primary research direction.

**A3 — Dominant final-gate/intensity class**  
If structurally correct basins frequently survive but consistently fail a secondary acceptance signal, investigate that signal causally. Do not lower gates automatically.

**A4 — Heterogeneous**  
If multiple failure classes remain common with no dominant mechanism, do not search for a universal one-knob fix. The next architecture must explicitly support heterogeneous failure modes.

## 14. Freeze evidence

The final pre-freeze acquisition-policy discovery run was:

- run: `31778686175`
- job: `94699499763`
- artifact: `9210850212`
- artifact digest: `sha256:ab59cfe2becb87f5dd3f0f4359e4a71eec642f862fb0130aefb52b9acfc05a1f`
- discovery HEAD: `bcfd37aac56edfa3aa88df9d88ca271039ac7b6b`
- generated discovery-manifest SHA: `d4085ae6ca3c89e8e2389732377938d554a603af167677252aad8b2d29073021`

The compact committed manifest retains all frozen scientific fields and source digests, and has semantic SHA:

`1a234c15aa9ba69049372c786153ab1a345cdc2144813d9db6c7310ba74e82d1`

After this freeze, CI is verification-only: recompute from the same current catalogs/reference family and reject any scientific-field mismatch. It must not choose replacement locations based on owner HUD outcomes.
