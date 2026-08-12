# WWMSync HUD / Capture / Content-Lineage Discrimination Audit

Date: 2026-08-12

Branch: `feature/wwm-native-sync-v2`

## Scope and guardrails

This round tests the remaining hypotheses after the reference-domain truth audit:

- H1 — normal gameplay HUD minimap rendering is not sufficiently compatible with the current Dashen/full-map reference representation for production global candidate recall.
- H2 — a normal current Global PC HUD is localizable, but GeForce NOW / capture degradation destroys recall.
- H3 — normal current Global HUDs are localizable, but the exact real GFN fixture belongs to a missing region/layer/world-state/map revision/content lineage.

Production constraints remained frozen:

- structural gate = `0.58`
- no production matcher changes
- no production cache changes
- no score inflation or threshold lowering
- no manual-anchor dependency
- no DD/native/memory work
- no `main` or `production/wwsync` work
- all new code in this round is replay/CI-only or documentation

Starting branch HEAD was verified before work:

`d7e7ef3ac0f0dbd7e347bf722a65c32a6952f9e0`

## Previous positive control retained

The previous independently located in-game FULL-MAP General Shrine control remains the positive control for the public reference pipeline.

Expected General Shrine reference point:

- world: `(-1966.7646484375, -3002.78784179687)`
- Dashen z5: `(6015.017126148705, 3889.360588972433)`

Unchanged production global TOP-K contained the expected basin:

- rank: 4
- expected distance: `77.6125` z5 px
- coarse: `0.654439`
- raw structure: `0.644920`
- scale-aware structure: `0.626976`
- intensity: `0.704469`
- NCC: `0.660140`
- combined: `0.633175`
- angle: `160 deg`
- scale: `2.58321`
- matchGate: PASS

Therefore the full-map/Dashen reference pipeline remains a positive-control PASS. This does not prove that normal HUD artwork/LOD/content is equivalent to full-map artwork.

## Public HUD source mining

### Accepted control

#### Steam Global PC — General Shrine / Fang Xu scaffolding

Discussion:

`https://steamcommunity.com/app/3564740/discussions/0/816973559978006971/`

Accepted gameplay image:

`https://images.steamusercontent.com/ugc/10569571512717672614/71F9D2DBF4526171F082F9D0330C177057F2E5C4/`

Publication/test statement date: 2026-01-16.

The poster states they ran to General Shrine to test the Fang Xu encounter and then supplied four screenshots. All four images were inspected. Only the first image is normal gameplay with the actual HUD minimap visible; the other three are dialogue/combat/result states without a usable normal HUD minimap and were rejected.

Accepted image byte provenance:

- dimensions: `1920 x 1080`
- bytes: `454486`
- SHA-256: `d6c719dd6de0d64b7fce71b54bcc8796048ead2e4caf9c8d2df6f8ea429092f0`
- lineage: Steam Global PC, HIGH confidence

Visual inspection of the full screenshot confirms the player is immediately adjacent to the visible `Fang Xu` NPC label on the arena/scaffolding scene. The minimap is the normal circular top-left gameplay HUD, with terrain, player marker, border and dynamic icons/labels.

### Independent ground truth for accepted control

The matcher was not used to establish the coordinate.

Dashen point API evidence was queried independently from:

`https://inf.ds.163.com/v1/web/game-map/point/list-by-sub-types`

Query contract:

- mapId: `676d48a37d299d0811946ff1`
- subTypes: `[1, 2]`
- mapZone: `map12`
- raw API evidence SHA-256: `22f614f1101b78f818bd02ef24a28dd23f93bd98067212bf5866cd358eb76b6e`

Exact named point:

- name: `方旭` / Fang Xu
- pointId: `12_41`
- layer: `0`
- mapSubType: `1`
- world: `(-1892.21081542968, -3065.7373046875)`
- expected Dashen z5: `(5983.1277673350005, 3862.4348370927314)`
- accepted expected-basin uncertainty radius: `60` z5 px = `140.2734375` world units

The uncertainty radius is deliberately conservative because the screenshot establishes the player in the Fang Xu scaffolding encounter scene, not a guaranteed pixel-identical player/NPC coordinate. It is not matcher-derived.

### Exact HUD ROI reconstruction

The unchanged production ROI contract in `vision-sync.js` is:

- `unit = min(videoWidth, videoHeight)`
- default `roiFraction = 0.25`
- default ROI center = `(unit * 0.125, unit * 0.125)`
- therefore default semantic ROI begins at source `(0, 0)`
- work canvas = `192 x 192`

For the Steam `1920 x 1080` control:

- raw semantic source ROI = `[0, 0, 270, 270]`
- baseline input = raw 270x270 ROI resized exactly as the replay production path to 192x192
- no manual beautification

For the exact GFN `2048 x 864` fixture:

- raw semantic source ROI = `[0, 0, 216, 216]`
- same 192x192 work canvas

### Other public sources inspected and rejected

The mining did not stop after the Steam control. Sources were inspected across Steam, current guide sites, YouTube-derived guide frames, Game8, GameTrek, NerdsChalk, AllThings.How, GamesRecon, Zilliongamer, Fandom metadata, current official/global material leads, and CN/console/Bilibili leads.

Representative rejected sources/reasons:

1. Steam Fang Xu images #2-#4 from the accepted discussion: no normal gameplay HUD minimap.
2. NerdsChalk, `A Guide to Life`:
   `https://nerdschalk.com/a-guide-to-life-walkthrough-where-winds-meet/`
   Strong Grand Imperial Temple/Boundary Stone context, but candidate raw image endpoints were not retrievable by the CI miner, so image bytes/HUD semantics could not be verified.
3. NerdsChalk, `A Savory Revelation`:
   `https://nerdschalk.com/a-savory-revelation-wandering-tale-where-winds-meet/`
   Strong Peace Bell Tower context, but candidate raw image endpoints were not retrievable by the CI miner.
4. NerdsChalk, `A Study in Slacking`:
   `https://nerdschalk.com/where-winds-meet-a-study-in-slacking-location-rewards-how-to-start-and-complete-it/`
   Strong East Cross Street Boundary Stone context and YouTube-frame provenance, but the exposed raw frame endpoints could not be fetched/verified in the available retrieval path. Caption-only provenance is insufficient for a control.
5. WhereWindsMeetGuide General Shrine Cat Play video page:
   `https://www.wherewindsmeetguide.com/guides/272`
   and Peace Bell Tower Oddity video page:
   `https://www.wherewindsmeetguide.com/guides/105`
   These are location-specific video leads, but the indexed page did not expose independently addressable video frames with exact frame-level ground truth suitable for byte-verified matcher replay.
6. Current GameTrek / AllThings.How location-specific guide screenshots inspected for Fairgrounds/East Cross Street, Peace Bell Tower and Grand Imperial Temple were dialogue/combat/map states without the normal circular gameplay minimap.
7. Current Game8 Boundary Stone/quest pages provide strong location metadata, but sampled images are map/guide assets or cannot be byte-verified as normal gameplay HUD controls.
8. Zilliongamer surfaced current HUD/minimap imagery, but the candidate HUD image did not have sufficiently independent frame-level coordinate ground truth.
9. Generic Steam current gameplay screenshots can contain HUD but do not establish a sufficiently narrow independent coordinate.
10. CN-client, Bilibili, console/PS5 and underground/special-instance images were not silently mixed with Global PC controls; lineage mismatch or special-map context caused rejection.

Result: only one current, byte-verified, independently located Global PC normal-HUD control was accepted. The requested target of >=3 independent controls could not be met from credible public evidence.

## Unchanged production matcher result — Steam/Fang Xu HUD

Classification rule used in CI:

A HUD control is PASS only if the expected independently known-coordinate basin surfaces in production global TOP-K and that expected basin itself passes the unchanged matchGate. A fixed-coordinate diagnostic sweep cannot turn a global recall failure into PASS.

Steam/Fang Xu classification: `HUD-FAIL`.

Global coarse winner:

- coarse score: `0.6597964678`
- coarse margin: `0.0320877721`

Global finalist winner was a false basin:

- rank: 1
- x/y: `(5218.3, 4015.3)`
- expected distance: `779.955` z5 px
- coarse: `0.659796`
- raw structure: `0.671401`
- scale-aware structure: `0.635447`
- intensity: `0.793285`
- NCC: `0.762277`
- combined: `0.648074`
- angle: `100.5 deg`
- scale: `2.67836`
- matchGate: PASS

Expected Fang Xu basin within 60 z5 px: NOT PRESENT in TOP-8.

TOP-8 expected distances / scale-aware scores:

| Rank | Distance z5 px | Scale-aware structure | Gate |
|---:|---:|---:|---|
| 1 | 779.955 | 0.635447 | PASS |
| 2 | 275.851 | 0.624461 | PASS |
| 3 | 888.101 | 0.606108 | PASS |
| 4 | 542.150 | 0.598325 | PASS |
| 5 | 521.905 | 0.590699 | PASS |
| 6 | 288.713 | 0.564530 | FAIL |
| 7 | 241.641 | 0.546579 | FAIL |
| 8 | 279.519 | 0.532790 | FAIL |

Matcher input quality for this HUD:

- structural positive features: `42`
- negative features: `24`
- normalized contrast: `0.500435`

Known-coordinate fixed diagnostic, explicitly NOT acceptance evidence:

- exact Fang Xu local sweep best radius: `96`
- scale: `2.4`
- angle: `60 deg`
- raw structure: `0.603392`
- scale-aware structure: `0.599451` (> 0.58)
- intensity: `0.574096`
- NCC: `0.510211`
- combined: `0.597423`
- fixed diagnostic gate: PASS

Interpretation: the expected Fang Xu reference neighborhood can produce a locally viable structural comparison at an appropriate radius/angle, but unchanged production global candidate recall/ranking does not surface that basin in TOP-8. The observed normal-HUD failure is therefore at expected-basin global recall/surfacing, not evidence that gate 0.58 needs to be lowered.

## HUD versus full-map result

At approximately the same General Shrine semantic region:

- independently registered FULL-MAP control: expected basin surfaces and passes production matchGate.
- Steam Global PC normal HUD control: expected Fang Xu basin does not surface in production TOP-8.

This is direct evidence that full-map positive-control compatibility does not imply normal-HUD global recall compatibility.

It is H1-indicative, but one Global PC HUD control is not enough to satisfy the predeclared H1 acceptance rule requiring multiple independent normal-current-Global HUD failures.

## PC HUD versus exact GFN capture-domain characterization

The exact GFN release asset was re-resolved by asset ID and SHA-256 before comparison:

- asset ID: `511291145`
- name: `wwmsync-gfn-motion-20260810-143835.zip`
- SHA-256: `aa14ce0e703d0af5c4c86946f2932b465f8a7fd529001cd1900b3b99b501a216`
- 40 frames
- 5 FPS / 200 ms
- source: `2048 x 864`

Descriptive 192x192 work-canvas metrics:

| Metric | Steam Global PC HUD | GFN median | GFN / PC |
|---|---:|---:|---:|
| luminance std | 0.198279 | 0.165888 | 0.83664 |
| p90-p10 luminance | 0.501961 | 0.446471 | 0.88945 |
| Laplacian variance | 0.123252 | 0.083262 | 0.67555 |
| Sobel mean | 0.154360 | 0.165945 | 1.07506 |
| 8x8 boundary/interior ratio | 1.056823 | 1.132756 | 1.07185 |
| chroma magnitude | 6.89688 | 7.60403 | 1.10253 |
| mean HSV saturation | 97.1782 | 36.7267 | 0.37793 |
| strong-edge halo proxy | 0.778263 | 0.648111 | 0.83277 |

GFN temporal descriptive proxies:

- median mean-absolute frame delta: `7.8869`
- p90 mean-absolute frame delta: `15.1954`
- median temporal residual 8x8 boundary excess: `0.440914`

These metrics show material B-vs-C representation differences, including lower Laplacian energy, higher relative 8x8 boundary signature and much lower mean saturation in this comparison. They do not identify a specific codec/scaler/gamma cause, and the temporal residual includes real scene/minimap motion.

Causal restriction: because the normal Steam PC HUD control itself is `HUD-FAIL`, this PC-vs-GFN pair cannot establish H2 as the cause of recall failure. GFN degradation is not a valid explanatory intervention until a known-location normal-PC HUD first passes.

## Controlled degradation and normalization

Phase 7 controlled GFN-like degradation: NOT RUN / NOT JUSTIFIED.

Reason: prerequisite `known normal PC HUD control = PASS` was not satisfied.

Phase 8 normalization: NOT RUN / NOT JUSTIFIED.

Reason: the required chain `normal HUD PASS -> realistic degradation reproduces expected-basin failure` was not established. Running normalization now would risk optimizing against a failure already present before GFN.

No production preprocessing is justified.

## H1 / H2 / H3 decision

Formal verdict:

`CASE INSUFFICIENT PUBLIC EVIDENCE — H1-INDICATIVE`

- H1: supported directionally by one strong Steam Global PC known-location HUD-FAIL while the full-map positive control passes. NOT promoted to H1 because the predefined rule requires multiple independent current Global HUD controls.
- H2: not causally testable yet. The normal-PC control already fails before GFN degradation, so controlled degradation/normalization would not discriminate H2.
- H3: not promoted. The H3 branch requires normal Global HUD controls to pass and controlled GFN-like degradation to fail to explain the real fixture. Those prerequisites are absent.

Exact remaining failure stage:

`normal-HUD expected-basin global candidate recall / surfacing`

The real GFN fixture remains `NO TRUE-LIKE CANDIDATE` across full-main replay. The new evidence establishes that at least one known-location normal Steam Global PC HUD can exhibit the same high-level global-recall problem even though its correct neighborhood is locally structurally viable.

## Production decisions

- Production structural gate `0.58`: unchanged and must remain unchanged.
- Production preprocessing justified: NO.
- Production matcher change justified: NO, because evidence has not generalized across multiple known-location Global HUD controls.
- Production cache change justified: NO.
- Manual anchor dependency: NO.
- Ordinary live E2E: still NOT JUSTIFIED.

## Smallest owner acquisition now required

Public evidence was exhausted without obtaining multiple independently located Global PC normal-HUD controls. The smallest next acquisition is not a generic live test.

### Stage A — two native/current Global PC still screenshots only

1. Qinghe — stand exactly at the `General's Shrine / 将军祠` Boundary Stone.
   - independent world coordinate: `(-1966.7646484375, -3002.78784179687)`
   - expected Dashen z5: `(6015.017126148705, 3889.360588972433)`
   - one full-screen still screenshot
   - player stationary
   - normal gameplay HUD/minimap fully visible
   - default/native UI; do not hide UI, use photo mode, open map, or manually change minimap visibility
   - no movement sequence required
   - no map-screen screenshot required

2. Kaifeng — stand exactly at the `East Cross Street / 东十字街` Boundary Stone.
   - independent Dashen API pointId: `20212`
   - world coordinate: `(-107.941, -1227.2615)`
   - expected Dashen z5: `(5219.931321637427, 4648.817136173768)`
   - one full-screen still screenshot
   - same stationary / full HUD requirements
   - no map-screen screenshot required

Why exactly these two: they add one Qinghe and one Kaifeng known-coordinate normal-PC control with independent point ground truth and no matcher-derived coordinate. If both fail expected-basin surfacing while the full-map positive control passes, H1 becomes justified. If either passes, H1 is not a general explanation and a controlled paired GFN experiment becomes justified.

If a native/current Global PC client is genuinely unavailable, this discrimination is externally blocked; do not substitute an ordinary unknown-location GFN live E2E.

### Stage B — only if at least one Stage-A local HUD control passes

At the same passing Boundary Stone, acquire one paired GFN capture while the character remains stationary:

- duration: 3-5 seconds
- minimap continuously visible
- no movement
- no camera rotation if avoidable
- 5 FPS equivalent is sufficient (~15-25 analysis frames)
- no map-screen capture required

This creates a same-location PC-HUD versus GFN control. Only then is controlled degradation/normalization an evidence-valid H2 experiment. If both local and same-location GFN pass while the original real fixture remains no-TRUE-like, H3 becomes primary.

## Replay/CI-only commits in this round

1. `8e83378f16fa81e51b81819e7bb83fe4985a6fe1` — `ci(replay): mine public HUD control evidence`
   - added public source miner and replay CI workflow.
2. `1ad3acabc09b8ad2693b6828e50491a669f45d8a` — `ci(replay): run known-location Steam HUD control`
   - added generic known-location HUD production-matcher replay.
3. `35c74a1b1b750b553bd034ea8b043e2aab00909f` — `ci(replay): characterize PC HUD versus GFN domain`
   - added descriptive PC-HUD/GFN domain comparison and exact fixture re-verification.

Pre-report compare from the verified starting HEAD through commit 3 was fast-forward only, ahead by 3 and behind by 0. Changed paths were only:

- `.github/workflows/audit-public-hud-controls.yml`
- `tools/mine_public_hud_controls.py`
- `tools/replay-public-hud-control.mjs`
- `tools/compare_hud_capture_domains.py`

No production source/cache file changed.

## CI / artifacts

Previous reference-domain positive-control authority:

- workflow run: `31598370762`
- artifact: `9142179590`
- artifact name: `wwmsync-reference-domain-truth-31598370762`
- artifact SHA-256: `10d9c47254d25fc9158e7cb72e04876562220a5f3f45f33f24de540d1b6eec90`
- result: SUCCESS

Public HUD mining:

- workflow run: `31607324354`
- artifact: `9145665339`
- artifact name: `wwmsync-public-hud-mining-31607324354`
- artifact SHA-256: `c2e74a8c601a1a5f578766d7a624c358a819d2e2a16a5d32d9be33e062b53118`
- result: SUCCESS

Known-location Steam HUD control:

- workflow run: `31608129069`
- job: `94152264582`
- artifact: `9146024156`
- artifact name: `wwmsync-public-hud-controls-31608129069`
- artifact SHA-256: `aef669048d973c6fa36299c0eaba783cf3aae8cde7e3fd0c840729712338df80`
- result: SUCCESS

PC-HUD versus exact GFN domain characterization:

- workflow run: `31609680755`
- job: `94157513620`
- artifact: `9146646914`
- artifact name: `wwmsync-public-hud-controls-31609680755`
- artifact SHA-256: `b305444dff3ac2db6a544020093bd64022ffef5406c246849499d6a96525c041`
- result: SUCCESS

All new workflow guards re-check the unchanged `if(fine.scaleScore<.58)` production contract and use `git diff --exit-code` against production vision/cache paths.

## Final acceptance after this audit

- SYNTHETIC = PASS
- REAL GFN = FAIL
- REAL LOCAL = UNAVAILABLE
- LIVE E2E = PENDING / NOT JUSTIFIED

No acceptance status was inflated by public-control research.
