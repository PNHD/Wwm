# WWMSync East Cross Public-Control Recovery — Final Public Attempt

Date: 2026-08-12

Branch: `feature/wwm-native-sync-v2`

## Decision

`CASE C — NO VALID PUBLIC CONTROL RECOVERED`

Formal public-evidence status:

`PUBLIC HUD CONTROL EVIDENCE EXHAUSTED`

This round exhausted the two explicitly requested BustinNutz TV YouTube IDs and provenance-preserving same-ID public mirror/API routes available to replay/CI. No byte-verifiable gameplay video was recovered, so no East Cross HUD frame was fabricated, inferred from matcher output, or evaluated as if it were a valid control.

The production structural gate remains `0.58` and no production matcher, cache, or preprocessing change is justified.

## 1. Verified starting HEAD

The branch ref was verified before work.

Expected and actual starting HEAD:

`c046fe79885aab2aa726b57bbc29227a6329ef1a`

Starting commit:

`docs(replay): record HUD domain discrimination audit`

No branch drift was present at the start.

## 2. Final HEAD

Final HEAD is the commit containing this report. See the final execution report for the exact SHA after this documentation commit.

## 3. Commits added in this round

1. `0f4117c7ab0cc0a7183a267f3a7357714bfd1658` — `ci(replay): add East Cross public video recovery probe`
2. `85af8a61b93c5a357a706df18b1e3abf902f2d16` — `ci(replay): attempt East Cross public video recovery`
3. `d0ca0fb56f73152f1116ee6cf1ad64487dff045a` — `ci(replay): add provenance-preserving mirror recovery`
4. `632a09a41a01a4f95dbcac1119f8de12cdf278e9` — `ci(replay): exhaust same-ID public mirror retrieval`
5. this documentation commit

All implementation added in this round is replay/CI-only retrieval/evidence code or documentation.

## 4. Exact public videos and retrieval attempts

### Lead 1

- YouTube ID: `SsHeUoAcIP0`
- indexed title: `Exploring Kaifeng 100% (Part 1)`
- source: `https://www.youtube.com/watch?v=SsHeUoAcIP0`
- indexed same-ID provenance page: `https://notes.qoo-app.com/note/4000108`

### Lead 2

- YouTube ID: `NOfdjOdFQ58`
- indexed title: `Exploring Kaifeng 100% (Part 2)`
- source: `https://www.youtube.com/watch?v=NOfdjOdFQ58`
- indexed same-ID provenance page: `https://notes.qoo-app.com/note/4007766`

### Direct YouTube replay/CI retrieval

Toolchain:

- `yt-dlp 2026.07.04`
- `ffmpeg 6.1.1-3ubuntu5`

For each exact ID, CI attempted in sequence:

1. default yt-dlp YouTube client
2. web player client
3. tv-embedded player client
4. android-vr player client

All eight download attempts failed before media resolution with YouTube's bot/authentication challenge:

`Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.`

Metadata resolution through yt-dlp was blocked by the same condition. Therefore there is no retrieved media resolution, codec/container, or media SHA-256 to report. Those fields are `N/A — no media bytes recovered`, not guessed.

### Provenance-preserving same-ID mirror recovery

After direct YouTube retrieval failed, CI tried public routes that preserve the exact same YouTube video ID:

Invidious `/api/v1/videos/:id`:

- `inv.nadeko.net` — HTTP 403 for both IDs
- `invidious.nerdvpn.de` — HTTP 401 for both IDs
- `yt.chocolatemoo53.com` — HTTP 403 for both IDs
- `invidious.tiekoetter.com` — HTTP 403 for both IDs

Piped `/streams/:videoId`:

- `pipedapi.kavin.rocks` — HTTP 403 for both IDs

Indexed QooApp pages were also requested from the CI runner. Both returned HTTP 202 with zero response bytes, so they could not serve media or an addressable embedded stream in CI.

No untraceable reupload, different creator video, or different YouTube ID was silently substituted.

## 5. Accepted / rejected frames

Accepted East Cross normal-HUD frames: **0**.

Rejected candidate frames: **none were extracted**, because no source video bytes were recovered.

This is intentionally distinct from a visual-frame rejection. There was no legitimate frame to inspect for normal HUD, location certainty, overlay state, or minimap visibility.

## 6. Independent ground-truth evidence

Ground truth was resolved before any matcher evaluation and did not use matcher output.

Dashen point API:

`https://inf.ds.163.com/v1/web/game-map/point/list-by-sub-types`

Query:

- mapId: `676d48a37d299d0811946ff1`
- subTypes: `[1, 2]`
- mapZone: `map12`

Fresh CI evidence:

- HTTP: `200`
- raw bytes: `2557045`
- raw SHA-256: `22f614f1101b78f818bd02ef24a28dd23f93bd98067212bf5866cd358eb76b6e`
- exact matching records: `1`

Exact point:

- pointId: `20212`
- name: `东十字街`
- layer: `0`
- mapSubType: `1`
- world: `(-107.941, -1227.2615)`
- Dashen z5: `(5219.931321637427, 4648.817136173768)`

The raw API SHA exactly matches the prior public-HUD audit evidence, independently reproducing the target coordinate.

Public guide provenance establishes East Cross Street Boundary Stone as the relevant location and credits gameplay images around that sequence to BustinNutz TV. That creator-level provenance was not treated as proof that either requested Part 1/Part 2 ID contains a particular exact frame.

## 7. HUD ROI provenance

No East Cross source frame was accepted, therefore no East Cross ROI was generated.

The required production semantic ROI contract remains unchanged:

- `unit = min(videoWidth, videoHeight)`
- default `roiFraction = 0.25`
- default ROI center = `(unit * 0.125, unit * 0.125)`
- default semantic crop begins at source `(0, 0)`
- work canvas = `192 x 192`

Applying that crop to nonexistent/unverified media would fabricate evidence, so Phase 3 was correctly not run.

## 8. Unchanged production matcher result

East Cross production global matcher: **NOT RUN / NOT EVALUABLE**.

Reason: no byte-verifiable, independently located normal Global PC HUD frame was recovered.

Therefore there is no East Cross TOP-K, expected-basin rank, distance, coarse score, raw structure, scale-aware structure, intensity, NCC, combined score, angle, scale, or matchGate decision to report.

This absence is not classified as HUD-FAIL.

## 9. Expected-basin local diagnostic

East Cross known-coordinate local diagnostic: **NOT RUN / NOT EVALUABLE**.

The local fixed-coordinate diagnostic is valid only after there is a real accepted HUD image. Running it against invented, unrelated, or provenance-uncertain pixels would not answer the requested question.

## 10. East Cross Street HUD PASS / FAIL

`NOT EVALUABLE — NO VALID PUBLIC CONTROL RECOVERED`

It is neither PASS nor FAIL.

This round is `CASE C`.

## 11. Comparison with Fang Xu HUD

The previous Steam Global PC Fang Xu control remains the only accepted current normal-HUD known-location public control.

Fang Xu result retained from the validated previous round:

- classification: `HUD-FAIL`
- expected basin absent from global TOP-8 within the independently chosen 60 z5 px tolerance
- false rank-1 basin passed matchGate
- known-coordinate local diagnostic remained viable:
  - radius `96`
  - scale `2.4`
  - angle `60 deg`
  - raw structure `0.603392`
  - scale-aware structure `0.599451`
  - intensity `0.574096`
  - NCC `0.510211`
  - combined `0.597423`
  - local diagnostic gate `PASS`

East Cross cannot become a second HUD-FAIL because no valid frame was recovered.

## 12. H1 / H2 status

H1 remains:

`H1-INDICATIVE`

The evidence still consists of:

- FULL-MAP General Shrine positive control = PASS
- Steam Global PC Fang Xu normal HUD = HUD-FAIL
- Fang Xu expected neighborhood locally viable above `0.58`
- Fang Xu failure occurs at global expected-basin candidate recall/surfacing

The final public attempt did not produce a second accepted normal-PC HUD control, so H1 is not promoted using fabricated or missing evidence.

H2 remains:

`NOT CAUSALLY TESTABLE`

There is still no known-location normal-PC HUD PASS on which controlled GFN degradation can be a valid intervention.

## 13. Controlled degradation

`NOT RUN / NOT JUSTIFIED`

CASE A prerequisite was not met. There is no East Cross known-good HUD to degrade.

No resize/downsample-upsample, chroma reduction, compression approximation, blur/sharpening, contrast, or gamma intervention was run against a failing/unverified control.

No replay normalization and no production preprocessing change is justified.

## 14. Whether public evidence is exhausted

Yes.

Formal declaration:

`PUBLIC HUD CONTROL EVIDENCE EXHAUSTED`

For this pre-owner-acquisition round, the two specifically requested source video IDs were attempted through multiple direct yt-dlp client paths and then same-ID credible public mirror/API paths. None yielded byte-verifiable media.

Continuing generic scraping or switching to unrelated videos would start a new research round rather than complete the requested final recovery attempt.

## 15. Whether owner acquisition is now required

Yes — **Stage-A still acquisition only**.

Required owner evidence:

### General's Shrine Boundary Stone

Dashen z5:

`(6015.0171, 3889.3606)`

### East Cross Street Boundary Stone

Dashen z5:

`(5219.9313, 4648.8171)`

For each location:

- native/current Global PC
- one full-screen still
- stationary player
- normal gameplay HUD/minimap visible
- world map closed
- photo mode off
- no video required

Do **not** request ordinary live E2E at this stage.

## 16. Production-change justification

None.

This round does not justify changing:

- structural gate `0.58`
- production matcher
- production candidate ranking
- production cache
- production preprocessing
- ORB/XFeat/XFeat*/DINO or another learned matcher
- score calibration/inflation

The next evidence question after owner Stage-A acquisition remains:

`HUD → reference representation / expected-basin global candidate recall`

Only the owner controls can determine whether that question is now supported across two regions or whether a normal-PC positive control makes H2 testable.

## 17. CI runs, jobs, artifacts, digests

### Direct-video recovery

- workflow: `Recover WWMSync East Cross Public Video Control`
- run: `31614888553`
- head: `85af8a61b93c5a357a706df18b1e3abf902f2d16`
- job: `94175109711` / `recover-public-video-control`
- job conclusion: `success`
- evidence classification: `PUBLIC-VIDEO-RETRIEVAL-FAILED`
- retrieved video count: `0`
- artifact: `9148799306`
- artifact name: `wwmsync-east-cross-public-video-31614888553`
- artifact size: `225433` bytes
- artifact digest: `sha256:f722b56b12961894c6103344c7e4f29e3035cc58e6aed7d1f3239b016a3182eb`

The job succeeded because the diagnostic workflow correctly completed and recorded the negative retrieval result; it does not mean video retrieval succeeded.

### Same-ID mirror recovery

- workflow: `Recover WWMSync East Cross Same-ID Mirrors`
- run: `31615298882`
- head: `632a09a41a01a4f95dbcac1119f8de12cdf278e9`
- job: `94176487780` / `recover-provenance-mirrors`
- job conclusion: `success`
- evidence classification: `PUBLIC-MIRROR-RETRIEVAL-FAILED`
- retrieved video count: `0`
- artifact: `9148963268`
- artifact name: `wwmsync-east-cross-mirrors-31615298882`
- artifact size: `1034` bytes
- artifact digest: `sha256:6826fe6d7c2ac0774967861ffa97afb7c8211f1c2dc9bbbbfa0289a5de3ae24e`

Again, successful job execution records a negative retrieval result rather than a recovered video.

### Prior retained public-HUD audit evidence

- run: `31609680755`
- artifact: `9146646914`
- artifact name: `wwmsync-public-hud-controls-31609680755`
- artifact digest: `sha256:b305444dff3ac2db6a544020093bd64022ffef5406c246849499d6a96525c041`

This prior artifact supplied the independently retained Fang Xu and Dashen point evidence; the East Cross point was independently re-resolved again in the new direct-video workflow.

## 18. Final acceptance

- SYNTHETIC = PASS
- REAL GFN = FAIL
- REAL LOCAL = UNAVAILABLE
- EAST CROSS PUBLIC HUD CONTROL = NOT RECOVERED / NOT EVALUABLE
- PUBLIC HUD CONTROL EVIDENCE = EXHAUSTED
- H1 = INDICATIVE, not promoted using missing evidence
- H2 = NOT CAUSALLY TESTABLE
- CONTROLLED DEGRADATION = NOT JUSTIFIED
- PRODUCTION STRUCTURAL GATE = `0.58`, unchanged
- PRODUCTION MATCHER/CACHE/PREPROCESSING = unchanged
- LIVE E2E = PENDING / NOT JUSTIFIED
- OWNER STAGE-A TWO-STILL ACQUISITION = REQUIRED NEXT

No acceptance status was inflated to compensate for unavailable public media.
