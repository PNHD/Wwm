# General Shrine map-state / reference-discrepancy audit

- Verdict: **R1 — REGISTRATION FALSE CONSENSUS**
- Frozen GT z5: `[6015.017126148705, 3889.360588972433]`; production gate `0.58` unchanged; production modified: **NO**.
- Prior homography false-consensus assessment: **True** (condition `2.659`, det `-1.12294e-08`, projective norm `0.0159308`, prior GT residual `1116.337` z5 px).
- Anchor: prior `[1140.736, 248.544]`, provenance alternative `[1141.3446327683616, 253.3050847457627]`, delta `4.800` screen px; anchor-only resolution: **False**.

## Local expected-neighborhood
- z3 fixed: `{"radius": 384, "check": "ratio", "best_model": "homography", "matches": 20, "inliers": 14, "inlier_ratio": 0.7, "residual": 15.462257403916002, "condition": 1.0227795969469955, "rotation_deg": -0.33304795079330357, "scale": 0.27288948674498237, "appearance": {"overlap_pixels": 3285, "ncc": 0.8994477833067281, "ssim": 0.8021862321650809, "edge_agreement_2px": 0.8014285714285714}}`
- z3 provenance-anchor: `{"radius": 384, "check": "ratio", "best_model": "homography", "matches": 20, "inliers": 14, "inlier_ratio": 0.7, "residual": 15.232553825298321, "condition": 1.0227795969469955, "rotation_deg": -0.33304795079330357, "scale": 0.27288948674498237, "appearance": {"overlap_pixels": 3285, "ncc": 0.8994477833067281, "ssim": 0.8021862321650809, "edge_agreement_2px": 0.8014285714285714}}`
- z5 fixed: `{"radius": 512, "check": "ratio", "best_model": "similarity", "matches": 78, "inliers": 74, "inlier_ratio": 0.9487179487179487, "residual": 61.111698814210584, "condition": 1.0000000000000002, "rotation_deg": -0.08835733350830825, "scale": 1.097931563039075, "appearance": {"overlap_pixels": 53703, "ncc": 0.9221143556759291, "ssim": 0.8133606232182116, "edge_agreement_2px": 0.7891346360317801}}`
- z5 provenance-anchor: `{"radius": 512, "check": "ratio", "best_model": "similarity", "matches": 78, "inliers": 74, "inlier_ratio": 0.9487179487179487, "residual": 60.172539791421116, "condition": 1.0000000000000002, "rotation_deg": -0.08835733350830825, "scale": 1.097931563039075, "appearance": {"overlap_pixels": 53703, "ncc": 0.9221143556759291, "ssim": 0.8133606232182116, "edge_agreement_2px": 0.7891346360317801}}`
- Strong anchored local support: **True**.

## Three-way A/B/C
- A prior FULL-MAP → C Dashen: **strong**; similarity, inliers=26/37, residual=0.1413117719013855, cond=1.000, rot=-0.10°
- A prior FULL-MAP → B owner GFN map: **not strong**; homography, inliers=83/93, residual=57.02939617565202, cond=1.008, rot=0.01°
- B owner GFN map → C Dashen expected neighborhood: **strong**.

## Zoom / layer / revision
- z3/z5 are treated as one physical GT pyramid, never independent GT. z3={"radius": 384, "check": "ratio", "best_model": "homography", "matches": 20, "inliers": 14, "inlier_ratio": 0.7, "residual": 15.232553825298321, "condition": 1.0227795969469955, "rotation_deg": -0.33304795079330357, "scale": 0.27288948674498237, "appearance": {"overlap_pixels": 3285, "ncc": 0.8994477833067281, "ssim": 0.8021862321650809, "edge_agreement_2px": 0.8014285714285714}}; z5={"radius": 512, "check": "ratio", "best_model": "similarity", "matches": 78, "inliers": 74, "inlier_ratio": 0.9487179487179487, "residual": 60.172539791421116, "condition": 1.0000000000000002, "rotation_deg": -0.08835733350830825, "scale": 1.097931563039075, "appearance": {"overlap_pixels": 53703, "ncc": 0.9221143556759291, "ssim": 0.8133606232182116, "edge_agreement_2px": 0.7891346360317801}}.
- Map state: `main / mapSubType 1 / map12 (General Shrine GT catalog lineage)`. sub4 is only a legitimate alternate-family negative control; no arbitrary coordinate remap was attempted.
- Revision probe: main available `[15]`, pinned/latest `15/15`, newer main revision: `False`.

## Decision implications
- verdict: `R1 — REGISTRATION FALSE CONSENSUS`
- old_homography_false_consensus: `True`
- reference_content_drift: `not established`
- prior_D3_changes: `True`
- H1_implication: `strengthened to replay-bridge-eligible`
- H2_implication: `weakened`
- common_bridge_research_justified: `True`
- native_pc_required: `False`
- production_change_justified: `False`

## Acceptance
Replay/CI-only diagnostic. No production matcher/cache/preprocessing edits. Structural gate `0.58` unchanged.

## Authoritative CI
- run: 31761799973
- job: 94649553868
- artifact: 9204882854
- artifact digest: 6233d52dbd710380a5650793817130536544e6dffeb9c5a32a6ef8e807d80026
- acceptance: CI ACCEPTED — bounded replay/CI-only discrepancy audit; production untouched.
