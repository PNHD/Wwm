# WWMSync Existing-Signal Separability / Score-Architecture Forensic Audit — 2026-08-15



**Verdict: SS0 — PRIMITIVE SIGNALS NON-SEPARABLE. Production change: NO.**



## 1. Verified starting HEAD
`f8df34ba99321e97cf55e3981556807a62c6434f`; CI source `393de45d21a00c09b752781257a9922b030d9ef4`.

## 2. Final HEAD
Report-only CI commit follows artifact upload; exact final branch HEAD is reported externally.

## 3. Commits

- `33a82fbc04306fe9a6246283959321bf0e403ee5` — docs(wwmsync): freeze signal separability audit [skip ci]

- `c02cffd1a1b3bc3ca8d15091938ca9df99e16f9a` — tools(wwmsync): add signal separability forensic analyzer [skip ci]

- `4202ee46290b44968ce31fffb31baf6c1b50d50c` — ci(wwmsync): add signal separability forensic audit

- `393de45d21a00c09b752781257a9922b030d9ef4` — ci(wwmsync): fix candidate graph schema guard

## 4. Production guards
Protected blobs unchanged; structural 0.58, intensity 0.42, beam 8.

## 5. Exact evidence / artifact provenance

- candidateRecall: run `31769654943`, job `94672779698`, artifact `9207636803`, digest `sha256:415cef6cafe43a2509b1b541c8f2f2e3d72cbb835cca5505f124f65955062ed0`

- candidateFineStage: run `31768239431`, job `94668491244`, artifact `9207148249`, digest `sha256:ce858250c81ee3adf6efa9704a9cd22f87e7ffa2dde0c5c2ae9d9b9f9ee1ac39`

- generalCorrectedReference: run `31761799973`, job `94649553868`, artifact `9204882854`, digest `sha256:6233d52dbd710380a5650793817130536544e6dffeb9c5a32a6ef8e807d80026`

- commonHudBridge: run `31764340615`, job `94657000684`, artifact `9205755503`, digest `sha256:cb0b0f2a3eac0ee8b8993c1aed8bf17799e52433f58f145146688deb1667f7c4`

- ownerPostAcquisition: run `31872599823`, job `94983436586`, artifact `9243841549`, digest `sha256:e7786742e2e355c0d16d42d94b383db2f2a489e818a61dd955420f1aa0072b7a`

## 6. Primitive feature definitions / dependencies
Common fine: scaleAwareStructure + raw intensityNcc. intensityScore and combined/rank scores are derived and excluded as independent Pareto dimensions. Extended local atomizes the structural composite where constituents are exposed.

## 7. Candidate-table inventory
Rows: **212**; stages `{'fine-local-landscape': 6, 'fine-finalist': 24, 'fine-correlation-sample': 108, 'coarse-hypothesis': 24, 'fine-local-oracle': 5, 'fine-final-winner': 5, 'coarse-top8': 40}`. Coarse rows remain stage-separated.

## 8. East Cross Pareto result
Dominating wrong: **25**; front `False`; front rank `8`; correct `{'scaleAwareStructure': 0.5135916331749516, 'intensityNcc': 0.21170319435229315}`; nearest dominator `east-cross:corr:20` `{'scaleAwareStructure': 0.5577653221598287, 'intensityNcc': 0.43904059922076377}`; dominance dimensions `['scaleAwareStructure', 'intensityNcc']`.

## 9. General historical Pareto result
Dominating wrong: **0**; front `True`; front rank `1`; correct `{'scaleAwareStructure': 0.5998666758116005, 'intensityNcc': 0.2646043092840628}`; nearest dominator `None` `None`; dominance dimensions `[]`.

## 10. Path of Void Pareto result
Dominating wrong: **1**; front `False`; front rank `2`; correct `{'scaleAwareStructure': 0.5355426641098889, 'intensityNcc': 0.3457984616456733}`; nearest dominator `path-of-void:final` `{'scaleAwareStructure': 0.6102955610132287, 'intensityNcc': 0.5805479976509077}`; dominance dimensions `['scaleAwareStructure', 'intensityNcc']`.

## 11. Buddha Fort Pareto result
Dominating wrong: **1**; front `False`; front rank `2`; correct `{'scaleAwareStructure': 0.5247591291015966, 'intensityNcc': 0.2794791968757558}`; nearest dominator `buddha-fort:final` `{'scaleAwareStructure': 0.6181885119038288, 'intensityNcc': 0.669913660458947}`; dominance dimensions `['scaleAwareStructure', 'intensityNcc']`.

## 12. Prosperity Haven Pareto result
Dominating wrong: **1**; front `False`; front rank `2`; correct `{'scaleAwareStructure': 0.5470713174056286, 'intensityNcc': 0.3518143729448119}`; nearest dominator `prosperity-haven:final` `{'scaleAwareStructure': 0.6743643341697816, 'intensityNcc': 0.7860345354332462}`; dominance dimensions `['scaleAwareStructure', 'intensityNcc']`.

## 13. Dreamfall Cliff Pareto result
Dominating wrong: **1**; front `False`; front rank `2`; correct `{'scaleAwareStructure': 0.5028816161470961, 'intensityNcc': 0.03387252114448036}`; nearest dominator `dreamfall-cliff:final` `{'scaleAwareStructure': 0.6729078546634494, 'intensityNcc': 0.7960995691321078}`; dominance dimensions `['scaleAwareStructure', 'intensityNcc']`.

## 14. Fang Xu Pareto result
Dominating wrong: **4**; front `False`; front rank `4`; correct `{'scaleAwareStructure': 0.6091509755786805, 'intensityNcc': 0.5191574689328196}`; nearest dominator `fang-xu:corr:13` `{'scaleAwareStructure': 0.6222746822359757, 'intensityNcc': 0.7394303588510942}`; dominance dimensions `['scaleAwareStructure', 'intensityNcc']`.

## 15. General historical-vs-repeat drift classification
**SD-DOMINANCE-FLIP**. Historical `{'scaleAwareStructure': 0.5998666758116005, 'intensityNcc': 0.2646043092840628}` -> repeat `{'scaleAwareStructure': 0.5086483271335666, 'intensityNcc': 0.387429144605377}`. Limiting components historical `['intensityNcc']`, repeat `['scaleAwareStructure', 'intensityNcc']`.

## 16. Primitive signal overlap summary

- scaleAwareStructure: correct `{'min': 0.5028816161470961, 'median': 0.5355426641098889, 'max': 0.6091509755786805}`; strongest wrong `{'min': 0.5624560514802611, 'median': 0.6181885119038288, 'max': 0.6743643341697816}`; directions `{'correctHigher': 1, 'wrongHigher': 6, 'tie': 0}`. Per-control signs remain in JSON.

- intensityNcc: correct `{'min': 0.03387252114448036, 'median': 0.2794791968757558, 'max': 0.5191574689328196}`; strongest wrong `{'min': 0.5805479976509077, 'median': 0.669913660458947, 'max': 0.7960995691321078}`; directions `{'correctHigher': 0, 'wrongHigher': 7, 'tie': 0}`. Per-control signs remain in JSON.

## 17. S0–S5 results

- S0: owner rank-1 correct `0/6`; Fang correct rank `5`; wrong top `7/7`; wrong top static-gate-eligible `6/7`; known accepted wrong top `5/7`.

- S1: owner rank-1 correct `0/6`; Fang correct rank `5`; wrong top `7/7`; wrong top static-gate-eligible `6/7`; known accepted wrong top `5/7`.

- S2: owner rank-1 correct `1/6`; Fang correct rank `3`; wrong top `6/7`; wrong top static-gate-eligible `5/7`; known accepted wrong top `4/7`.

- S3: owner rank-1 correct `0/6`; Fang correct rank `6`; wrong top `7/7`; wrong top static-gate-eligible `5/7`; known accepted wrong top `4/7`.

- S4: owner rank-1 correct `0/6`; Fang correct rank `9`; wrong top `7/7`; wrong top static-gate-eligible `5/7`; known accepted wrong top `4/7`.

- S5: owner rank-1 correct `0/6`; Fang correct rank `3`; wrong top `6/7`; wrong top static-gate-eligible `6/7`; known accepted wrong top `5/7`.

## 18. Independent validation + false-basin safety
Fang dominated: `True`. Gates/beam unchanged. Alternative-rule ambiguity is marked NOT_COMPARABLE where beam margins are unavailable; no acceptance is fabricated.

## 19. SS0/SS1/SS2/SS3 verdict + architecture implication
**SS0 — PRIMITIVE SIGNALS NON-SEPARABLE**. Dominated independent `['east-cross', 'path-of-void', 'buddha-fort', 'prosperity-haven', 'dreamfall-cliff', 'fang-xu']` (6/7), owner unique `['east-cross', 'path-of-void', 'buddha-fort', 'prosperity-haven', 'dreamfall-cliff']`. NEW REPRESENTATION / DESCRIPTOR ARCHITECTURE JUSTIFIED; do not spend another round reweighting current metrics.

## 20. Authoritative CI coordinates + production-change verdict
Run `31889065856`; job `95022507549`; artifact `9248045962`; digest `0c5cc8a788274b33892b8bfdced58b552f99f6716e54acec5c45487a5bf2e1a2`. Production change: **NO**; 0.58 / 0.42 / beam 8 unchanged.
