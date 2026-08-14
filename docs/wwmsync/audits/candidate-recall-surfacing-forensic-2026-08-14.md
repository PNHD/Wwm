# WWMSync Production Candidate Recall / Surfacing Forensic Audit

Date: 2026-08-14

## 1. Verified starting HEAD

`3251202f001755c7bda957a0b329b9f862c0cfcf`

## 2. Final HEAD

Final evidence/code HEAD before the report-only commit: `2a29cb9d2cd5ba871dd4bde7107640d12c8a24d6`.
The report-only commit is appended only after the authoritative artifact exists; a Git commit cannot self-contain its own final SHA without changing that SHA.

## 3. Commits

- `f0ca1c47a090624f13f3a645718d92b7c9fdb3eb` — ci(replay): add candidate recall forensic instrumentation
- `80156f37a27e183cb6ddd7b2996a516353b793e5` — ci(replay): add candidate recall forensic runner
- `acdeec218c94a948f0ee5374d4091bcef09e9a4a` — ci(replay): enforce independent Fang Xu recall generalization
- `5977ecfc9cbbe223253800ccd40a3035d236f40a` — ci(wwmsync): add candidate recall forensic audit
- `9e3c419ab4d6c83420bed8794c6f7cd57c4edfaa` — ci(wwmsync): fix forensic workflow validation
- `c3642a1105ccccfe4b6ea248c066c725e784e22c` — ci(replay): cache repeated forensic fine evaluations
- `ac541479a879ab0d792c3e82248e8841e6d339c6` — ci(wwmsync): add memoized recall diagnostic
- `91661f60207c173925e16c086be19ef6eecf5e4c` — ci(replay): add exact coarse candidate stage trace
- `d76bd8aae412e876117e44e9cf3570e053643199` — ci(replay): add exact stage trace runner
- `2e28bfeecf9a830df2850f8706182222e3113754` — ci(wwmsync): run exact coarse candidate stage trace
- `10f54e766dca08c622acbf43b455afa1e74e789d` — ci(replay): add exact fine-stage candidate trace
- `5675a5887c6855ac2ea890ab21c7a39fed1136c3` — ci(replay): add exact fine-stage trace runner
- `2c17d8101e64cb1701dd7423bec114fcb8df9981` — ci(wwmsync): run exact fine candidate stage trace
- `b95ee27d082d9eb2f57d18156f0545ae2fea7e5c` — ci(replay): add preregistered pose-retention counterfactual patcher
- `7abc732a14c3efd64ee284b20aa298a65906d2ed` — ci(replay): add preregistered retention variant runner
- `55dcb424bd456ff647296ff732d1d29d28de184b` — ci(wwmsync): test preregistered candidate retention sensitivity
- `c614b7141221f20584618cc9cd6329b0307a9e60` — ci(replay): fix retention variant site path parsing
- `2aa82f7e84e595f4d10f2666e103bc6845d35240` — ci(wwmsync): rerun retention sensitivity after harness fix
- `481638e0b308b6c2ad37b347599d316636563150` — ci(replay): add strict candidate recall oracle ladder
- `c66e1c41b920cc14437c134a79304e24955766f1` — ci(replay): add strict oracle ladder runner
- `71ce6030da8713698bfe49b6a70695ef44aaf0e2` — ci(wwmsync): run strict candidate recall oracle ladder
- `39c5a8a71e529c240cd3391b844902394b3f11a2` — ci(replay): expand coarse-fine correlation sample to full hypotheses
- `cdb66539c6c155a12c482caba449262975fb6b31` — ci(replay): add bounded production local score landscape
- `a8296d7fff7a7ad15a104df1427f38773b67a873` — ci(replay): add local score landscape runner
- `5e468101db8f28ef4511d64bbc022422a89b7923` — ci(wwmsync): run bounded production local score landscapes
- `13cf66d9d79215ad293a33d56633f1fa8785164e` — ci(wwmsync): measure full coarse-fine candidate correlation
- `99d4041c26fe69d3a0fc92bd6ffe1244ba2f1b9d` — ci(replay): add production-equivalent retention baseline
- `6593c6e80aa22079168c65ce7fe54bde4ee6936e` — ci(replay): measure retention runtime and false burden
- `d4c2bac0a8167b8368e3b3899c4763bd27b94050` — ci(wwmsync): quantify retention candidate and runtime multipliers
- `2f4e5c84a09ce18d56a13fb3a40e640cffbdc046` — ci(wwmsync): add final candidate recall evidence synthesizer
- `2c98fa626ce6d35adb21d749b957073154769e3c` — ci(wwmsync): aggregate authoritative candidate recall forensic audit
- `2a29cb9d2cd5ba871dd4bde7107640d12c8a24d6` — ci(wwmsync): finalize authoritative candidate recall audit

## 4. Frozen production guards

- contract: `ANCHOR_FREE_STRUCTURAL_V11`
- `vision-sync.js` blob: `58b5a1babf6a12b944f9b745b8bf7f7df573bf9b`
- `dashen-tile-cache.js` blob: `9388960a8bff53a9cfc7471372af144b7a28c34f`
- structural gate: `0.58` — unchanged
- intensity gate: `0.42`; coarse gate: `0.5`; ambiguity gate: `0.01`
- production matcher/cache/preprocessing changes: **NONE**

## 5. Actual production search graph

Coarse z3 → fine z5; Qinghe stride `7`; radii `[6, 9, 13, 18, 25, 34]`; rotations `[0, 45, 90, 135, 180, 225, 270, 315]`; `COARSE_BEAM=8`.

Exact survival path: full coarse intensity/NCC lattice → per-radius TOP-120 → structural rescore eligibility TOP-90/radius (`0.14 intensity + 0.86 scale-aware structure`) → per-radius spatial NMS (`max(11, radius*0.50)`, max 8/radius) → global TOP-36 seeds → local-refine intensity TOP-56/seed → structural TOP-42/seed (`0.10 intensity + 0.90 structure`) → one hypothesis/seed → global TOP-8 → fine intensity TOP-120/hypothesis → structural TOP-70 → **one fine-refinement seed `top[0]`** → refine intensity TOP-80 → structural TOP-64 → photometric TOP-48 ×2 → final `0.92 structure + 0.08 intensity` rerank → unchanged `matchGate`.

## 6. East Cross GFN expected-basin stage trace

Direct first-loss stage: **global coarse seed TOP-36**

| Stage | In | Out | Basin | Rank | GT distance |
|---|---:|---:|---|---:|---:|
| coarse: coarse intensity lattice generated | 7488 | 7488 | PRESENT | 162 | 88.56 |
| coarse: per-radius intensity TOP-120 | 7488 | 720 | PRESENT | 162 | 88.56 |
| coarse: TOP-90/radius structural-rescore eligibility | 720 | 540 | PRESENT | 89 | 71.90 |
| coarse: per-radius spatial NMS -> max 8 | 720 | 48 | PRESENT | 44 | 71.90 |
| coarse: global coarse seed TOP-36 | 48 | 36 | ABSENT | — | — |
| coarse: coarse local-refinement lattice generated | 36 | 226380 | ABSENT | — | — |
| coarse: per-seed local intensity TOP-56 | 226380 | 2016 | ABSENT | — | — |
| coarse: per-seed local structural TOP-42 eligibility | 2016 | 1512 | ABSENT | — | — |
| coarse: one coarse hypothesis per retained seed | 1512 | 36 | ABSENT | — | — |
| coarse: global COARSE_BEAM TOP-8 | 36 | 8 | ABSENT | — | — |
| fine: fine initial lattice generated | 596232 | 596232 | ABSENT | — | — |
| fine: fine intensity TOP120 per hypothesis | 596232 | 960 | ABSENT | — | — |
| fine: fine structural TOP70 eligibility | 960 | 560 | ABSENT | — | — |
| fine: fine refine lattice generated around top[0] | 72200 | 72200 | ABSENT | — | — |
| fine: fine refine intensity TOP80 per hypothesis | 72200 | 640 | ABSENT | — | — |
| fine: fine refine structural TOP64 eligibility | 640 | 512 | ABSENT | — | — |
| fine: photometric pass1 generated | 8712 | 8712 | ABSENT | — | — |
| fine: photometric pass1 TOP48 | 8712 | 384 | ABSENT | — | — |
| fine: photometric pass1 structural-floor eligible | 384 | 382 | ABSENT | — | — |
| fine: photometric pass1 winner per hypothesis | 382 | 8 | ABSENT | — | — |
| fine: photometric pass2 generated | 8712 | 8712 | ABSENT | — | — |
| fine: photometric pass2 TOP48 | 8712 | 384 | ABSENT | — | — |
| fine: photometric pass2 structural-floor eligible | 384 | 384 | ABSENT | — | — |
| fine: photometric pass2 winner per hypothesis | 384 | 8 | ABSENT | — | — |
| fine: fine finalist per coarse hypothesis | 8 | 8 | ABSENT | — | — |

## 7. General Shrine GFN expected-basin stage trace

Direct first-loss stage: **per-radius spatial NMS -> max 8**

| Stage | In | Out | Basin | Rank | GT distance |
|---|---:|---:|---|---:|---:|
| coarse: coarse intensity lattice generated | 7488 | 7488 | PRESENT | 49 | 45.02 |
| coarse: per-radius intensity TOP-120 | 7488 | 720 | PRESENT | 49 | 45.02 |
| coarse: TOP-90/radius structural-rescore eligibility | 720 | 540 | PRESENT | 74 | 45.02 |
| coarse: per-radius spatial NMS -> max 8 | 720 | 48 | ABSENT | — | — |
| coarse: global coarse seed TOP-36 | 48 | 36 | ABSENT | — | — |
| coarse: coarse local-refinement lattice generated | 36 | 230496 | PRESENT | 24 | 62.72 |
| coarse: per-seed local intensity TOP-56 | 230496 | 2016 | PRESENT | 24 | 62.72 |
| coarse: per-seed local structural TOP-42 eligibility | 2016 | 1512 | PRESENT | 202 | 62.72 |
| coarse: one coarse hypothesis per retained seed | 1512 | 36 | ABSENT | — | — |
| coarse: global COARSE_BEAM TOP-8 | 36 | 8 | ABSENT | — | — |
| fine: fine initial lattice generated | 596232 | 596232 | PRESENT | — | 42.36 |
| fine: fine intensity TOP120 per hypothesis | 596232 | 960 | ABSENT | — | — |
| fine: fine structural TOP70 eligibility | 960 | 560 | ABSENT | — | — |
| fine: fine refine lattice generated around top[0] | 72200 | 72200 | ABSENT | — | — |
| fine: fine refine intensity TOP80 per hypothesis | 72200 | 640 | ABSENT | — | — |
| fine: fine refine structural TOP64 eligibility | 640 | 512 | ABSENT | — | — |
| fine: photometric pass1 generated | 8712 | 8712 | ABSENT | — | — |
| fine: photometric pass1 TOP48 | 8712 | 384 | ABSENT | — | — |
| fine: photometric pass1 structural-floor eligible | 384 | 341 | ABSENT | — | — |
| fine: photometric pass1 winner per hypothesis | 341 | 8 | ABSENT | — | — |
| fine: photometric pass2 generated | 8712 | 8712 | ABSENT | — | — |
| fine: photometric pass2 TOP48 | 8712 | 384 | ABSENT | — | — |
| fine: photometric pass2 structural-floor eligible | 384 | 372 | ABSENT | — | — |
| fine: photometric pass2 winner per hypothesis | 372 | 8 | ABSENT | — | — |
| fine: fine finalist per coarse hypothesis | 8 | 8 | ABSENT | — | — |

## 8. Steam Fang Xu Global-PC HUD expected-basin stage trace

Direct first-loss stage: **fine refine lattice generated around top[0]**

| Stage | In | Out | Basin | Rank | GT distance |
|---|---:|---:|---|---:|---:|
| coarse: coarse intensity lattice generated | 7488 | 7488 | PRESENT | 16 | 84.69 |
| coarse: per-radius intensity TOP-120 | 7488 | 720 | PRESENT | 16 | 84.69 |
| coarse: TOP-90/radius structural-rescore eligibility | 720 | 540 | PRESENT | 8 | 86.73 |
| coarse: per-radius spatial NMS -> max 8 | 720 | 48 | PRESENT | 8 | 84.69 |
| coarse: global coarse seed TOP-36 | 48 | 36 | PRESENT | 8 | 84.69 |
| coarse: coarse local-refinement lattice generated | 36 | 240492 | PRESENT | 25 | 25.74 |
| coarse: per-seed local intensity TOP-56 | 240492 | 2016 | PRESENT | 25 | 25.74 |
| coarse: per-seed local structural TOP-42 eligibility | 2016 | 1512 | PRESENT | 35 | 25.74 |
| coarse: one coarse hypothesis per retained seed | 1512 | 36 | PRESENT | 5 | 25.74 |
| coarse: global COARSE_BEAM TOP-8 | 36 | 8 | PRESENT | 5 | 25.74 |
| fine: fine initial lattice generated | 596232 | 596232 | PRESENT | — | 27.97 |
| fine: fine intensity TOP120 per hypothesis | 596232 | 960 | PRESENT | — | 27.97 |
| fine: fine structural TOP70 eligibility | 960 | 560 | PRESENT | — | 27.97 |
| fine: fine refine lattice generated around top[0] | 72200 | 72200 | ABSENT | — | — |
| fine: fine refine intensity TOP80 per hypothesis | 72200 | 640 | ABSENT | — | — |
| fine: fine refine structural TOP64 eligibility | 640 | 512 | ABSENT | — | — |
| fine: photometric pass1 generated | 8712 | 8712 | ABSENT | — | — |
| fine: photometric pass1 TOP48 | 8712 | 384 | ABSENT | — | — |
| fine: photometric pass1 structural-floor eligible | 384 | 383 | ABSENT | — | — |
| fine: photometric pass1 winner per hypothesis | 383 | 8 | ABSENT | — | — |
| fine: photometric pass2 generated | 8712 | 8712 | ABSENT | — | — |
| fine: photometric pass2 TOP48 | 8712 | 384 | ABSENT | — | — |
| fine: photometric pass2 structural-floor eligible | 384 | 384 | ABSENT | — | — |
| fine: photometric pass2 winner per hypothesis | 384 | 8 | ABSENT | — | — |
| fine: fine finalist per coarse hypothesis | 8 | 8 | ABSENT | — | — |

## 9. East Cross GFN oracle-retention result

Any one-stage oracle retention leading to an expected-basin global ACCEPT: **False**

- retain after `global coarse seed TOP-36` → next `global COARSE_BEAM TOP-8`; next rank `31`; survives `False`; source GT distance `71.90`; downstream global rank `—`; expected ACCEPT `False`.

## 10. General Shrine GFN oracle-retention result

Any one-stage oracle retention leading to an expected-basin global ACCEPT: **False**

- retain after `per-radius spatial NMS -> max 8` → next `global coarse seed TOP-36`; next rank `37`; survives `False`; source GT distance `45.02`; downstream global rank `—`; expected ACCEPT `False`.
- retain after `one coarse hypothesis per retained seed` → next `global COARSE_BEAM TOP-8`; next rank `37`; survives `False`; source GT distance `62.72`; downstream global rank `—`; expected ACCEPT `False`.
- retain after `fine intensity TOP120 per hypothesis` → next `fine structural TOP70 eligibility`; next rank `121`; survives `False`; source GT distance `42.36`; downstream global rank `—`; expected ACCEPT `False`.
- retain after `fine structural TOP70 eligibility` → next `single fine refinement seed top[0]`; next rank `44`; survives `False`; source GT distance `42.36`; downstream global rank `—`; expected ACCEPT `False`.

## 11. Steam Fang Xu Global-PC HUD oracle-retention result

Any one-stage oracle retention leading to an expected-basin global ACCEPT: **False**

- retain after `single fine refinement seed top[0]` → next `fine refine TOP80/TOP64 + photometric`; next rank `—`; survives `True`; source GT distance `27.97`; downstream global rank `9`; expected ACCEPT `False`.

## 12. Local score landscapes

| Control | exact-GT structure | scale-aware | intensity | NCC | combined | strongest wrong combined | basin width px |
|---|---:|---:|---:|---:|---:|---:|---:|
| East Cross GFN | 0.154511 | 0.513592 | 0.314525 | 0.211703 | 0.497666 | 0.506621 | 307.3 |
| General Shrine GFN | 0.315735 | 0.599867 | 0.360525 | 0.264604 | 0.580719 | 0.519966 | 0.0 |
| Steam Fang Xu Global-PC HUD | 0.266811 | 0.609151 | 0.581876 | 0.519157 | 0.606969 | 0.543801 | 0.0 |

Bounded landscape artifacts also contain the full spatial radial rings plus scale and rotation sensitivity arrays; no matcher scores were changed.

## 13. Coarse → fine correlation

| Control | N | coarse↔fine scale-aware | coarse↔combined | strong fine discarded | discard fraction |
|---|---:|---:|---:|---:|---:|
| East Cross GFN | 36 | 0.5210 | 0.5689 | 0 / 0 | 0.0000 |
| General Shrine GFN | 36 | 0.5267 | 0.5534 | 0 / 1 | 0.0000 |
| Steam Fang Xu Global-PC HUD | 36 | 0.4396 | 0.4853 | 5 / 10 | 0.5000 |

## 14. Exact first-loss stage per control

- East: **global coarse seed TOP-36**.
- General: **per-radius spatial NMS -> max 8**; the basin later regenerates spatially and is pruned again.
- Fang Xu: **fine refine lattice generated around top[0]**; it survives the complete coarse path before the fine-stage loss.

## 15. RCL classification per control

- **East Cross GFN — RCL-5 — LOCAL DISCRIMINATION FAILURE**. The physical basin is generated and survives coarse NMS but falls outside global TOP-36; strict retention does not rescue it, and the bounded exact-GT landscape remains below the 0.58 structural gate and below a wrong local maximum.
- **General Shrine GFN — RCL-MIXED — RCL-2 + RCL-4**. The basin is first removed by per-radius NMS, can spatially regenerate later, but retained candidates still miss downstream beams; independently, the exact-GT local optimum passes structure but fails the unchanged 0.42 intensity gate.
- **Steam Fang Xu Global-PC HUD — RCL-3 — FINE-RANKING / POSE-SURVIVAL FAILURE**. The basin naturally reaches coarse TOP-8 and fine TOP-70, then loses the single fine-refinement seed. Strict retention preserves location but the retained wrong pose degrades and ranks ninth globally, while the independent exact-GT pose is locally strong.

## 16. Recall-only sensitivity results

| Variant | Control | candidate multiplier | runtime multiplier | false finalists | expected basin recalled |
|---|---|---:|---:|---:|---|
| production baseline | East Cross GFN | 1.00× | 1.00× | 8 | False |
| production baseline | General Shrine GFN | 1.00× | 1.00× | 8 | False |
| production baseline | Steam Fang Xu Global-PC HUD | 1.00× | 1.00× | 8 | False |
| top2/seed + beam16 | East Cross GFN | 2.00× | 1.86× | 16 | False |
| top2/seed + beam16 | General Shrine GFN | 2.00× | 1.82× | 16 | False |
| top2/seed + beam16 | Steam Fang Xu Global-PC HUD | 2.00× | 1.82× | 16 | False |
| top4/seed + beam32 | East Cross GFN | 4.00× | 3.46× | 32 | False |
| top4/seed + beam32 | General Shrine GFN | 4.00× | 3.36× | 32 | False |
| top4/seed + beam32 | Steam Fang Xu Global-PC HUD | 4.00× | 3.55× | 32 | False |

The two preregistered recall-only counterfactuals leave every production score and gate untouched. Neither recovers an expected-basin finalist on East, General, or Fang Xu.

## 17. Fang Xu independent generalization result

Pair-surviving General + independent Fang Xu variants: `[]`. Result: **NOT GENERALIZED**.

## 18. 40-frame stress result

**NOT EXECUTED / NOT JUSTIFIED.** No preregistered recall-only variant recovered the expected basin on both General Shrine and independent Fang Xu; Phase 8 is therefore not justified by the user-specified gate.
Frozen fixture retained for provenance: `wwmsync-gfn-motion-20260810-143835.zip`, SHA-256 `aa14ce0e703d0af5c4c86946f2932b465f8a7fd529001cd1900b3b99b501a216`. No localization PASS is claimed.

## 19. Final CR verdict + architecture implication

**CR0 — NO COMMON RECALL BOTTLENECK**

Do not modify production and do not expand beam/search as a general fix. East, General, and Fang Xu fail by materially different mechanisms. The next architecture evidence should add independent GFN known-location controls and measure how often discrimination, mixed recall+gate, and fine pose-survival classes occur.

## 20. Authoritative CI provenance + production-change verdict

- stage: run `31768033881`, job `94667864485`, artifact `9207047835`, digest `sha256:460caa92a0af8c457d65e3fafed40ba01009d5895a09359c1fd81c215dd960da`, head `2e28bfeecf9a830df2850f8706182222e3113754`
- fine: run `31768239431`, job `94668491244`, artifact `9207148249`, digest `sha256:ce858250c81ee3adf6efa9704a9cd22f87e7ffa2dde0c5c2ae9d9b9f9ee1ac39`, head `2c17d8101e64cb1701dd7423bec114fcb8df9981`
- oracle: run `31768741916`, job `94670010602`, artifact `9207338781`, digest `sha256:51576651e60f3d8d00564a34b33e4d3283f864acc233ef43ce02afe1e4ac78d9`, head `71ce6030da8713698bfe49b6a70695ef44aaf0e2`
- landscape: run `31768871389`, job `94670389528`, artifact `9207360521`, digest `sha256:a5a4a131080174875862ee663989400b3ca741a0316e1677bf0c3a7e5a964181`, head `5e468101db8f28ef4511d64bbc022422a89b7923`
- corr: run `31768986105`, job `94670727831`, artifact `9207485537`, digest `sha256:bbf9d3cd6df7c845eef1a70e35104ef03e1208e9aefd13d5003fe7e5377735ff`, head `13cf66d9d79215ad293a33d56633f1fa8785164e`
- sens: run `31769121780`, job `94671141315`, artifact `9207561481`, digest `sha256:efea908f914b80ce940691858379c1da996125f38119b09e9d0b6d512ab4bd95`, head `d4c2bac0a8167b8368e3b3899c4763bd27b94050`

Final authoritative aggregation: run `31769654943`, job `94672779698`, evidence artifact `9207636803`, digest `415cef6cafe43a2509b1b541c8f2f2e3d72cbb835cca5505f124f65955062ed0`.

**Production-change verdict: NO PRODUCTION CHANGE. Structural gate remains 0.58.**
