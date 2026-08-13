# WWMSync Owner-Provided Known-Location GFN HUD Control Audit — 2026-08-13

## Scope and guardrails

- Replay/CI-only evidence round. No production matcher, cache, preprocessing, DD/native/memory, `main`, or `production/wwsync` change.
- Frozen production structural gate: `0.58`.
- Production baseline for matcher semantics: `ffbb1c51f80410d21685bf178647554f575ab582`.
- CI source commit: `5b8aeaaec53fcc48a4c56415e64c5a0e7d73bead`; run `31666927302`; job `replay-owner-gfn-controls`.

## Provenance validation

The owner supplied two world-map/gameplay pairs and stated that each gameplay image was captured immediately after selecting/teleporting to the paired landmark without significant relocation. The mounted PNG bytes are `2048×863` even though the owner described the capture session as 1920×1080 GFN. Byte dimensions, not the stated resolution, are used for ROI math.

### East Cross Street

- Pair acceptance: **accepted-known-location-gfn-control**.
- World-map source SHA-256: `1dffb5a484be50d753e40472dc8ef9f84d22633fa6ef2a976a81aee6f1536e9e`; dimensions: `[2048, 863]`.
- Gameplay source SHA-256: `c20d317a745b897b2d9cfb6d622521b2327afd961b8adae4649eaed23de256ad`; dimensions: `[2048, 863]`.
- Ground truth method: owner-paired world-map selection + previously audited Dashen exact named POI; matcher not used.
- World coordinate: `[-107.941, -1227.2615]`; expected z5: `[5219.931321637427, 4648.817136173768]`.
- pointId: `20212`; authoritative name: `东十字街`.

### General's Shrine

- Pair acceptance: **accepted-known-location-gfn-control**.
- World-map source SHA-256: `99841c9b467a63299cded38d3598e5ef136e349f0896cc21d31275b9e7c88de7`; dimensions: `[2048, 863]`.
- Gameplay source SHA-256: `dd73ea17c9a269535b74eb7fd83bd491df2bdbba56dcd2f7d9be074068120378`; dimensions: `[2048, 863]`.
- Ground truth method: owner-paired world-map selection + previously audited General Shrine reference point; matcher not used.
- World coordinate: `[-1966.7646484375, -3002.78784179687]`; expected z5: `[6015.017126148705, 3889.360588972433]`.

## ROI provenance

- Actual gameplay source dimensions: `2048×863`.
- `unit = min(width,height) = 863`.
- `roiFraction = 0.25`; raw semantic crop: `(0,0) → (215.75,215.75)`.
- Replay fixture preserves the unmodified top-left source pixels covering that semantic crop; production-equivalent canvas crop/resample produces the `192×192` matcher input.
- No beautification, sharpening, denoising, contrast manipulation, or production preprocessing change.

## Unchanged production global matcher and fixed-coordinate diagnostics

### East Cross Street

- Control classification: **FAIL_EXPECTED_BASIN_NOT_SURFACED**.
- Expected-basin rank: `N/A`; distance: `N/A` z5 px.
- Expected-basin coarse: `N/A`; raw structure: `N/A`; scale-aware structure: `N/A`.
- Expected-basin intensity: `N/A`; NCC: `N/A`; combined: `N/A`; angle: `N/A`; scale: `N/A`.
- Expected-basin matchGate: **N/A**.
- False basin outranks expected basin: **PASS**.
- Fixed known-coordinate local best: radius `44`, scale `1.100000`, angle `342.500000`; raw structure `0.649710`; scale-aware structure `0.530224`; intensity `0.466328`; NCC `0.386278`; combined `0.525113`; gate **FAIL**.

TOP-K production candidates:

| rank | x | y | region | coarse | raw struct | scale struct | intensity | NCC | combined | angle | scale | gate |
|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 6239.300000 | 3744.300000 | Qinghe | 0.575253 | 0.600146 | 0.562456 | 0.621616 | 0.564858 | 0.567189 | 270.500000 | 7.058100 | FAIL (scale-aware-structure 0.562) |
| 2 | 5478.300000 | 3871.800000 | Qinghe | 0.559933 | 0.580421 | 0.550649 | 0.611636 | 0.553381 | 0.555528 | 108 | 10.645320 | FAIL (scale-aware-structure 0.551) |
| 3 | 5611.300000 | 3471.800000 | Qinghe | 0.568097 | 0.601825 | 0.549874 | 0.606766 | 0.547781 | 0.554426 | 100 | 12.085701 | FAIL (scale-aware-structure 0.550) |
| 4 | 5593.300000 | 4170.300000 | Qinghe | 0.578757 | 0.614069 | 0.546014 | 0.610617 | 0.552209 | 0.551182 | 309.500000 | 15.662681 | FAIL (scale-aware-structure 0.546) |
| 5 | 5715.300000 | 3274.800000 | Qinghe | 0.556456 | 0.610907 | 0.542226 | 0.636588 | 0.582076 | 0.549775 | 6 | 3.874346 | FAIL (scale-aware-structure 0.542) |
| 6 | 6058.300000 | 3959.300000 | Qinghe | 0.579147 | 0.593632 | 0.536862 | 0.625684 | 0.569536 | 0.543968 | 318 | 12.379373 | FAIL (scale-aware-structure 0.537) |
| 7 | 5846.800000 | 3281.300000 | Qinghe | 0.552415 | 0.608712 | 0.529657 | 0.650704 | 0.598309 | 0.539341 | 1 | 5.465075 | FAIL (scale-aware-structure 0.530) |
| 8 | 6180.800000 | 3771.300000 | Qinghe | 0.565303 | 0.608547 | 0.523538 | 0.650495 | 0.598069 | 0.533695 | 267.500000 | 9.736819 | FAIL (scale-aware-structure 0.524) |

### General's Shrine

- Control classification: **FAIL_EXPECTED_BASIN_NOT_SURFACED**.
- Expected-basin rank: `N/A`; distance: `N/A` z5 px.
- Expected-basin coarse: `N/A`; raw structure: `N/A`; scale-aware structure: `N/A`.
- Expected-basin intensity: `N/A`; NCC: `N/A`; combined: `N/A`; angle: `N/A`; scale: `N/A`.
- Expected-basin matchGate: **N/A**.
- False basin outranks expected basin: **PASS**.
- Fixed known-coordinate local best: radius `128`, scale `3.200000`, angle `357.500000`; raw structure `0.594202`; scale-aware structure `0.599594`; intensity `0.388504`; NCC `0.296779`; combined `0.582707`; gate **FAIL**.

TOP-K production candidates:

| rank | x | y | region | coarse | raw struct | scale struct | intensity | NCC | combined | angle | scale | gate |
|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 5407.300000 | 4133.300000 | Qinghe | 0.593885 | 0.622791 | 0.588791 | 0.508337 | 0.434588 | 0.582354 | 114.500000 | 12.346567 | PASS (accepted) |
| 2 | 5354.300000 | 3899.800000 | Qinghe | 0.566240 | 0.617882 | 0.559869 | 0.660079 | 0.609091 | 0.567886 | 208.500000 | 4.369902 | FAIL (scale-aware-structure 0.560) |
| 3 | 5612.300000 | 3573.300000 | Qinghe | 0.607038 | 0.635508 | 0.555231 | 0.682514 | 0.634892 | 0.565414 | 181 | 9.353225 | FAIL (scale-aware-structure 0.555) |
| 4 | 6028.300000 | 3416.800000 | Qinghe | 0.571347 | 0.655383 | 0.559123 | 0.629942 | 0.574433 | 0.564788 | 74 | 2.311092 | FAIL (scale-aware-structure 0.559) |
| 5 | 5500.300000 | 3456.800000 | Qinghe | 0.585328 | 0.631719 | 0.549185 | 0.617559 | 0.560192 | 0.554655 | 194 | 5.726448 | FAIL (scale-aware-structure 0.549) |
| 6 | 5903.300000 | 4086.300000 | Qinghe | 0.579421 | 0.639459 | 0.538812 | 0.576799 | 0.513319 | 0.541851 | 21 | 3.490855 | FAIL (scale-aware-structure 0.539) |
| 7 | 5664.300000 | 3609.300000 | Qinghe | 0.581927 | 0.615606 | 0.532729 | 0.592889 | 0.531823 | 0.537541 | 188.500000 | 2.717334 | FAIL (scale-aware-structure 0.533) |
| 8 | 6131.300000 | 3832.800000 | Qinghe | 0.567821 | 0.596177 | 0.506092 | 0.601816 | 0.542088 | 0.513750 | 309.500000 | 11.628853 | FAIL (scale-aware-structure 0.506) |

## Joint interpretation

Outcome family: **CASE G3**.
- The failing GFN controls are not locally viable at the independently known coordinate under the unchanged gate. Provenance remains accepted, but minimap state/teleport offset/capture-domain characteristics remain plausible contributors; no matcher change is inferred from this alone.
- Prior FULL-MAP General Shrine positive control remains PASS, establishing that the Dashen reference/coordinate architecture is not globally broken.
- Prior Steam Global PC Fang Xu / General Shrine normal HUD remains global HUD-FAIL with fixed expected-coordinate local viability above `0.58`.
- Prior real 40-frame GFN fixture remains FAIL.
- These owner controls materially reduce the known-location GFN control uncertainty, but they do **not** replace native-PC Stage-A evidence needed to discriminate H1 versus H2 cleanly.
- **No production change is justified by this round.** Structural gate `0.58` remains unchanged; no production matcher/cache/preprocessing file is modified.

## Evidence digests

- `SHA256SUMS` — SHA-256 `93f3712aef7a88c800573b4cff8b4d28d3c8a97d4ca6a7820d633ddf653186d9`
- `SHA256SUMS.txt` — SHA-256 `d7b300f8fcb7340dc4aeafb709e42d1f971867e5823e728cf7c89a56bf234dbf`
- `east-cross-matcher.json` — SHA-256 `3968b98e115e147d53ff426d246657588e4b87d607ae8e625639c723a9626c47`
- `east-cross-roi-192.png` — SHA-256 `0551d584aec4df0fff3b6ccd115ddead1281be84e98239621148d3382c6e442c`
- `general-shrine-matcher.json` — SHA-256 `849eaf3dcf4cdc4e773820dd0ef3df046450fdd1c9d0d8e857815e9bd26f136e`
- `general-shrine-roi-192.png` — SHA-256 `f0acddeef0e5d1c6f433e2e9347a48631bf7cbe84057f2c3adb1c8a01cc32999`
- `summary.json` — SHA-256 `d4e4c47ecbb6658858c3e837a32dd3f563f65df0326d388fd6d220c66c6d66f3`

## Final acceptance

- SYNTHETIC = PASS (unchanged prior acceptance).
- KNOWN-LOCATION GFN HUD — East Cross Street = **FAIL_EXPECTED_BASIN_NOT_SURFACED**.
- KNOWN-LOCATION GFN HUD — General's Shrine = **FAIL_EXPECTED_BASIN_NOT_SURFACED**.
- REAL 40-FRAME GFN FIXTURE = FAIL (unchanged prior acceptance).
- REAL LOCAL / native-PC Stage-A control = still required / unavailable in current evidence round.
- LIVE E2E = PENDING / NOT JUSTIFIED.
- PRODUCTION STRUCTURAL GATE = `0.58`, unchanged.
- PRODUCTION CHANGE = NOT JUSTIFIED.
