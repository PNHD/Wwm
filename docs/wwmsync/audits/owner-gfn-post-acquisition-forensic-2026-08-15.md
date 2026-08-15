# WWMSync Owner GFN Post-Acquisition Forensic — 2026-08-15

## Verdict

**A2 — DOMINANT LOCAL DISCRIMINATION CLASS. Production change: NO.**

The planned owner-GFN unique set is n=7, but Ethereal Chamber is legitimately `NOT-EVALUABLE_REFERENCE_FAMILY` because the capture is Floor 2 while the frozen production reference lineage is the main/layer-0 family. Per the preregistered fallback, RCL frequency therefore uses n=6 evaluable unique locations. RCL-5 occurs in 5/6; the remaining unique location (existing General) is RCL-MIXED. This is descriptive only.

## Provenance / freeze

- Verified starting HEAD before work: `9d2839909adb1739851acb7eb1e9c4fd97d43647`.
- Identity/GT freeze committed before HUD outcome inspection: `8635dc4e9a65977e68ed884a01cd160acd852bf5`.
- Source video provenance is manifest-declared SHA `a6417900…061b7`; original MP4 bytes were not inside the extraction ZIP, so that SHA could not be independently recomputed.
- Extraction ZIP SHA: `42239cf1…154a8`; 12/12 PNG hashes verified, all 1920×1080, pairing/timestamps verified.
- Production ROI semantics: source crop `(0,0,270,270)` -> 192×192 work canvas, no new preprocessing.
- Structural gate 0.58, intensity gate 0.42, coarse beam 8 unchanged. Protected production blobs unchanged.

## Frozen identity / GT

- **Path of Void** — `20121` / `缘尽去路` / Qinghe / world `[-1142.2738, -3680.6323]` / catalog z5 `[5662.35270309106, 3599.42210726817]` / EVALUABLE
- **Buddha Fort** — `20119` / `佛爷寨` / Qinghe / world `[-2283.086, -3399.3186]` / catalog z5 `[6150.319157894736, 3719.750105931495]` / EVALUABLE
- **General's Shrine repeat** — `20102` / `将军祠` / Qinghe / world `[-1966.7646484375, -3002.78784179687]` / catalog z5 `[6015.017126148705, 3889.360588972433]` / EVALUABLE
- **Prosperity Haven** — `20264` / `寿昌坊` / Kaifeng / world `[501.634796142578, -1605.4375]` / catalog z5 `[4959.193804824561, 4487.057644110276]` / EVALUABLE
- **Ethereal Chamber** — `20206` / `旷虚幽间` / Kaifeng / world `[1356.4479980469, -1884.3465576172]` / catalog z5 `[4593.559419381777, 4367.758197577271]` / NOT_EVALUABLE_REFERENCE_FAMILY / **Floor 2**
- **Dreamfall Cliff** — `20240` / `望淮南崖` / Kaifeng / world `[279.714, -330.7376]` / catalog z5 `[5054.117319966583, 5032.292689055973]` / EVALUABLE

## Production replay + local forensic

### Path of Void — RCL-5

- First coarse loss: `spatial NMS -> 8/radius`; fine first loss: `fine initial lattice generated`.
- Exact-GT: structure `0.2591`, scale-aware `0.5355`, intensity `0.4311`, NCC `0.3458`, combined `0.5272`.
- Strongest wrong local max combined `0.5151`; discrimination `0.0121`; basin width ~`128.1px`.
- Final winner distance `341.5px`; gate `ACCEPT` (`accepted`).
- Full TOP-8 and every exposed coarse + exact fine-stage checkpoint are in the JSON evidence.

### Buddha Fort — RCL-5

- First coarse loss: `per-seed refinement structural TOP42 + one hypothesis`; fine first loss: `fine intensity TOP120 per hypothesis`.
- Exact-GT: structure `0.2257`, scale-aware `0.5248`, intensity `0.3735`, NCC `0.2795`, combined `0.5127`.
- Strongest wrong local max combined `0.4951`; discrimination `0.0176`; basin width ~`107.7px`.
- Final winner distance `808.5px`; gate `REJECT` (`global-ambiguous 0.001`).
- Full TOP-8 and every exposed coarse + exact fine-stage checkpoint are in the JSON evidence.

### Prosperity Haven — RCL-5

- First coarse loss: `TOP90/radius structural rescore`; fine first loss: `fine initial lattice generated`.
- Exact-GT: structure `0.3036`, scale-aware `0.5471`, intensity `0.4364`, NCC `0.3518`, combined `0.5382`.
- Strongest wrong local max combined `0.4879`; discrimination `0.0503`; basin width ~`20.0px`.
- Final winner distance `658.0px`; gate `ACCEPT` (`accepted`).
- Full TOP-8 and every exposed coarse + exact fine-stage checkpoint are in the JSON evidence.

### Dreamfall Cliff — RCL-5

- First coarse loss: `spatial NMS -> 8/radius`; fine first loss: `fine intensity TOP120 per hypothesis`.
- Exact-GT: structure `0.2681`, scale-aware `0.5029`, intensity `0.1599`, NCC `0.0339`, combined `0.4754`.
- Strongest wrong local max combined `0.4903`; discrimination `-0.0148`; basin width ~`169.7px`.
- Final winner distance `171.6px`; gate `ACCEPT` (`accepted`).
- Full TOP-8 and every exposed coarse + exact fine-stage checkpoint are in the JSON evidence.

### Ethereal Chamber — NOT-EVALUABLE

- Capture is **Floor 2**. Catalog teleport anchor is layer 0; nearby catalog records establish real layer-2 state, but production map-2 has no independently established Floor-2 visual reference/coordinate bridge.
- Unchanged matcher was still run as an anchor-relative robustness stress; its apparent accepted candidate **must not** be called true/false localization evidence and no RCL class is assigned.

## General Shrine repeatability

**REPEAT-UNSTABLE.** Same independent GT, materially different mechanism:

- Existing authoritative General: RCL-MIXED (RCL-2 + RCL-4), first loss NMS, local scale-aware structure `0.5999`, intensity `0.3605`.
- New repeat: RCL-5, first loss `TOP90/radius structural rescore`, fine loss `fine intensity TOP120 per hypothesis`, local scale-aware structure `0.5086`, intensity `0.4673`.
- Therefore one screenshot is not a stable representation of location behavior.

## Unique owner-GFN RCL frequency

- Acquisition set: 7 unique locations; evaluable RCL denominator: 6; Ethereal: 1/7 NOT-EVALUABLE.
- RCL-5: **5/6 = 83.3%**, Wilson 95% **43.6–97.0%**.
- RCL-MIXED: **1/6 = 16.7%**, Wilson 95% **3.0–56.4%**.
- RCL-1/2/3/4 as final frozen classes: **0/6** each, Wilson upper bound ~39.0%.
- General repeat is reported separately and never counted as an eighth location.

## Morphology / map-state association

- Path of Void: sparse/low-edge and highly ambiguous reference -> RCL-5.
- Dreamfall Cliff: moderate-edge, more structurally unique Kaifeng reference -> still RCL-5.
- Buddha Fort and Prosperity Haven were near existing-control neighborhoods -> still RCL-5.
- General repeat changes mechanism at identical GT -> screenshot/render-state variability matters independently of location morphology.
- Ethereal Floor 2 is a separate layered map-state/reference-lineage issue, excluded from RCL frequency.

## Architecture decision

**A2.** RCL-5 materially dominates the evaluable unique sample across two regions and heterogeneous reference contexts. Candidate beam/search changes are deprioritized; representation/scoring stability is primary.

Exact implication: a single HUD screenshot is not a stable enough representation. The next justified research task is a bounded **temporal representation-stability / evidence-aggregation audit** using existing recordings/fixtures only, unchanged per-frame gates, and no reopened common bridge sweep, beam expansion, threshold lowering, or learned model.

**Production change justified: NO.**

## Execution note

The sandbox blocks Chromium `localhost`/`file://`. Replay therefore executed exact production matcher/search/gate JavaScript with unchanged input/reference pixels through a raw Canvas emulation; the repo-accepted exact fine-stage tracer was also used. The final GitHub Actions acceptance job validates protected production blobs, frozen denominator/classification invariants, and publishes the report/evidence artifact; it does not claim browser-raster bit identity for the sandbox replay.
