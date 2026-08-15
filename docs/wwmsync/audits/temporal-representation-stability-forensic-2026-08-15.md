# WWMSync Temporal Representation-Stability / Evidence-Aggregation Audit — 2026-08-15

Status: **RESEARCH DECISION REACHED / NOT AUTHORITATIVE-CI-ACCEPTED**

This is replay/CI-only architecture research. It does **not** authorize or implement a production matcher change. The structural gate remains **0.58** and all production guards remain unchanged.

The decision-bearing local replay is sufficient to reject a simple temporal-rescue hypothesis and to stop before the 40-frame stress fixture. It is **not** sufficient to claim the requested authoritative CI acceptance because the exact conversation-attached temporal ZIP could not be transported into the GitHub Actions runner through the available GitHub write connector. No CI coordinates are fabricated.

## 1. Verified starting HEAD

- Repository: `PNHD/Wwm`
- Branch: `feature/wwm-native-sync-v2`
- Required starting HEAD: `f55110772baeccb18d3b40c3e7fa381244d03ae7`
- Verified starting HEAD: **`f55110772baeccb18d3b40c3e7fa381244d03ae7`**
- Branch drift before the audit: **NO**

## 2. Final HEAD

The audit published two evidence commits after the preregistration commit. The exact branch HEAD is to be read from the branch after publication; no production file is part of the audit diff.

## 3. Commits

1. `7a976e38e9503c81ce0d08216ee47e493c08b947` — `test(wwmsync): freeze temporal representation audit preregistration [skip ci]`
2. `48107bba6b1d615ea5b3013408d97736020cb458` — `docs(wwmsync): record temporal stability local replay evidence [skip ci]`
3. This report commit — `docs(wwmsync): record temporal representation stability audit [skip ci]`

The preregistration commit was made directly on top of the verified starting HEAD and added only the temporal preregistration JSON.

## 4. Production guards

Frozen production invariants:

- `vision-sync.js` blob: `58b5a1babf6a12b944f9b745b8bf7f7df573bf9b`
- `dashen-tile-cache.js` blob: `9388960a8bff53a9cfc7471372af144b7a28c34f`
- `tools/build_dashen_visual_cache.py` blob: `1a227d06ae41660ea3e3b832e7f1921cc507c0d7`
- structural gate: **0.58**
- intensity gate: **0.42**
- coarse beam: **8**
- production change: **NO**

No gate, score weight, production preprocessing, global beam/search domain, bridge family, or learned model was changed.

## 5. Temporal bundle provenance

Verified locally from the exact attachment:

- bundle SHA-256: `8773a3ac685482c2ba3cee57634512dcbfc332e705339ea53ac1e46aee285271`
- manifest SHA-256: `024972956d7dbf71d8ceb476365eb3b6ca1442256dd27350ee974d3e4749ca18`
- source video: `record_2026-08-15_13-53-52.mp4`
- source video SHA-256: `a6417900887a6dddff09a09f2d254dfecd3a3943044e7116dd743783932061b7`
- 54/54 ROI file hashes verified
- 54/54 dimensions verified as 270×270
- grouping verified as 6 capture events × 9 frames
- offsets verified as `[-1.00,-0.75,-0.50,-0.25,0,+0.25,+0.50,+0.75,+1.00]` seconds
- the bundle declares deterministic lossless derivation from the already acquired video and does not constitute new acquisition evidence
- no temporal frame was generated based on matcher outcome

## 6. Frozen valid-frame masks

Validity was frozen using only UI-state criteria before temporal outcome comparison: world map closed, minimap visible, no teleport/loading transition, no obvious modal coverage, and no gross corruption.

All six masks are identical:

`[KEEP, KEEP, KEEP, KEEP, KEEP, KEEP, KEEP, KEEP, KEEP]`

- Path of Void: 9/9 valid
- Buddha Fort: 9/9 valid
- General Shrine repeat: 9/9 valid
- Prosperity Haven: 9/9 valid
- Ethereal Chamber: 9/9 valid
- Dreamfall Cliff: 9/9 valid

Excluded frames: **0/54**. No frame was rejected because it matched badly.

## 7. Path of Void temporal results

Known GT z5: `(5662.35270309106, 3599.42210726817)` — Qinghe.

Across nine raw valid frames:

- scale-aware mean / median / min / max: **0.5394 / 0.5395 / 0.5384 / 0.5401**
- frames reaching 0.58: **0/9**
- intensity mean / median / min / max: **0.4385 / 0.4388 / 0.4377 / 0.4391**
- NCC variance: `3.2964567081302834e-7`
- combined variance: `2.3934462957109347e-7`
- correct-vs-local-wrong discrimination mean / median / min / max: **0.0267 / 0.0265 / 0.0256 / 0.0285**
- pose/radius: stable at `0° / 112`
- medoid offset: `-0.75 s`

TEMP-A scale-aware `0.53836`; TEMP-B `0.53910`. Neither rescues structural support.

## 8. Buddha Fort temporal results

Known GT z5: `(6150.319157894736, 3719.750105931495)` — Qinghe.

- scale-aware mean / median / min / max: **0.5334 / 0.5336 / 0.5324 / 0.5345**
- frames reaching 0.58: **0/9**
- intensity mean / median / min / max: **0.3708 / 0.3702 / 0.3688 / 0.3742**
- NCC variance: `4.555743492408348e-6`
- combined variance: `3.426033674030133e-7`
- discrimination mean / median / min / max: **0.0134 / 0.0136 / 0.0111 / 0.0157**
- pose/radius: stable at `180° / 48`
- medoid offset: `+0.50 s`

TEMP-A scale-aware `0.53454`; TEMP-B `0.53381`. Neither rescues structural support.

TEMP-C's dominant cluster persists **9/9** frames around `(5340.8, 3740.8)`, roughly **810 z5 px from GT**. The nearest persistent cluster remains about **168 z5 px from GT**, outside the frozen 60 px correctness tolerance.

## 9. General Shrine repeat temporal results

Known GT z5: `(6015.017126148705, 3889.360588972433)` — Qinghe.

Authoritative prior center evidence was scale-aware `0.5086483271`; historical General evidence was approximately `0.5999`. The local replay is not claimed browser-raster bit-identical to the authoritative run, so its absolute score is used only for same-run temporal comparison.

Across the repeat window:

- scale-aware mean / median / min / max: **0.5032 / 0.5031 / 0.5017 / 0.5046**
- frames reaching 0.58: **0/9**
- intensity mean / median / min / max: **0.4731 / 0.4732 / 0.4729 / 0.4733**
- NCC variance: `2.2127071552424336e-8`
- combined variance: `9.864646351861295e-7`
- discrimination mean / median / min / max: **0.0026 / 0.0023 / 0.0016 / 0.0036**
- pose/radius: stable at `180° / 32`
- medoid offset: `+0.25 s`

TEMP-A scale-aware `0.50274`; TEMP-B `0.50336`.

The repeat center is therefore **not a nearby-frame outlier**. The continuous ±1 s capture is consistently structural-negative. Historical `~0.5999` versus the current repeat is a longer-horizon representation/session/map-state discrepancy, not evidence that adjacent stationary frames alternate across the 0.58 gate.

TEMP-C's dominant cluster is also wrong and 9/9 persistent, around `(5516.8, 3324.8)`, approximately **753 z5 px from GT**.

## 10. Prosperity Haven temporal results

Known GT z5: `(4959.193804824561, 4487.057644110276)` — Kaifeng.

- scale-aware mean / median / min / max: **0.5547 / 0.5545 / 0.5540 / 0.5559**
- frames reaching 0.58: **0/9**
- intensity mean / median / min / max: **0.4406 / 0.4407 / 0.4403 / 0.4408**
- NCC variance: `3.5251892161549415e-8`
- combined variance: `2.933518324356263e-7`
- discrimination mean / median / min / max: **0.0560 / 0.0553 / 0.0550 / 0.0580**
- pose/radius: stable at `180° / 32`
- medoid offset: `+0.25 s`

TEMP-A scale-aware `0.55526`; TEMP-B `0.55518`. This is the strongest of the five known-GT temporal sequences, but still never reaches 0.58.

TEMP-C's dominant 9/9 persistent basin is around `(4908.8, 5132.8)`, roughly **648 z5 px from GT**.

## 11. Dreamfall Cliff temporal results

Known GT z5: `(5054.117319966583, 5032.292689055973)` — Kaifeng.

Dreamfall is the one sequence with visibly meaningful local render/pose volatility:

- scale-aware mean / median / min / max: **0.4984 / 0.4935 / 0.4901 / 0.5172**
- frames reaching 0.58: **0/9**
- intensity mean / median / min / max: **0.1944 / 0.2000 / 0.1030 / 0.2269**
- NCC variance: `0.0020721574663143216`
- combined variance: `0.00006966007943187078`
- discrimination mean / median / min / max: **-0.0381 / -0.0386 / -0.0669 / +0.0001**
- angles by frame: `[270,300,300,300,180,300,330,270,270]`
- radii by frame: `[64,32,32,32,32,32,112,64,64]`
- medoid offset: `-0.75 s`

This proves render state can vary materially, but it does **not** produce a structural-positive frame. TEMP-A and TEMP-B actually leave the correct-vs-wrong local discrimination negative (`~-0.066`).

TEMP-C's dominant 9/9 cluster remains about **140 z5 px from GT**, outside the 60 px correctness tolerance.

## 12. Ethereal robustness

Ethereal remains **NOT_EVALUABLE_REFERENCE_FAMILY / Floor 2**.

No GT evaluation, RCL assignment, or absolute localization claim was made.

Robustness-only observation:

- coarse candidate clusters: 3
- dominant cluster persistence: **9/9**
- dominant candidate coordinate for identity/stability measurement only: approximately `(4956.8, 5132.8)`
- median rank score: `0.6751`
- median scale score: `0.6659`

The dominant Ethereal candidate aliases the dominant Dreamfall coarse basin. This is a **safety warning about candidate persistence**, not evidence that Ethereal localizes to Dreamfall's coordinate.

## 13. Within-location volatility

The decisive aggregate observation is:

**0 / 45 known-GT nearby raw frames reach the unchanged 0.58 structural gate.**

Path, Buddha, General, and Prosperity are low-variance and structurally negative throughout. Dreamfall is higher-variance in intensity/pose/radius but remains structurally negative throughout.

Therefore the continuous captures do **not** demonstrate the requested oscillation between `STRUCTURAL-POSITIVE` and `STRUCTURAL-NEGATIVE` at one stationary known location.

Single-frame temporal instability is not a sufficient explanation for the dominant RCL-5 behavior.

## 14. TEMP-A — Pixel medoid

Pre-registered rule: choose the actual valid ROI minimizing total RGB L1 distance to all other valid frames; tie-break by earliest offset; no synthetic pixels.

Result: **NO COMMON RESCUE**.

Scale-aware results:

- Path `0.53836`
- Buddha `0.53454`
- General `0.50274`
- Prosperity `0.55526`
- Dreamfall `0.49046`

Structural gate reached: **0/5** known-GT controls.

## 15. TEMP-B — Pixelwise temporal median

Pre-registered rule: per-pixel/per-channel median over all nine valid 270×270 ROIs, then unchanged production resize/matcher semantics.

Result: **NO COMMON RESCUE**.

Scale-aware results:

- Path `0.53910`
- Buddha `0.53381`
- General `0.50336`
- Prosperity `0.55518`
- Dreamfall `0.48988`

Structural gate reached: **0/5**.

TEMP-B does not explain or repair General's historical/current discrepancy.

## 16. TEMP-C — Majority spatial candidate consensus

Pre-registered cluster radius: **96 z5 px**. Primary rank: distinct-frame temporal persistence. Original scores are secondary only; no score multiplication.

Result: **TEMPORAL UNSAFE**.

For all five known-GT sequences, the dominant coarse candidate cluster is persistent **9/9** but lies outside the frozen 60 z5 px correctness tolerance. Persistence therefore reinforces stable wrong basins rather than rescuing GT.

This is especially important architecturally: temporal persistence is not intrinsically corrective. A repeated false basin can become more confident under majority consensus.

## 17. TEMP-D — GT-blind temporal evidence median

The full fine-candidate TEMP-D aggregation was **not completed** and is not represented as complete.

Reason: the exact attached bundle was available in the local execution environment, but the available GitHub connector exposes no binary/file upload parameter that can transfer the 2.5 MB conversation attachment into the repository or Actions artifact store. Replacing the exact bytes, weakening bundle-SHA verification, or inventing a transport URL would violate Phase 0.

This gap does not create a TEMP-D success. TEMP-A/B already fail the frozen survivor rule and TEMP-C is demonstrably unsafe; therefore no method qualifies for Phase 9. The report makes no exact fine-level TEMP-D winner claim.

## 18. General stability classification

**G-STABLE-LOW**

Basis:

- all nine adjacent General frames remain below 0.58
- scale-aware same-run range is only `0.5017–0.5046`
- TEMP-A remains `0.50274`
- TEMP-B remains `0.50336`
- TEMP-C stabilizes a wrong basin rather than GT
- no shared temporal method survives cross-location criteria

`G-MIXED` is rejected for the ±1 s repeat window. `G-TEMPORAL-RECOVERABLE` is also rejected.

## 19. TS verdict + 40-frame result

**TS3 — TEMPORAL UNSAFE**

Decision basis:

1. nearby frames do not oscillate across the structural gate: **0/45 > 0.58**
2. deterministic medoid and pixel median do not rescue any known-GT control
3. the consensus method hardens 9/9-persistent wrong basins across Qinghe and Kaifeng
4. General repeat is stably low, not an adjacent-frame outlier
5. no frozen method satisfies the preregistered survivor rule

40-frame exact GFN stress fixture:

**SKIPPED BY PRE-REGISTERED RULE — NO SURVIVING TEMPORAL METHOD.**

This is not a missing optional experiment. Phase 9 explicitly runs only if a temporal method survives known-GT evaluation. Running it after all candidates fail would violate the frozen decision order.

## 20. Production research/change justification + authoritative CI coordinates

Production change justified: **NO**.

Temporal production-candidate task justified: **NO**.

Research implication: **single-frame temporal instability is not a sufficient explanation for A2/RCL-5, and simple deterministic temporal persistence/aggregation is not a safe rescue. If research continues, it needs a different representation/scoring architecture rather than lower gates, wider search, common-bridge retuning, or temporal majority confidence.**

Authoritative CI coordinates:

- run: **NONE**
- job: **NONE**
- artifact: **NONE**
- artifact digest: **NONE**
- acceptance: **NOT CI ACCEPTED**

Exact blocker: the conversation attachment itself cannot be supplied as a binary/file argument to the available GitHub write connector, so GitHub Actions cannot truthfully re-hash the exact `8773a3...` ZIP or reproduce all 54 fine-stage results. No new recording or owner acquisition is requested.

The machine-readable local evidence is stored in:

`docs/wwmsync/audits/temporal-representation-stability-local-evidence-2026-08-15.json`

The frozen temporal family and validity masks are stored in:

`docs/wwmsync/audits/temporal-representation-stability-preregistration-2026-08-15.json`
