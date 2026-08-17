# WWMSync Learned / Domain-Invariant Known-GT Representation Audit V1 — Outcome

**Status:** COMPLETE / CI ACCEPTED

**Final verdict:** **LR2 — PARTIAL LEARNED RESCUE**

**Production change:** **NO**

## Authority

- Starting live HEAD: `d8eed21f8913473ab89d2730bf75968e960573af`
- Learned prereg commit: `2180828353d8ffed06acf60e35e01da77701f5fc`
- Learned prereg blob: `27c9b30a4f84e3de3433678835ea7343176e99ad`
- Authoritative learned outcome HEAD: `40c7a3163341dcf7693c2ecd456c85b3a3191618`
- Authoritative outcome run: `32002871831`
- Aggregate job: `95307081395`
- Outcome artifact: `9279064565`
- Outcome artifact digest: `sha256:c9189c23a875da2dd6428402b76c2c894d528d0b3a584f1d878a168cc4e18445`

V2-RD2 authority remains accepted at report blob `79287c1657327f03c0861fa0e629e3720edb8e9b`. VF0 remains commit `72a91762dba0efb8106b7afb45124721ff1a7a01`, blob `51adf1da2cfc201f8f67cd575e271a2461640eeb`, SHA-256 `6ed0243974efad4c4437f4a6b758670a3e8d2070afca893e9a7a15be7b90d8f3`.

## Frozen model and runtime

- Upstream: `facebookresearch/dinov2` at `7764ea0f912e53c92e82eb78a2a1631e92725fc8`
- Model: `dinov2_vits14_reg` — DINOv2 ViT-S/14 with 4 register tokens
- Official weight bytes: `88,291,785`
- Weight SHA-256: `f433177089a681826f849f194ece3bb48f4d63fb38d32fc837e3dc7a4e5641fb`
- Runtime: Ubuntu 24.04, Python 3.12.13, PyTorch 2.7.1+cpu, torchvision 0.22.1+cpu, Pillow 12.3.0, NumPy 2.5.2, CPU-only; deterministic algorithms enabled; 2 intra-op / 1 inter-op thread.
- Model `eval()`, `inference_mode()`, gradients disabled. No fine-tuning, adapter, LoRA, PCA, VLAD, projector, threshold fitting, D2 fusion, or alternate foundation model.

## Preprocessing and conformance

- Exact canonical `192×192 RGB8` work canvas → one `196×196` bicubic resize with antialias → float32 RGB `[0,1]` → ImageNet mean `(0.485, 0.456, 0.406)` / std `(0.229, 0.224, 0.225)`.
- Final backbone output only: CLS extracted for conformance; 4 register tokens excluded from similarity; exactly `196` patch tokens on a `14×14` grid, embedding dimension `384`.
- Synthetic repeat embeddings are bitwise identical; same-image identity is approximately 1 for L1/L2/L3; outputs are finite; input transform hashes are stable.

Pre-normalization 196×196 RGB SHA-256 per GT/query control:

- East Cross: `ec20e0557b5f3ad652a1ae9c8b65d20b0db3a0e564688940839a99f18c24372a`
- General Shrine historical: `5c56d2941f2657023740dd8a7d215c8534acaff8e08f9702d02e07acfbc10261`
- Path of Void: `52ee38811046a4b010126f2d4df24d295cd09f27e488181530dfe0644d97e5ec`
- Buddha Fort: `4612656b60c36c2e449c7332323a3762db28d91b1c81ba1820d616734fcbc924`
- Prosperity Haven: `b0de74edd885f782b4bc3607aae75286e9cd1d0def8a095213840a25967a5303`
- Dreamfall Cliff: `42a67a14bd18df2c2631df10f7241a811eedef0a540bb555fcb9c0819a658a8b`
- General Shrine repeat: `41cd3d28f4510edc397ae35f05a5df0064f038b8c55de387e06ca7a74db87cc3`
- Fang Xu: `7fb9c3217ce9b228d74b21dc0d905be8ca6c4f434178d4c5dcb94645f428aa2c`

## L1 — GLOBAL_PATCH_MEAN_COSINE

| Control | Locked GT | Locked strongest wrong | Locked margin / rank | Best-81 GT | Best-81 strongest wrong | 81 margin / rank |
|---|---:|---:|---:|---:|---:|---:|
| East Cross | 0.400666 | 0.454231 | -0.053565 / 2 | 0.480153 | 0.454231 | +0.025922 / 1 |
| General Shrine historical | 0.463938 | 0.578398 | -0.114459 / 8 | 0.538989 | 0.635742 | -0.096753 / 7 |
| Path of Void | 0.281343 | 0.448046 | -0.166703 / 9 | 0.309806 | 0.488684 | -0.178878 / 9 |
| Buddha Fort | 0.198459 | 0.278250 | -0.079791 / 9 | 0.219470 | 0.339589 | -0.120119 / 9 |
| Prosperity Haven | 0.182862 | 0.379582 | -0.196720 / 9 | 0.263881 | 0.451272 | -0.187390 / 9 |
| Dreamfall Cliff | 0.254323 | 0.437952 | -0.183629 / 9 | 0.291910 | 0.489193 | -0.197282 / 9 |
| General Shrine repeat | 0.207688 | 0.370557 | -0.162869 / 8 | 0.226999 | 0.421687 | -0.194688 / 9 |
| Fang Xu | 0.457322 | 0.517597 | -0.060275 / 4 | 0.519442 | 0.551181 | -0.031740 / 3 |

## L2 — ALIGNED_PATCH_COSINE

| Control | Locked GT | Locked strongest wrong | Locked margin / rank | Best-81 GT | Best-81 strongest wrong | 81 margin / rank |
|---|---:|---:|---:|---:|---:|---:|
| East Cross | 0.264026 | 0.309628 | -0.045603 / 2 | 0.301586 | 0.309628 | -0.008042 / 2 |
| General Shrine historical | 0.312057 | 0.376576 | -0.064519 / 7 | 0.352082 | 0.407689 | -0.055607 / 7 |
| Path of Void | 0.220203 | 0.340417 | -0.120214 / 9 | 0.242432 | 0.365985 | -0.123552 / 9 |
| Buddha Fort | 0.152666 | 0.250620 | -0.097954 / 9 | 0.158443 | 0.276733 | -0.118290 / 9 |
| Prosperity Haven | 0.162609 | 0.309596 | -0.146987 / 9 | 0.203344 | 0.329563 | -0.126219 / 9 |
| Dreamfall Cliff | 0.198802 | 0.346299 | -0.147497 / 9 | 0.217362 | 0.370821 | -0.153460 / 9 |
| General Shrine repeat | 0.148016 | 0.313536 | -0.165520 / 9 | 0.165518 | 0.341856 | -0.176339 / 9 |
| Fang Xu | 0.292697 | 0.325246 | -0.032548 / 3 | 0.324196 | 0.350385 | -0.026189 / 3 |

## L3 — BIDIRECTIONAL_PATCH_CHAMFER_COSINE

| Control | Locked GT | Locked strongest wrong | Locked margin / rank | Best-81 GT | Best-81 strongest wrong | 81 margin / rank |
|---|---:|---:|---:|---:|---:|---:|
| East Cross | 0.372733 | 0.415093 | -0.042360 / 2 | 0.415968 | 0.418598 | -0.002631 / 2 |
| General Shrine historical | 0.444797 | 0.499451 | -0.054654 / 7 | 0.494853 | 0.534469 | -0.039616 / 4 |
| Path of Void | 0.342631 | 0.468584 | -0.125953 / 9 | 0.380127 | 0.487808 | -0.107681 / 9 |
| Buddha Fort | 0.297736 | 0.349355 | -0.051619 / 8 | 0.309313 | 0.370797 | -0.061485 / 9 |
| Prosperity Haven | 0.341562 | 0.404562 | -0.063000 / 7 | 0.384207 | 0.444020 | -0.059813 / 8 |
| Dreamfall Cliff | 0.406571 | 0.464607 | -0.058036 / 5 | 0.435989 | 0.498768 | -0.062779 / 6 |
| General Shrine repeat | 0.331152 | 0.434560 | -0.103408 / 8 | 0.340872 | 0.461679 | -0.120807 / 8 |
| Fang Xu | 0.446397 | 0.478872 | -0.032475 / 4 | 0.484999 | 0.498783 | -0.013784 / 3 |

Full GT + eight-WRONG score rows, strongest-WRONG IDs, ties, selected GT/wrong poses, ordering changes, hashes, and runtime are preserved in the accepted machine evidence; all 81-pose raw score evidence remains in the authoritative artifact.

## Owner cross-control summary

| Head | Locked owner +/6 | 81 owner +/6 | Locked median | Locked worst | 81 median | 81 worst | Qinghe / Kaifeng positive coverage |
|---|---:|---:|---:|---:|---:|---:|
| L1 | 0/6 | 1/6 | -0.140581 | -0.196720 | -0.149499 | -0.197282 | locked 0/0; 81 1/0 |
| L2 | 0/6 | 0/6 | -0.109084 | -0.147497 | -0.120921 | -0.153460 | locked 0/0; 81 0/0 |
| L3 | 0/6 | 0/6 | -0.056345 | -0.125953 | -0.060649 | -0.107681 | locked 0/0; 81 0/0 |

Only one owner-stage result is positive: **East Cross / L1 / symmetric 81-pose**, margin `+0.025922`, GT rank `1`. East Cross L1 remains negative candidate-locked (`-0.053565`, rank `2`). No Kaifeng control is positive under any head/stage.

## General historical/repeat drift

| Head | Locked historical | Locked repeat | Locked class | 81 historical | 81 repeat | 81 class |
|---|---:|---:|---|---:|---:|---|
| L1 | -0.114459 | -0.162869 | DR-WRONG-STABLE | -0.096753 | -0.194688 | DR-WRONG-STABLE |
| L2 | -0.064519 | -0.165520 | DR-WRONG-STABLE | -0.055607 | -0.176339 | DR-WRONG-STABLE |
| L3 | -0.054654 | -0.103408 | DR-WRONG-STABLE | -0.039616 | -0.120807 | DR-WRONG-STABLE |

All learned heads are `DR-WRONG-STABLE` in both locked and 81-pose evaluation.

## Fang independent validation

| Head | Locked margin / rank | 81 margin / rank | Independent validation |
|---|---:|---:|---|
| L1 | -0.060275 / 4 | -0.031740 / 3 | FAIL |
| L2 | -0.032548 / 3 | -0.026189 / 3 | FAIL |
| L3 | -0.032475 / 4 | -0.013784 / 3 | FAIL |

Fang is negative for all three heads under both evaluation modes; independent learned success is absent.

## Survivor rule

| Clause | L1 | L2 | L3 |
|---|---|---|---|
| `ownerLockedAtLeast4of6` | False | False | False |
| `ownerPose81AtLeast4of6` | False | False | False |
| `lockedIncludesQingheAndKaifeng` | False | False | False |
| `pose81IncludesQingheAndKaifeng` | False | False | False |
| `fangLockedPreferred` | False | False | False |
| `fangPose81Preferred` | False | False | False |
| `generalLockedDriftSafe` | False | False | False |
| `generalPose81DriftSafe` | False | False | False |
| `vf0Frozen` | True | True | True |

`productionGatesOrBeamChanged = false` for all heads. **Local survivors: none.**

## Conditional retrieval

`SKIPPED_NO_LOCAL_SURVIVORS` — no learned head was eligible for the frozen 424-center Dashen z5 retrieval phase. This is the preregistered valid negative path, not a CI failure.

## Conditional 40-frame stress

`SKIPPED_NO_RETRIEVAL_SAFE_SURVIVORS` — retrieval did not run, so no head could become retrieval-safe. Fixture SHA-256 remains `aa14ce0e703d0af5c4c86946f2932b465f8a7fd529001cd1900b3b99b501a216`. No localization truth claim is made.

## Final verdict

**LR2 — PARTIAL LEARNED RESCUE**

The learned family materially rescues one narrow case (East Cross L1 after symmetric pose search), but no frozen head satisfies the common owner + region + Fang + drift survivor protocol. Domain mismatch remains heterogeneous.

### Architecture implication

A generic frozen visual foundation representation is not sufficient as a common WWMSync HUD/reference representation. A later, separately preregistered fusion/domain-adaptation study is justified; this audit does **not** justify production matcher/model integration.

### Production decision

- Production task justified: **NO**
- Production change: **NO**
- Structural gate: `0.58`
- Intensity gate: `0.42`
- Coarse beam: `8`
- `vision-sync.js`: `58b5a1babf6a12b944f9b745b8bf7f7df573bf9b`
- `dashen-tile-cache.js`: `9388960a8bff53a9cfc7471372af144b7a28c34f`
- `tools/build_dashen_visual_cache.py`: `1a227d06ae41660ea3e3b832e7f1921cc507c0d7`
- `production/wwsync`: untouched
