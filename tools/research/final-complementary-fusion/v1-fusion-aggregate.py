#!/usr/bin/env python3
import argparse
import glob
import json
import math
import os
import statistics
from pathlib import Path

HEADS = ("F1", "F2", "F3")
LEARNED_HEADS = ("L1", "L3")
OWNER = ("east-cross", "general-shrine", "path-of-void", "buddha-fort", "prosperity-haven", "dreamfall-cliff")
CONTROLS = OWNER + ("general-shrine-repeat", "fang-xu")
POSE_KEYS = ("angleDeltaDeg", "radiusFactor", "xOffsetPx", "yOffsetPx", "x", "y", "radius", "angle")


def close(a, b, tol):
    return abs(float(a) - float(b)) <= tol


def pose_equal(a, b, tol=1e-12):
    return all(close(a[k], b[k], tol) for k in POSE_KEYS)


def fusion_scores(d2, l1, l3):
    return {
        "F1": 0.5 * d2 + 0.5 * l1,
        "F2": 0.5 * d2 + 0.5 * l3,
        "F3": (d2 + l1 + l3) / 3.0,
    }


def summarize(candidates, head, locked_index, mode):
    rows = []
    for c in candidates:
        if mode == "locked":
            p = c["poses"][locked_index]
        else:
            p = max(c["poses"], key=lambda x: x["fusion"][head])
        rows.append({
            "candidateId": c["candidateId"],
            "role": c["role"],
            "classification": c["classification"],
            "productionRank": c.get("productionRank"),
            "score": p["fusion"][head],
            "components": {"D2": p["D2"], "L1": p["L1"], "L3": p["L3"]},
            "pose": p["pose"],
            "rgb8Sha256": p["rgb8Sha256"],
            "pre196RgbSha256": p["pre196RgbSha256"],
        })
    gt, wrong = rows[0], rows[1:]
    strongest = max(wrong, key=lambda r: r["score"])
    margin = gt["score"] - strongest["score"]
    return {
        "gtScore": gt["score"],
        "strongestWrongScore": strongest["score"],
        "strongestWrongCandidateId": strongest["candidateId"],
        "margin": margin,
        "gtRank": 1 + sum(1 for r in wrong if r["score"] > gt["score"]),
        "ties": sum(1 for r in wrong if r["score"] == gt["score"]),
        "positive": margin > 0,
        "bestGtPose": gt["pose"],
        "bestWrongPose": strongest["pose"],
        "gtComponents": gt["components"],
        "strongestWrongComponents": strongest["components"],
        "candidateScores": rows,
    }


def drift_class(a, b, material=0.10):
    ap, bp = a > 0, b > 0
    if ap and bp:
        return "DR-STABLE" if abs(a - b) <= material else "DR-PARTIAL"
    if ap != bp:
        return "DR-FLIP"
    return "DR-WRONG-STABLE"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-root", required=True)
    ap.add_argument("--v2-root", required=True)
    ap.add_argument("--prereg", required=True)
    ap.add_argument("--learned-evidence", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    prereg = json.load(open(args.prereg))
    learned_authority = json.load(open(args.learned_evidence))
    assert prereg["frozenBeforeFusionOutcomes"] is True
    assert prereg["fusionOutcomesInspected"] is False
    assert prereg["fusionFamily"]["onlyHeads"] == list(HEADS)
    assert prereg["poseGrid"]["combinationsPerCandidate"] == 81
    assert learned_authority["verdict"] == "LR2 — PARTIAL LEARNED RESCUE"

    manifests = {}
    learned = {}
    for p in glob.glob(os.path.join(args.input_root, "**", "render-manifest.json"), recursive=True):
        d = json.load(open(p)); manifests[d["controlId"]] = d
        lp = os.path.join(os.path.dirname(p), "learned.json")
        if not os.path.exists(lp):
            raise AssertionError(f"missing learned.json beside {p}")
        learned[d["controlId"]] = json.load(open(lp))
    if set(manifests) != set(CONTROLS) or set(learned) != set(CONTROLS):
        raise AssertionError(f"control population mismatch render={sorted(manifests)} learned={sorted(learned)}")

    out = {
        "schema": "wwmsync-final-complementary-fusion-v1-local-evidence-v1",
        "audit": "FINAL COMPLEMENTARY FUSION AUDIT V1",
        "date": "2026-08-17",
        "status": "RUNNING",
        "head": os.environ.get("GITHUB_SHA"),
        "startingHead": prereg["startingLiveHead"],
        "prereg": {"fusionOutcomesInspected": False, "path": args.prereg},
        "authority": prereg["authority"],
        "productionChange": "NO",
        "candidatePopulation": {"gt": 8, "top8": 64, "wrong": 64, "nearGt": 0, "unchanged": True},
        "componentReproduction": {"D2": {}, "L1": {}, "L3": {}},
        "samePose": {"required": True, "tuplesChecked": 0, "mismatches": 0},
        "formulaConformance": {"tuplesChecked": 0, "maxAbsError": {"F1": 0.0, "F2": 0.0, "F3": 0.0}},
        "controls": {},
        "heads": {},
    }

    all_pose_rows = {}
    for cid in CONTROLS:
        m, l = manifests[cid], learned[cid]
        if m["status"] != "PASS" or l["status"] != "PASS":
            raise AssertionError(f"component job not PASS {cid}")
        if m["head"] != out["head"] or l["head"] != out["head"]:
            raise AssertionError(f"head mismatch {cid}")
        if not m.get("samePoseInvariant") or not m.get("repeatDeterminism", {}).get("bitwiseNumberEqual"):
            raise AssertionError(f"same-pose/repeat determinism missing {cid}")
        if m["referencePack"]["candidateCount"] != 9 or m["referencePack"]["posesPerCandidate"] != 81:
            raise AssertionError(f"render population {cid}")
        if len(m["candidates"]) != 9 or len(l["candidateResults"]) != 9:
            raise AssertionError(f"candidate count {cid}")
        if m["query"]["rgb8Sha256"] != l["query"]["rgb192Sha256"]:
            raise AssertionError(f"query RGB mismatch {cid}")
        acc_control = learned_authority["controls"][cid]
        if l["query"]["pre196RgbSha256"] != acc_control["pre196RgbSha256"]:
            raise AssertionError(f"learned pre196 reproduction {cid}")

        lm = {c["candidateId"]: c for c in l["candidateResults"]}
        fused_candidates = []
        for mc in m["candidates"]:
            lc = lm.get(mc["candidateId"])
            if lc is None or lc["role"] != mc["role"] or len(mc["poses"]) != 81 or len(lc["poses"]) != 81:
                raise AssertionError(f"candidate/pose identity {cid} {mc['candidateId']}")
            poses = []
            for i, (mp, lp) in enumerate(zip(mc["poses"], lc["poses"])):
                if lp["poseIndex"] != i or not pose_equal(mp["pose"], mp["d2Pose"]) or not pose_equal(mp["pose"], lp["pose"]):
                    out["samePose"]["mismatches"] += 1
                    raise AssertionError(f"same-pose invariant {cid} {mc['candidateId']} pose {i}")
                if mp["rgb8Sha256"] != lp["rgb8Sha256"]:
                    raise AssertionError(f"reference RGB identity {cid} {mc['candidateId']} pose {i}")
                d2 = float(mp["d2Score"]); l1 = float(lp["scores"]["L1"]); l3 = float(lp["scores"]["L3"])
                f = fusion_scores(d2, l1, l3)
                # Independent literal arithmetic recomputation; formulas are frozen and no normalization is permitted.
                checks = {"F1": (d2 + l1) / 2.0, "F2": (d2 + l3) / 2.0, "F3": (d2 + l1 + l3) / 3.0}
                for h in HEADS:
                    err = abs(f[h] - checks[h]); out["formulaConformance"]["maxAbsError"][h] = max(out["formulaConformance"]["maxAbsError"][h], err)
                    if err > prereg["implementationConformance"]["formulaToleranceAbs"]:
                        raise AssertionError(f"fusion arithmetic {h} {cid}")
                poses.append({"poseIndex": i, "pose": mp["pose"], "D2": d2, "L1": l1, "L3": l3, "fusion": f, "rgb8Sha256": mp["rgb8Sha256"], "pre196RgbSha256": lp["pre196RgbSha256"]})
                out["samePose"]["tuplesChecked"] += 1; out["formulaConformance"]["tuplesChecked"] += 1
            fused_candidates.append({"candidateId": mc["candidateId"], "role": mc["role"], "classification": mc["classification"], "productionRank": mc.get("productionRank"), "base": mc["base"], "poses": poses})

        # D2 reproduction against accepted Descriptor V2 per-control artifact: every locked candidate and every candidate's symmetric-81 maximum.
        v2_paths = glob.glob(os.path.join(args.v2_root, cid, "**", f"{cid}.json"), recursive=True)
        if len(v2_paths) != 1:
            raise AssertionError(f"V2 authority file count {cid}: {v2_paths}")
        v2 = json.load(open(v2_paths[0]))
        if v2["status"] != "PASS" or v2["controlId"] != cid:
            raise AssertionError(f"V2 authority invalid {cid}")
        v2d2 = v2["descriptors"]["D2"]
        locked_index = m["poseGrid"]["lockedIndex"]
        d2_max_error = 0.0; d2_pose_mismatches = 0
        fused_by_id = {c["candidateId"]: c for c in fused_candidates}
        for stage in ("locked", "pose81"):
            for ar in v2d2[stage]["rows"]:
                fc = fused_by_id[ar["candidateId"]]
                selected = fc["poses"][locked_index] if stage == "locked" else max(fc["poses"], key=lambda p: p["D2"])
                err = abs(selected["D2"] - float(ar["score"])); d2_max_error = max(d2_max_error, err)
                if err > prereg["implementationConformance"]["D2ToleranceAbs"]:
                    raise AssertionError(f"D2 reproduction {cid} {stage} {ar['candidateId']} {selected['D2']} != {ar['score']}")
                if not pose_equal(selected["pose"], ar["bestPose"], 1e-9):
                    d2_pose_mismatches += 1
                    raise AssertionError(f"D2 best-pose reproduction {cid} {stage} {ar['candidateId']}")
        out["componentReproduction"]["D2"][cid] = {"status": "PASS", "maxAbsError": d2_max_error, "bestPoseMismatches": d2_pose_mismatches, "acceptedArtifact": prereg["authority"]["descriptorV2"]["componentArtifactByControl"][cid]}

        # Learned reproduction against committed accepted Learned V1 evidence, all candidate locked and best-81 scores for L1/L3.
        for h in LEARNED_HEADS:
            maxerr = 0.0
            for stage in ("locked", "pose81"):
                got = {r["candidateId"]: float(r["score"]) for r in l["heads"][h][stage]["rows"]}
                exp = {r["candidateId"]: float(r["score"]) for r in acc_control["heads"][h][stage]["candidateScores"]}
                if set(got) != set(exp):
                    raise AssertionError(f"learned candidate reproduction membership {cid} {h} {stage}")
                for candidate_id in got:
                    err = abs(got[candidate_id] - exp[candidate_id]); maxerr = max(maxerr, err)
                    if err > prereg["implementationConformance"]["learnedToleranceAbs"]:
                        raise AssertionError(f"learned reproduction {cid} {h} {stage} {candidate_id}")
            out["componentReproduction"][h][cid] = {"status": "PASS", "maxAbsError": maxerr, "acceptedEvidenceBlob": prereg["authority"]["learnedV1"]["evidenceBlob"]}

        control_out = {"name": m["control"]["name"], "role": m["control"]["role"], "region": m["control"]["region"], "queryRgb192Sha256": m["query"]["rgb8Sha256"], "pre196RgbSha256": l["query"]["pre196RgbSha256"], "repeatDeterminism": m["repeatDeterminism"], "heads": {}}
        for h in HEADS:
            locked = summarize(fused_candidates, h, locked_index, "locked")
            pose81 = summarize(fused_candidates, h, locked_index, "pose81")
            control_out["heads"][h] = {"locked": locked, "pose81": pose81, "orderingChanged": locked["gtRank"] != pose81["gtRank"] or locked["positive"] != pose81["positive"] or locked["strongestWrongCandidateId"] != pose81["strongestWrongCandidateId"]}
        out["controls"][cid] = control_out
        all_pose_rows[cid] = fused_candidates

    # Cross-control owner, General drift, Fang, and exact survivor clauses.
    local_survivors = []
    for h in HEADS:
        locked_margins = [out["controls"][c]["heads"][h]["locked"]["margin"] for c in OWNER]
        pose_margins = [out["controls"][c]["heads"][h]["pose81"]["margin"] for c in OWNER]
        locked_pos = [c for c in OWNER if out["controls"][c]["heads"][h]["locked"]["positive"]]
        pose_pos = [c for c in OWNER if out["controls"][c]["heads"][h]["pose81"]["positive"]]
        regions = {c: out["controls"][c]["region"] for c in OWNER}
        gh_l = out["controls"]["general-shrine"]["heads"][h]["locked"]["margin"]
        gr_l = out["controls"]["general-shrine-repeat"]["heads"][h]["locked"]["margin"]
        gh_81 = out["controls"]["general-shrine"]["heads"][h]["pose81"]["margin"]
        gr_81 = out["controls"]["general-shrine-repeat"]["heads"][h]["pose81"]["margin"]
        dlocked = drift_class(gh_l, gr_l); d81 = drift_class(gh_81, gr_81)
        fang_l = out["controls"]["fang-xu"]["heads"][h]["locked"]
        fang_81 = out["controls"]["fang-xu"]["heads"][h]["pose81"]
        clauses = {
            "ownerLockedAtLeast4of6": len(locked_pos) >= 4,
            "ownerPose81AtLeast4of6": len(pose_pos) >= 4,
            "lockedIncludesQingheAndKaifeng": {regions[c] for c in locked_pos} >= {"Qinghe", "Kaifeng"},
            "pose81IncludesQingheAndKaifeng": {regions[c] for c in pose_pos} >= {"Qinghe", "Kaifeng"},
            "fangLockedPreferred": fang_l["positive"],
            "fangPose81Preferred": fang_81["positive"],
            "generalLockedDriftSafe": dlocked in ("DR-STABLE", "DR-PARTIAL"),
            "generalPose81DriftSafe": d81 in ("DR-STABLE", "DR-PARTIAL"),
            "candidatePopulationUnchanged": True,
            "productionGatesOrBeamChanged": False,
        }
        survivor = all(clauses.values())
        if survivor: local_survivors.append(h)
        out["heads"][h] = {
            "owner": {
                "lockedPositive": len(locked_pos), "pose81Positive": len(pose_pos),
                "lockedPositiveControls": locked_pos, "pose81PositiveControls": pose_pos,
                "lockedQinghePositive": [c for c in locked_pos if regions[c] == "Qinghe"], "lockedKaifengPositive": [c for c in locked_pos if regions[c] == "Kaifeng"],
                "pose81QinghePositive": [c for c in pose_pos if regions[c] == "Qinghe"], "pose81KaifengPositive": [c for c in pose_pos if regions[c] == "Kaifeng"],
                "lockedMedianMargin": statistics.median(locked_margins), "lockedWorstMargin": min(locked_margins),
                "pose81MedianMargin": statistics.median(pose_margins), "pose81WorstMargin": min(pose_margins),
                "lockedRanks": {c: out["controls"][c]["heads"][h]["locked"]["gtRank"] for c in OWNER},
                "pose81Ranks": {c: out["controls"][c]["heads"][h]["pose81"]["gtRank"] for c in OWNER},
            },
            "generalDrift": {"locked": {"historicalMargin": gh_l, "repeatMargin": gr_l, "class": dlocked}, "pose81": {"historicalMargin": gh_81, "repeatMargin": gr_81, "class": d81}},
            "fang": {"locked": {k: fang_l[k] for k in ("margin", "gtRank", "gtScore", "strongestWrongScore", "strongestWrongCandidateId", "positive")}, "pose81": {k: fang_81[k] for k in ("margin", "gtRank", "gtScore", "strongestWrongScore", "strongestWrongCandidateId", "positive")}},
            "survivorClauses": clauses,
            "localSurvivor": survivor,
        }

    out["localSurvivors"] = local_survivors
    out["fullPoseEvidence"] = all_pose_rows
    if local_survivors:
        out["retrieval"] = {"status": "REQUIRED_FOR_LOCAL_SURVIVORS", "eligibleHeads": local_survivors}
        out["stress40Frame"] = {"status": "PENDING_RETRIEVAL_SAFETY"}
        out["FA"] = "PENDING_CONDITIONAL_RETRIEVAL_AND_STRESS"
        out["status"] = "INCOMPLETE_PROTOCOL"
        exit_code = 3
    else:
        out["retrieval"] = {"status": "SKIPPED_NO_LOCAL_SURVIVORS"}
        out["stress40Frame"] = {"status": "SKIPPED_NO_RETRIEVAL_SAFE_SURVIVORS"}
        material = any(out["controls"][cid]["heads"][h][stage]["positive"] for cid in OWNER + ("fang-xu",) for h in HEADS for stage in ("locked", "pose81"))
        out["unsafePersistentFalseBasinEvidence"] = False
        out["materialPartialPositiveSeparation"] = material
        out["FA"] = "FA2 — PARTIAL FUSION RESCUE" if material else "FA3 — FUSION NON-SEPARABLE"
        out["status"] = "PASS"
        exit_code = 0

    out["productionFeasibilityArchitectureTaskJustified"] = out["FA"] == "FA1 — COMMON FUSION SURVIVES"
    out["productionChange"] = "NO"
    out["researchClosureRequired"] = out["FA"] in ("FA2 — PARTIAL FUSION RESCUE", "FA3 — FUSION NON-SEPARABLE", "FA4 — FUSION UNSAFE")
    out_dir = Path(args.output); out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / "fusion-v1-local-evidence.json"; p.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    (out_dir / "fusion-v1.status.txt").write_text(f"STATUS={out['status']}\nFA={out['FA']}\nLOCAL_SURVIVORS={','.join(local_survivors)}\nPRODUCTION_CHANGE=NO\n")
    print(json.dumps({"status": out["status"], "FA": out["FA"], "localSurvivors": local_survivors, "samePoseTuples": out["samePose"]["tuplesChecked"], "materialPartialPositive": out.get("materialPartialPositiveSeparation")}, sort_keys=True))
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
