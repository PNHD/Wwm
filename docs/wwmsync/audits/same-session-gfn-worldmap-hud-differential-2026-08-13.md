# WWMSync — Same-session GFN world-map ↔ HUD differential audit

> Replay/CI-only research. Production matcher/cache/preprocessing are untouched. Production structural gate remains **0.58**. Research scores are diagnostic, not production matchGate substitutes.

## 1. Verified starting HEAD
- Expected / verified audit parent: `f199258d4abdebe8f3ae75d99b56442ef76e1e38`
- Workflow implementation HEAD: `dd524bb6112e0884c4e1ee2df737fbacfa8f4703`
- First audit commit parent: `f199258d4abdebe8f3ae75d99b56442ef76e1e38`
- Verification: **PASS**

## 2–4. Commits, exact owner-source provenance, and replay carriers
- **Exact original owner bytes remain authoritative provenance.** CI replay carriers below are transport derivatives only; they are not relabeled as original screenshots.
- **east_cross_map ORIGINAL** — `2048×863`, 2728396 bytes, SHA-256 `1dffb5a484be50d753e40472dc8ef9f84d22633fa6ef2a976a81aee6f1536e9e`.
- **east_cross_hud ORIGINAL** — `2048×863`, 3879098 bytes, SHA-256 `c20d317a745b897b2d9cfb6d622521b2327afd961b8adae4649eaed23de256ad`.
- **general_shrine_map ORIGINAL** — `2048×863`, 3027787 bytes, SHA-256 `99841c9b467a63299cded38d3598e5ef136e349f0896cc21d31275b9e7c88de7`.
- **general_shrine_hud ORIGINAL** — `2048×863`, 3879049 bytes, SHA-256 `dd73ea17c9a269535b74eb7fd83bd491df2bdbba56dcd2f7d9be074068120378`.
- World-map inputs: exact derivative JPEGs are normal tracked repository files; SHA-256, JPEG SOI/EOI, Pillow/OpenCV decode and dimensions are verified before audit execution. Replay carriers are built only after that verification.
- HUD carriers: reconstructed from the authoritative `192×192` work canvases in run `31666927302` / artifact `9168284675`; authoritative HUD matcher results are reused and are **not** rerun or redefined by these carriers.
- The authoritative audit has no runtime dependency on recovery artifacts, legacy carriers, raw Git blob SHAs, or conversation attachments. GT, the production gate, production code, and source provenance remain unchanged.
- Implementation commits are the first-parent commits between the verified start and workflow HEAD; generated report commit is appended by CI after artifact upload.
- **east_cross_map** — `2048×863`, 360243 bytes, SHA-256 `0b5059100bc285169e07be2db8a587438e878e9d8cb948298f792d5da42749a1`; recovered path `east-cross-world-map.png`
- **east_cross_hud** — `2048×863`, 97310 bytes, SHA-256 `a6a4a96c6174a8114c65b88b0da2301eaedbb7601f2271947058efbd0672e355`; recovered path `east-cross-gameplay-hud.png`
- **general_shrine_map** — `2048×863`, 232514 bytes, SHA-256 `b42807922d54b2368edf8d7552d8e563539fa2c63832840b269d7e4cdc615df9`; recovered path `general-shrine-world-map.png`
- **general_shrine_hud** — `2048×863`, 77185 bytes, SHA-256 `af5d1ab022af5f5dbfc284e47544a1572a1e830bb10d6d8c94762517c5b51910`; recovered path `general-shrine-gameplay-hud.png`
- Reused authoritative HUD run `31666927302`, artifact `9168284675`; HUD verdicts are not rerun.

## 5. East Cross Street world-map → Dashen registration
- Independent GT z5 `[5219.931321637427, 4648.817136173768]`, pointId `20212`
- Reference `.audit-output/east_cross_dashen_tile_mosaic.png`, SHA-256 `5c89aa1364d7a3b1b25e73cbfcef0f0dab77650c82fa62495e7869c34ba9e18a`, origin `[4352, 3840]`, provenance `tile-cache 7x7 mosaic`.
- Features source/reference **6395 / 8000**; ratio matches **141**; RANSAC inliers **117**; inlier ratio **0.830**.
- Model `homography`; transform `[[0.29313816642762547,-0.0012190759984740509,690.6677099357461],[0.005222606346433275,0.2846317754182143,724.145248245102],[6.162277027830605e-06,-1.4010388218248747e-06,1.0]]`; median reprojection `0.3965412676334381` px; selected-marker→independent-GT residual `0.6241997810517838` z5 px.
- Expected-area diagnostic structure `0.7335`, edge `0.8684`, SSIM `0.1566`, wrong-neighborhood percentile `100.0`, margin `0.1200`.
- **MAP-REFERENCE-STRONG**

## 6. General's Shrine world-map → Dashen registration
- Independent GT z5 `[6015.017126148705, 3889.360588972433]`
- Reference `.audit-output/general_shrine_dashen_tile_mosaic.png`, SHA-256 `138f7a8da4ce8dc82e5f4b337f20faa860ed086852c527f69664ce33164461f6`, origin `[5120, 3072]`, provenance `tile-cache 7x7 mosaic`.
- Features source/reference **6047 / 8000**; ratio matches **38**; RANSAC inliers **10**; inlier ratio **0.263**.
- Model `homography`; transform `[[0.01565118089858836,-0.5576747999181554,35.0112624309721],[0.6842393611143756,-24.350794328630364,1529.0573435636682],[0.0004473998990682256,-0.015924560096007092,1.0]]`; median reprojection `0.09001480042934418` px; selected-marker→independent-GT residual `1116.3369464322436` z5 px.
- Expected-area diagnostic structure `0.4669`, edge `0.5027`, SSIM `0.1927`, wrong-neighborhood percentile `87.5`, margin `-0.0739`.
- **MAP-REFERENCE-WEAK**

## 7. MAP-REFERENCE classifications
- East Cross Street: **MAP-REFERENCE-STRONG**
- General's Shrine: **MAP-REFERENCE-WEAK**

## 8. World-map vs HUD domain metrics
### East Cross Street
- world-map raw: edge `0.0135`, luminance `0.6148`, contrast `0.1922`, entropy `7.041`, HF `0.008`, quiet `0.608`, features/kpx `3.101`.
- HUD raw: edge `0.1574`, luminance `0.4315`, contrast `0.2165`, entropy `7.522`, HF `0.088`, quiet `0.223`, overlay `0.079`.
- HUD diagnostic masked: edge `0.1231`, contrast `0.2218`, entropy `7.487`, HF `0.074`, quiet `0.248`.
- orientation map `[0.196, 0.09, 0.086, 0.125, 0.169, 0.08, 0.081, 0.129, 0.044]` vs HUD `[0.148, 0.079, 0.082, 0.131, 0.193, 0.096, 0.077, 0.152, 0.041]`; radial HUD edge `[0.0914, 0.1893, 0.1708, 0.1434]`; geometry `{'crop_size': 216, 'circle_center': [75.6, 73.44000000000001], 'circle_radius': 72.36}`.
### General's Shrine
- world-map raw: edge `0.0133`, luminance `0.6097`, contrast `0.1902`, entropy `6.639`, HF `0.006`, quiet `0.776`, features/kpx `1.615`.
- HUD raw: edge `0.0506`, luminance `0.4336`, contrast `0.1599`, entropy `6.707`, HF `0.042`, quiet `0.505`, overlay `0.001`.
- HUD diagnostic masked: edge `0.0526`, contrast `0.1600`, entropy `6.701`, HF `0.042`, quiet `0.507`.
- orientation map `[0.097, 0.089, 0.111, 0.161, 0.266, 0.103, 0.087, 0.074, 0.011]` vs HUD `[0.106, 0.138, 0.207, 0.162, 0.149, 0.083, 0.074, 0.072, 0.01]`; radial HUD edge `[0.0748, 0.0425, 0.0431, 0.056]`; geometry `{'crop_size': 216, 'circle_center': [75.6, 73.44000000000001], 'circle_radius': 72.36}`.

## 9. Direct HUD ↔ owner world-map local relation
- **East Cross Street** coherent=`True`; scale `0.3319`, rotation `255.0°`, shift (6,3), edge `0.9249`, score `0.7610`, null margin `0.0236`.
- **General's Shrine** coherent=`True`; scale `0.4097`, rotation `292.0°`, shift (3,-6), edge `0.8401`, score `0.7224`, null margin `0.0447`.

## 10. Common representation difference
**NO.** Predeclared cross-location coherence/scale-consistency conditions were not met; Phase 4 was not built.

## 11–12. Frozen bridge experiment / cross-control results
Not justified; no bridge was tuned or run.

## 13. Impact on Steam Fang Xu
No bridge justified; prior Fang Xu control remains unchanged.

## 14. Impact on exact real 40-frame GFN fixture
No bridge justified; authoritative production fixture verdict remains FAIL.

## 15–18. Decision
- **D3 — MIXED**
- **H1/H2:** One location is strong while the other is not; map state/layer/zoom/location differences must be resolved before choosing H1 or H2. Contradictory controls are not averaged.
- **Production change justified: NO.** Gate `0.58`, production matcher/cache/preprocessing unchanged.
- **Native-PC acquisition:** DEFER until the mixed map-state/layer/zoom discrepancy is exhausted; if unresolved, YES for same-location discrimination.

## 19. Authoritative CI
- Run: `31759922863`
- Job: `94643881101`
- Artifact: `9204236942` (`wwmsync-same-session-gfn-differential-31759922863`)
- Artifact digest: `ddafa809bee15cbe7da2c0f7e8d3354ca9a4e834022e6fb7d13cb643d4762793`
- Evidence-bundle SHA-256: `8f7f0ae28f12dd9e0542457d767f77b6aecc948fb25d9ea7f733a8412f55f018`

## 20. Final acceptance
**AUDIT COMPLETE — D3; NO COMMON BRIDGE JUSTIFIED; PRODUCTION CHANGE NOT JUSTIFIED**

### Guardrails
- No threshold lowering or score inflation; research scores remain separate from production matchGate.
- No production matcher/cache/preprocessing changes; no ORB/XFeat/DINO/LoFTR global research; no false-basin optimization.
- Owner controls calibrate a common bridge only if both agree; they are not claimed as independent validation.
