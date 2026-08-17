# WWMSync Final Complementary Fusion Audit V1 — Outcome

**Status:** COMPLETE / CI ACCEPTED

**Final verdict:** **FA2 — PARTIAL FUSION RESCUE**

**WWMSync representation research:** **CLOSED**

**Production change:** **NO**

## Authority

- Starting live HEAD: `4ca8b596f09535893c22933893cea539dfdc254f`
- Prereg commit: `853682dff56cc6a7fa7ebcf442cafa8c40ff39e2`
- Prereg blob: `bde910bc2d17cd11b7732cfa8ad19288fab99a76`
- Outcome HEAD: `6fc491835d9c8b99681cba7669d5b40989ba384d`
- Authoritative outcome run: `32004733869`
- Aggregate job: `95312585361`
- Outcome artifact: `9279687922`
- Outcome artifact digest: `sha256:803ab7a86ce5ddfea27201f2d09f471e77e5b594aed521cf782a3bbe5429d477`

- Descriptor V2 authority: **V2-RD2 — PARTIAL REPRESENTATION RESCUE**.
- Learned V1 authority: **LR2 — PARTIAL LEARNED RESCUE**.
- VF0 population unchanged: 8 GT, 64 TOP-8, 64 WRONG, 0 NEAR_GT.

## Reproduction and conformance

- D2 accepted-score reproduction max absolute error: `0`.
- L1 accepted-score reproduction max absolute error: `1.10268592834e-06`.
- L3 accepted-score reproduction max absolute error: `8.64267349243e-07`.
- Same-pose tuples checked: `5,832`; mismatches: `0`.
- F1/F2/F3 arithmetic checks: `5,832`; maximum absolute formula error: `0`.
- Repeated D2 locked GT candidate/pose was deterministic in every control.

## Candidate-locked and symmetric 81-pose results

### F1

| Control | Locked GT | Locked wrong | Margin / rank | 81 GT | 81 wrong | Margin / rank |
|---|---:|---:|---:|---:|---:|---:|
| East Cross | 0.443930 | 0.478431 | -0.034501 / 3 | 0.494745 | 0.478431 | +0.016313 / 1 |
| General historical | 0.538426 | 0.580101 | -0.041674 / 4 | 0.576641 | 0.614133 | -0.037493 / 3 |
| Path | 0.414633 | 0.524974 | -0.110340 / 9 | 0.437160 | 0.550459 | -0.113299 / 9 |
| Buddha | 0.375094 | 0.431711 | -0.056617 / 9 | 0.386079 | 0.473912 | -0.087833 / 9 |
| Prosperity | 0.353333 | 0.479285 | -0.125952 / 9 | 0.392557 | 0.504777 | -0.112220 / 9 |
| Dreamfall | 0.361681 | 0.523386 | -0.161706 / 9 | 0.399243 | 0.551680 | -0.152437 / 9 |
| General repeat | 0.372947 | 0.476027 | -0.103080 / 9 | 0.410418 | 0.509888 | -0.099470 / 9 |
| Fang | 0.564171 | 0.558076 | +0.006096 / 1 | 0.610068 | 0.566930 | +0.043138 / 1 |

### F2

| Control | Locked GT | Locked wrong | Margin / rank | 81 GT | 81 wrong | Margin / rank |
|---|---:|---:|---:|---:|---:|---:|
| East Cross | 0.429963 | 0.466145 | -0.036182 / 4 | 0.464576 | 0.466145 | -0.001570 / 2 |
| General historical | 0.528856 | 0.543029 | -0.014173 / 2 | 0.554573 | 0.564184 | -0.009611 / 2 |
| Path | 0.445277 | 0.531327 | -0.086050 / 9 | 0.466506 | 0.548735 | -0.082228 / 9 |
| Buddha | 0.424732 | 0.462478 | -0.037745 / 8 | 0.441012 | 0.489800 | -0.048788 / 9 |
| Prosperity | 0.432682 | 0.509943 | -0.077261 / 9 | 0.463635 | 0.511296 | -0.047661 / 9 |
| Dreamfall | 0.437805 | 0.540341 | -0.102536 / 9 | 0.469107 | 0.562334 | -0.093227 / 9 |
| General repeat | 0.434680 | 0.496748 | -0.062069 / 9 | 0.457181 | 0.526579 | -0.069398 / 9 |
| Fang | 0.558709 | 0.538713 | +0.019996 / 1 | 0.587457 | 0.544594 | +0.042863 / 1 |

### F3

| Control | Locked GT | Locked wrong | Margin / rank | 81 GT | 81 wrong | Margin / rank |
|---|---:|---:|---:|---:|---:|---:|
| East Cross | 0.420198 | 0.457318 | -0.037121 / 3 | 0.468109 | 0.457318 | +0.010791 / 1 |
| General historical | 0.507216 | 0.544887 | -0.037671 / 4 | 0.549378 | 0.585430 | -0.036052 / 4 |
| Path | 0.390633 | 0.492874 | -0.102242 / 9 | 0.414273 | 0.521721 | -0.107448 / 9 |
| Buddha | 0.349308 | 0.395900 | -0.046592 / 9 | 0.355004 | 0.431230 | -0.076225 / 9 |
| Prosperity | 0.349409 | 0.452873 | -0.103464 / 9 | 0.384346 | 0.479687 | -0.095341 / 9 |
| Dreamfall | 0.376644 | 0.503793 | -0.127149 / 9 | 0.406147 | 0.531849 | -0.125703 / 9 |
| General repeat | 0.359016 | 0.451776 | -0.092761 / 9 | 0.380449 | 0.479323 | -0.098874 / 9 |
| Fang | 0.524913 | 0.531674 | -0.006761 / 2 | 0.564785 | 0.544214 | +0.020571 / 1 |

## Owner cross-control summary

| Head | Locked +/6 | 81 +/6 | Locked median | Locked worst | 81 median | 81 worst | Qinghe / Kaifeng |
|---|---:|---:|---:|---:|---:|---:|---|
| F1 | 0/6 | 1/6 | -0.083479 | -0.161706 | -0.100027 | -0.152437 | locked 0/0; 81 1/0 |
| F2 | 0/6 | 0/6 | -0.057503 | -0.102536 | -0.048225 | -0.093227 | locked 0/0; 81 0/0 |
| F3 | 0/6 | 1/6 | -0.074417 | -0.127149 | -0.085783 | -0.125703 | locked 0/0; 81 1/0 |

No fusion head has any locked owner success. F1 and F3 rescue only East Cross after symmetric pose search; F2 has no owner success in either mode. No Kaifeng control is positive under any head/stage.

## General historical/repeat drift

| Head | Locked historical | Locked repeat | Locked class | 81 historical | 81 repeat | 81 class |
|---|---:|---:|---|---:|---:|---|
| F1 | -0.041674 | -0.103080 | DR-WRONG-STABLE | -0.037493 | -0.099470 | DR-WRONG-STABLE |
| F2 | -0.014173 | -0.062069 | DR-WRONG-STABLE | -0.009611 | -0.069398 | DR-WRONG-STABLE |
| F3 | -0.037671 | -0.092761 | DR-WRONG-STABLE | -0.036052 | -0.098874 | DR-WRONG-STABLE |

All three fusion heads are `DR-WRONG-STABLE` in both modes.

## Fang independent validation

| Head | Locked margin / rank | 81 margin / rank |
|---|---:|---:|
| F1 | +0.006096 / 1 | +0.043138 / 1 |
| F2 | +0.019996 / 1 | +0.042863 / 1 |
| F3 | -0.006761 / 2 | +0.020571 / 1 |

F1 and F2 prefer Fang GT in both modes. F3 flips from locked negative to 81 positive. This is material complementary evidence but does not satisfy the owner/drift survivor protocol.

## Survivor rule

| Clause | F1 | F2 | F3 |
|---|---|---|---|
| `ownerLockedAtLeast4of6` | FAIL | FAIL | FAIL |
| `ownerPose81AtLeast4of6` | FAIL | FAIL | FAIL |
| `lockedIncludesQingheAndKaifeng` | FAIL | FAIL | FAIL |
| `pose81IncludesQingheAndKaifeng` | FAIL | FAIL | FAIL |
| `fangLockedPreferred` | PASS | PASS | FAIL |
| `fangPose81Preferred` | PASS | PASS | PASS |
| `generalLockedDriftSafe` | FAIL | FAIL | FAIL |
| `generalPose81DriftSafe` | FAIL | FAIL | FAIL |
| `candidatePopulationUnchanged` | PASS | PASS | PASS |
| `noProductionGateOrBeamChange` | PASS | PASS | PASS |

**Local survivors: none.**

## Conditional retrieval

`SKIPPED_NO_LOCAL_SURVIVORS` — the frozen survivor rule forbids retrieval for F1/F2/F3.

## Conditional 40-frame stress

`SKIPPED_NO_RETRIEVAL_SAFE_SURVIVORS` — no head reached retrieval safety eligibility. No absolute localization truth claim is made.

## Final verdict

**FA2 — PARTIAL FUSION RESCUE**

Fusion contains material complementary evidence (especially Fang F1/F2 and East 81 F1/F3) but does not generalize across owner controls, Kaifeng, or General historical/repeat drift. No complete survivor exists.

Per the preregistered verdict precedence and hard-stop policy, this closes WWMSync representation research.

## Project closure

- Phase 0: **COMPLETE**
- Descriptor V2: **V2-RD2**
- Learned V1: **LR2**
- Final fusion: **FA2**
- Production candidate: **NONE**
- Production-feasibility architecture task justified: **NO**
- Production change: **NO**
- Further representation research under this project: **STOP**
- Next research task justified: **NO**

Production guards remain structural `0.58`, intensity `0.42`, coarse beam `8`; protected production blobs and `production/wwsync` are unchanged.
