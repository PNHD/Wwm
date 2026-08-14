# COMMON HUD → REFERENCE representation bridge audit

- Verified starting HEAD: `22f0dbc131756bffd7082a0b2358624d158463f8`
- CI implementation/source commit: `1d59cdb4665145ef203ba95ccecba7eaec5199dc`
- Production structural gate: `0.58` — unchanged.
- Production matcher/cache/preprocessing modified: **NO**.

## Exact reused provenance / artifacts

- `ownerRawBaseline`: run `31666927302`, artifact `9168284675`, digest `5ab08d0bf1745556b0b10d3f72cb70779fa65367afff6f057014f050a1d634d8`.
- `sameSessionDifferential`: run `31759922863`, artifact `9204236942`, digest `ddafa809bee15cbe7da2c0f7e8d3354ca9a4e834022e6fb7d13cb643d4762793`.
- `generalShrineR1`: run `31761799973`, artifact `9204882854`, digest `6233d52dbd710380a5650793817130536544e6dffeb9c5a32a6ef8e807d80026`.
- `referenceSite`: run `31561669741`, artifact `9127953239`, digest `1542e60310197707f892e7ee9ebbbdb65c3f58926fcedb4ec80454d4b9eaf8d3`.
- `fangXuBaseline`: run `31609680755`, artifact `9146646914`, digest `b305444dff3ac2db6a544020093bd64022ffef5406c246849499d6a96525c041`.
- `raw40FrameProduction`: run `31579421905`, artifact `9134573961`, digest `a4ad4a4fc9caee79732099c1e643f14dbbbae3c80c22a8fcb7b1fe309874760c`.
- Exact 40-frame fixture: `wwmsync-gfn-motion-20260810-143835.zip`; SHA-256 `aa14ce0e703d0af5c4c86946f2932b465f8a7fd529001cd1900b3b99b501a216`; release asset `511291145`.

## Raw baselines (authoritative, never replaced)

- **East Cross Street** expected-neighborhood local: raw structure `0.649710413212377`, scale-aware `0.5302244208593313`, intensity `0.46632830706748185`, NCC `0.38627755312760403`, combined `0.5251127317559834`, edge `0.5827915316309142`, gate `False`; wrong-max scale `0.562456`, wrong-max combined `0.567189`, scale discrimination `-0.032232`, combined discrimination `-0.042076.
- **General's Shrine** expected-neighborhood local: raw structure `0.59420193489881`, scale-aware `0.599593833478546`, intensity `0.3885035592740659`, NCC `0.2967790931651757`, combined `0.5827066115421876`, edge `0.6570476978329083`, gate `False`; wrong-max scale `0.588791`, wrong-max combined `0.582354`, scale discrimination `0.010803`, combined discrimination `0.000352.
- Raw replay reproduction: **PASS**; tolerances `{"localMetricAbs": 0.005}`.

## Pre-registered bridge family

- `gaussian-s08` — fixed Gaussian low-pass — params `{"sigma": 0.8}`
- `icon-inpaint-v1` — deterministic known-HUD overlay component inpaint — params `{"componentAreaMaxFraction": 0.02, "componentAreaMin": 2, "dilateKernel": 3, "inpaintRadius": 3, "saturationMin": 95, "validCircleCenterFraction": [0.35, 0.34], "validCircleRadiusFraction": 0.335, "valueMin": 90, "whiteSaturationMax": 45, "whiteValueMin": 242}`
- `radial-neutral-r095` — shared radial valid-terrain feather mask to neutral median — params `{"baseRadiusFraction": 0.335, "centerFraction": [0.35, 0.34], "featherFraction": 0.04, "radiusFactor": 0.95}`
- `radial-neutral-r100` — shared radial valid-terrain feather mask to neutral median — params `{"baseRadiusFraction": 0.335, "centerFraction": [0.35, 0.34], "featherFraction": 0.04, "radiusFactor": 1.0}`
- `radial-neutral-r105` — shared radial valid-terrain feather mask to neutral median — params `{"baseRadiusFraction": 0.335, "centerFraction": [0.35, 0.34], "featherFraction": 0.04, "radiusFactor": 1.05}`
- `clahe-luma-c15` — fixed LAB-luminance CLAHE — params `{"clipLimit": 1.5, "tileGrid": [8, 8]}`
- Family SHA-256: `a13be407c3fa059780bb554de15d737d18ed515b6935f81fc5e2bfb92c0db3bd`

## Calibration

- Verdict: **B0 — NO COMMON REPRESENTATION BRIDGE**
- Selected candidate: `none`
- `gaussian-s08` East: scale `0.534969`, intensity `0.470341`, NCC `0.390892`, combined `0.529799`, edge `0.584780`, Δcorrect scale/combined `0.004745/0.004686`, Δdisc `0.000877/0.000502`, new known-wrong accepts `0`, eligible `False`.
- `gaussian-s08` General: scale `0.604973`, intensity `0.388276`, NCC `0.296518`, combined `0.587637`, edge `0.661735`, Δcorrect scale/combined `0.005379/0.004930`, Δdisc `0.002556/0.002284`, new known-wrong accepts `0`, eligible `False`; common `False`.
- `icon-inpaint-v1` East: scale `0.536794`, intensity `0.465834`, NCC `0.385709`, combined `0.531117`, edge `0.584808`, Δcorrect scale/combined `0.006570/0.006005`, Δdisc `0.013134/0.014135`, new known-wrong accepts `0`, eligible `False`.
- `icon-inpaint-v1` General: scale `0.600159`, intensity `0.388572`, NCC `0.296857`, combined `0.583232`, edge `0.657587`, Δcorrect scale/combined `0.000566/0.000526`, Δdisc `-0.001034/-0.000973`, new known-wrong accepts `0`, eligible `False`; common `False`.
- `radial-neutral-r095` East: scale `0.538103`, intensity `0.266637`, NCC `0.156633`, combined `0.516385`, edge `0.564903`, Δcorrect scale/combined `0.007878/-0.008727`, Δdisc `0.030991/0.035867`, new known-wrong accepts `0`, eligible `False`.
- `radial-neutral-r095` General: scale `0.596480`, intensity `0.374891`, NCC `0.281125`, combined `0.578753`, edge `0.628421`, Δcorrect scale/combined `-0.003113/-0.003953`, Δdisc `0.037638/0.063700`, new known-wrong accepts `0`, eligible `True`; common `False`.
- `radial-neutral-r100` East: scale `0.539735`, intensity `0.282074`, NCC `0.174385`, combined `0.519122`, edge `0.565785`, Δcorrect scale/combined `0.009510/-0.005991`, Δdisc `0.032331/0.031881`, new known-wrong accepts `0`, eligible `False`.
- `radial-neutral-r100` General: scale `0.609466`, intensity `0.411964`, NCC `0.323758`, combined `0.593666`, edge `0.646667`, Δcorrect scale/combined `0.009872/0.010959`, Δdisc `0.025536/0.042656`, new known-wrong accepts `0`, eligible `True`; common `False`.
- `radial-neutral-r105` East: scale `0.534800`, intensity `0.295832`, NCC `0.190207`, combined `0.515683`, edge `0.563774`, Δcorrect scale/combined `0.004576/-0.009430`, Δdisc `0.019598/0.020517`, new known-wrong accepts `0`, eligible `False`.
- `radial-neutral-r105` General: scale `0.606720`, intensity `0.411200`, NCC `0.322880`, combined `0.591078`, edge `0.645592`, Δcorrect scale/combined `0.007126/0.008372`, Δdisc `0.007154/0.010673`, new known-wrong accepts `1`, eligible `False`; common `False`.
- `clahe-luma-c15` East: scale `0.513539`, intensity `0.423428`, NCC `0.336943`, combined `0.506330`, edge `0.569068`, Δcorrect scale/combined `-0.016686/-0.018783`, Δdisc `-0.017297/-0.013059`, new known-wrong accepts `0`, eligible `False`.
- `clahe-luma-c15` General: scale `0.594709`, intensity `0.423503`, NCC `0.337029`, combined `0.581012`, edge `0.661355`, Δcorrect scale/combined `-0.004885/-0.001694`, Δdisc `-0.013940/-0.008260`, new known-wrong accepts `0`, eligible `False`; common `False`.

## Final decision

- **CASE B0**
- NO COMMON BRIDGE.
- H1: materially strengthened by prior registration correction, but no single bounded deterministic common HUD representation bridge was established.
- H2: weakened, not eliminated.
- Production-candidate task justified: **NO**.
- No production implementation is included in this round.

## Authoritative CI
- run: 31764340615
- job: 94657000684
- artifact: 9205755503
- artifact digest: cb0b0f2a3eac0ee8b8993c1aed8bf17799e52433f58f145146688deb1667f7c4
- acceptance: CI ACCEPTED — bounded replay/CI-only common representation bridge audit; production untouched.
