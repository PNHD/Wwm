# WWMSync Descriptor Audit V2 — Accepted Outcome

Authoritative outcome: run `31989337212`, aggregate job `95270023809`, artifact `9274795303`, digest `sha256:549c5a1e7302dd78adb0c2ef0862d31c9a366ce9aaf39ac81e8812ae135a94b7`.

Verdict: **V2-RD2 — PARTIAL REPRESENTATION RESCUE**

Partial representation rescue exists, but no descriptor passes the complete common local survivor protocol.

Production change: **NO**. Retrieval and 40-frame stress were not executed because no descriptor passed the local survivor rule.

## Provenance

- Starting live HEAD: `ddabe5f40670eae7286e98d17eebf6ceca17adb0`
- Outcome HEAD: `49b90c2213b799759ae6e3b4297e58b37898b97b`
- VF0 run/job/artifact: `31986849103` / `95263230345` / `9274031553`
- VF0 digest: `sha256:64749cb832b8e8751d6115929b6ebd0c68f026f80811cbbd1aeefe8545ff75e7`
- V2 prereg blob: `554bf3318b9b75690589fd3c9275bb20b92e82e5`
- Candidate-freeze blob: `51adf1da2cfc201f8f67cd575e271a2461640eeb`
- Candidate-freeze SHA-256: `6ed0243974efad4c4437f4a6b758670a3e8d2070afca893e9a7a15be7b90d8f3`

## Implementation conformance

All 8 control jobs passed the same deterministic synthetic conformance suite: support pixels `2856`, D1/D2/D3/D4 identity score `1.0`, D2 zero-weight null semantics, REFLECT_101 boundary probes `[1,78]`, percentile floor-rule probe `p90=3`, and Zhang-Suen convergence within the 128-iteration cap.

## Candidate-locked and symmetric 81-pose results

### D1

| Control | Locked GT | Locked strongest wrong | Margin | Rank | 81 GT | 81 strongest wrong | Margin | Rank |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| East Cross | 0.533670 | 0.557422 | -0.023752 | 7 | 0.540603 | 0.564800 | -0.024197 | 9 |
| General historical | 0.513553 | 0.581793 | -0.068240 | 9 | 0.525760 | 0.584733 | -0.058974 | 9 |
| Path of Void | 0.524913 | 0.570464 | -0.045551 | 7 | 0.527919 | 0.570464 | -0.042546 | 9 |
| Buddha Fort | 0.522667 | 0.543099 | -0.020432 | 8 | 0.522667 | 0.547754 | -0.025087 | 9 |
| Prosperity Haven | 0.515647 | 0.541048 | -0.025401 | 8 | 0.525575 | 0.548872 | -0.023296 | 8 |
| Dreamfall Cliff | 0.505740 | 0.536382 | -0.030642 | 9 | 0.516189 | 0.542611 | -0.026421 | 8 |
| General repeat | 0.519325 | 0.528885 | -0.009559 | 4 | 0.525011 | 0.533388 | -0.008377 | 5 |
| Fang Xu | 0.582943 | 0.620009 | -0.037066 | 6 | 0.584570 | 0.635135 | -0.050564 | 8 |

Owner unique: locked **0/6 positive**, 81-pose **0/6 positive**. General drift: **DR-WRONG-STABLE / DR-WRONG-STABLE**. Fang: **False / False**.

### D2

| Control | Locked GT | Locked strongest wrong | Margin | Rank | 81 GT | 81 strongest wrong | Margin | Rank |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| East Cross | 0.487194 | 0.563943 | -0.076749 | 9 | 0.533378 | 0.567345 | -0.033967 | 8 |
| General historical | 0.612915 | 0.611597 | 0.001318 | 1 | 0.621238 | 0.628646 | -0.007408 | 2 |
| Path of Void | 0.547924 | 0.633979 | -0.086055 | 6 | 0.564514 | 0.664352 | -0.099838 | 9 |
| Buddha Fort | 0.551728 | 0.614219 | -0.062491 | 5 | 0.595122 | 0.638659 | -0.043537 | 3 |
| Prosperity Haven | 0.523803 | 0.636367 | -0.112564 | 8 | 0.568912 | 0.653552 | -0.084640 | 7 |
| Dreamfall Cliff | 0.469038 | 0.636642 | -0.167604 | 9 | 0.534956 | 0.648064 | -0.113108 | 9 |
| General repeat | 0.538207 | 0.667834 | -0.129627 | 7 | 0.606722 | 0.693979 | -0.087256 | 7 |
| Fang Xu | 0.671020 | 0.638458 | 0.032562 | 1 | 0.704034 | 0.650718 | 0.053316 | 1 |

Owner unique: locked **1/6 positive**, 81-pose **0/6 positive**. General drift: **DR-FLIP / DR-WRONG-STABLE**. Fang: **True / True**.

### D3

| Control | Locked GT | Locked strongest wrong | Margin | Rank | 81 GT | 81 strongest wrong | Margin | Rank |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| East Cross | 0.562733 | 0.684054 | -0.121321 | 8 | 0.643534 | 0.703540 | -0.060006 | 7 |
| General historical | 0.595883 | 0.652077 | -0.056195 | 6 | 0.630702 | 0.681505 | -0.050803 | 6 |
| Path of Void | 0.566208 | 0.732379 | -0.166171 | 9 | 0.672194 | 0.768982 | -0.096789 | 9 |
| Buddha Fort | 0.701186 | 0.746662 | -0.045476 | 5 | 0.752185 | 0.779451 | -0.027265 | 4 |
| Prosperity Haven | 0.622677 | 0.763818 | -0.141141 | 8 | 0.665598 | 0.796089 | -0.130490 | 8 |
| Dreamfall Cliff | 0.492468 | 0.710819 | -0.218351 | 9 | 0.595348 | 0.750756 | -0.155408 | 9 |
| General repeat | 0.489373 | 0.734574 | -0.245201 | 8 | 0.606271 | 0.787405 | -0.181133 | 8 |
| Fang Xu | 0.576093 | 0.708540 | -0.132447 | 7 | 0.682600 | 0.729080 | -0.046480 | 6 |

Owner unique: locked **0/6 positive**, 81-pose **0/6 positive**. General drift: **DR-WRONG-STABLE / DR-WRONG-STABLE**. Fang: **False / False**.

### D4

| Control | Locked GT | Locked strongest wrong | Margin | Rank | 81 GT | 81 strongest wrong | Margin | Rank |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| East Cross | 0.514082 | 0.614006 | -0.099924 | 8 | 0.566390 | 0.637494 | -0.071104 | 6 |
| General historical | 0.485278 | 0.607456 | -0.122179 | 6 | 0.516709 | 0.628703 | -0.111994 | 7 |
| Path of Void | 0.389315 | 0.510732 | -0.121418 | 9 | 0.496868 | 0.570963 | -0.074095 | 7 |
| Buddha Fort | 0.486726 | 0.532629 | -0.045903 | 3 | 0.588150 | 0.593312 | -0.005162 | 2 |
| Prosperity Haven | 0.536448 | 0.612519 | -0.076071 | 5 | 0.587460 | 0.621111 | -0.033651 | 2 |
| Dreamfall Cliff | 0.314589 | 0.485238 | -0.170648 | 9 | 0.527731 | 0.559993 | -0.032262 | 5 |
| General repeat | 0.230092 | 0.613626 | -0.383533 | 9 | 0.471298 | 0.653511 | -0.182213 | 8 |
| Fang Xu | 0.452979 | 0.615045 | -0.162066 | 8 | 0.582999 | 0.664974 | -0.081975 | 5 |

Owner unique: locked **0/6 positive**, 81-pose **0/6 positive**. General drift: **DR-WRONG-STABLE / DR-WRONG-STABLE**. Fang: **False / False**.

## Survivor decision

| Descriptor | Owner locked ≥4/6 | Owner 81 ≥4/6 | Qinghe+Kaifeng locked | Qinghe+Kaifeng 81 | Fang locked | Fang 81 | General locked safe | General 81 safe | Survivor |
|---|---|---|---|---|---|---|---|---|---|
| D1 | NO | NO | NO | NO | NO | NO | NO | NO | NO |
| D2 | NO | NO | NO | NO | YES | YES | NO | NO | NO |
| D3 | NO | NO | NO | NO | NO | NO | NO | NO | NO |
| D4 | NO | NO | NO | NO | NO | NO | NO | NO | NO |

D2 is the only material partial rescue: Fang is correctly preferred at rank 1 in both modes (`+0.032562` locked, `+0.053316` 81-pose), while owner separability is only `1/6` locked and `0/6` 81-pose, Kaifeng has no positive control, and General changes from a tiny locked positive (`+0.001318`) to repeat wrong preference (`-0.129627`), therefore drift is unsafe.

## Conditional phases

- Retrieval proxy: `SKIPPED_NO_LOCAL_SURVIVORS`
- Exact 40-frame stress: `SKIPPED_NO_RETRIEVAL_SAFE_SURVIVORS`
- Stress fixture remains frozen at `aa14ce0e703d0af5c4c86946f2932b465f8a7fd529001cd1900b3b99b501a216`; it was not opened for scoring because the prerequisite failed.

## V2 research decision

**V2-RD2 — PARTIAL REPRESENTATION RESCUE.** The result is heterogeneous rather than a common safe structural descriptor. A separately preregistered learned/domain-invariant representation audit is justified; an explicitly preregistered fusion study may also be considered later. Handcrafted parameter expansion within D1-D4 is not justified.

Production task justified: **NO**. Production change: **NO**.
