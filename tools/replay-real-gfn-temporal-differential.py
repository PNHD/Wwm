#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass, asdict
from pathlib import Path

import cv2
import numpy as np

TILE_RE = re.compile(r"^(\d+)_(\d+)\.png$")
CENTER = np.array([96.0, 96.0], np.float32)
BITCOUNT = np.array([int(i).bit_count() for i in range(256)], dtype=np.uint8)
SELECTED_1BASED = [1, 5, 10, 15, 20, 25, 30, 40]
PAIR_INDEXES = [(0, 2), (0, 4), (0, 7), (1, 3), (2, 5), (3, 6), (4, 7)]


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def norm_angle(a: float) -> float:
    return a % 360.0


def angle_delta(a: float, b: float) -> float:
    return abs(((a - b + 540.0) % 360.0) - 180.0)


def positions_mask() -> np.ndarray:
    yy, xx = np.mgrid[:192, :192]
    nx = (xx - 96.0) / 96.0
    ny = (yy - 96.0) / 96.0
    rr = np.sqrt(nx * nx + ny * ny)
    return (rr >= .20) & (rr <= .78)


MASK = positions_mask()


def robust_norm(gray: np.ndarray) -> np.ndarray:
    x = gray.astype(np.float32)
    vals = x[MASK]
    lo, hi = np.percentile(vals, [2, 98])
    if hi <= lo + 1e-6:
        return np.zeros_like(gray, dtype=np.uint8)
    x = np.clip((x - lo) * (255.0 / (hi - lo)), 0, 255).astype(np.uint8)
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(x)


def gradient_repr(gray: np.ndarray) -> np.ndarray:
    g = robust_norm(gray)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    p = float(np.percentile(mag[MASK], 96))
    if p > 1e-6:
        mag = np.clip(mag / p, 0, 1)
    else:
        mag[:] = 0
    return cv2.GaussianBlur(mag.astype(np.float32), (3, 3), .6)


def edge_repr(grad: np.ndarray) -> np.ndarray:
    vals = grad[MASK]
    th = float(np.percentile(vals, 74))
    edge = grad >= max(th, .08)
    edge &= MASK
    return edge


def census(gray: np.ndarray) -> np.ndarray:
    g = robust_norm(gray)
    code = np.zeros_like(g, dtype=np.uint8)
    offsets = [(-2, -2), (0, -2), (2, -2), (-2, 0), (2, 0), (-2, 2), (0, 2), (2, 2)]
    center = g.astype(np.int16)
    for bit, (dx, dy) in enumerate(offsets):
        shifted = np.roll(np.roll(g, dy, axis=0), dx, axis=1).astype(np.int16)
        code |= ((shifted >= center).astype(np.uint8) << bit)
    code[~MASK] = 0
    return code


def build_atlas(tile_dir: Path) -> tuple[np.ndarray, dict]:
    records = []
    for p in tile_dir.glob("*.png"):
        m = TILE_RE.match(p.name)
        if m:
            records.append((int(m.group(1)), int(m.group(2)), p))
    if not records:
        raise RuntimeError(f"no atlas tiles in {tile_dir}")
    xs, ys = [r[0] for r in records], [r[1] for r in records]
    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
    sample = cv2.imread(str(records[0][2]), cv2.IMREAD_GRAYSCALE)
    if sample is None:
        raise RuntimeError(f"cannot read {records[0][2]}")
    th, tw = sample.shape
    atlas = np.zeros(((max_y - min_y + 1) * th, (max_x - min_x + 1) * tw), np.uint8)
    for x, y, p in records:
        img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if img is None:
            raise RuntimeError(f"cannot read {p}")
        ox, oy = (x - min_x) * tw, (y - min_y) * th
        atlas[oy:oy + th, ox:ox + tw] = img
    meta = {
        "tileCount": len(records), "tileWidth": tw, "tileHeight": th,
        "minTileX": min_x, "maxTileX": max_x, "minTileY": min_y, "maxTileY": max_y,
        "globalOriginX": min_x * tw, "globalOriginY": min_y * th,
        "width": int(atlas.shape[1]), "height": int(atlas.shape[0]),
    }
    return atlas, meta


def load_raw_frames(fixture_dir: Path) -> list[np.ndarray]:
    capture = json.loads((fixture_dir / "capture.json").read_text(encoding="utf-8-sig"))
    frames = capture.get("frames") or []
    if len(frames) != 40:
        raise RuntimeError(f"expected exact 40-frame fixture, got {len(frames)}")
    out = []
    for one_based in SELECTED_1BASED:
        rec = frames[one_based - 1]
        name = rec.get("minimap") or rec.get("minimapFile") or rec.get("cropFile")
        if not name:
            raise RuntimeError(f"frame {one_based} missing minimap path")
        img = cv2.imread(str(fixture_dir / name), cv2.IMREAD_GRAYSCALE)
        if img is None:
            raise RuntimeError(f"cannot read frame {fixture_dir / name}")
        if img.shape[0] >= 216 and img.shape[1] >= 216:
            img = img[:216, :216]
        img = cv2.resize(img, (192, 192), interpolation=cv2.INTER_AREA)
        out.append(img)
    return out


def source_displacements_from_joint(joint: dict) -> list[tuple[float, float]]:
    best = joint.get("bestJointPose")
    if not best:
        raise RuntimeError("joint evidence has no best pose")
    pose = best["pose"]
    a = math.radians(float(pose["angle"]))
    c, s = math.cos(a), math.sin(a)
    scale = float(pose["radius"]) / 96.0
    rows = best["flowScores"]
    if [int(r["frame"]) for r in rows] != SELECTED_1BASED:
        raise RuntimeError("joint flowScores frame set does not match expected independent frames")
    out = []
    for r in rows:
        wx, wy = float(r["predictedDx"]), float(r["predictedDy"])
        sx = (wx * c + wy * s) / scale
        sy = (-wx * s + wy * c) / scale
        out.append((sx, sy))
    return out


def render_atlas(atlas: np.ndarray, meta: dict, center_x: float, center_y: float, radius: float, angle: float) -> np.ndarray:
    scale = radius / 96.0
    a = math.radians(angle)
    c, s = math.cos(a), math.sin(a)
    yy, xx = np.mgrid[:192, :192].astype(np.float32)
    qx, qy = xx - 96.0, yy - 96.0
    map_x = (center_x - meta["globalOriginX"]) + scale * (c * qx - s * qy)
    map_y = (center_y - meta["globalOriginY"]) + scale * (s * qx + c * qy)
    return cv2.remap(atlas, map_x.astype(np.float32), map_y.astype(np.float32), interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def trajectory_centers(pose: dict, source_disp: list[tuple[float, float]], mode: str) -> list[tuple[float, float]]:
    a = math.radians(float(pose["angle"]))
    c, s = math.cos(a), math.sin(a)
    scale = float(pose["radius"]) / 96.0
    out = []
    for sx, sy in source_disp:
        wx = (sx * c - sy * s) * scale
        wy = (sx * s + sy * c) * scale
        if mode == "static":
            wx = wy = 0.0
        elif mode == "reverse":
            wx, wy = -wx, -wy
        elif mode == "orthogonal":
            wx, wy = -wy, wx
        out.append((float(pose["x"]) + wx, float(pose["y"]) + wy))
    return out


def corr01(a: np.ndarray, b: np.ndarray, mask: np.ndarray = MASK) -> float:
    av = a[mask].astype(np.float64)
    bv = b[mask].astype(np.float64)
    av -= av.mean(); bv -= bv.mean()
    den = float(np.linalg.norm(av) * np.linalg.norm(bv))
    if den <= 1e-8:
        return .5
    return clamp((float(np.dot(av, bv) / den) + 1.0) * .5, 0.0, 1.0)


def edge_f1(a: np.ndarray, b: np.ndarray) -> float:
    aa = a & MASK; bb = b & MASK
    inter = int(np.logical_and(aa, bb).sum())
    denom = int(aa.sum() + bb.sum())
    return (2.0 * inter / denom) if denom else 0.0


def energy_similarity(a: np.ndarray, b: np.ndarray) -> float:
    ea = float(np.mean(np.abs(a[MASK]))) + 1e-6
    eb = float(np.mean(np.abs(b[MASK]))) + 1e-6
    return math.exp(-abs(math.log(eb / ea)))


def reps(sequence: list[np.ndarray]) -> dict:
    grads = [gradient_repr(x) for x in sequence]
    edges = [edge_repr(g) for g in grads]
    cens = [census(x) for x in sequence]
    return {"grad": grads, "edge": edges, "census": cens}


def pair_metrics(src: dict, atlas: dict, i: int, j: int) -> dict:
    sd = src["grad"][j] - src["grad"][i]
    ad = atlas["grad"][j] - atlas["grad"][i]
    sad = np.abs(sd); aad = np.abs(ad)
    se = np.logical_xor(src["edge"][j], src["edge"][i])
    ae = np.logical_xor(atlas["edge"][j], atlas["edge"][i])
    sc = BITCOUNT[np.bitwise_xor(src["census"][j], src["census"][i])].astype(np.float32) / 8.0
    ac = BITCOUNT[np.bitwise_xor(atlas["census"][j], atlas["census"][i])].astype(np.float32) / 8.0
    signed = corr01(sd, ad)
    abs_corr = corr01(sad, aad)
    census_corr = corr01(sc, ac)
    ef1 = edge_f1(se, ae)
    energy = energy_similarity(sad, aad)
    score = .35 * signed + .20 * abs_corr + .20 * census_corr + .15 * ef1 + .10 * energy
    return {
        "fromFrame": SELECTED_1BASED[i], "toFrame": SELECTED_1BASED[j],
        "signedGradientCorrelation01": signed,
        "absoluteGradientChangeCorrelation01": abs_corr,
        "censusChangeCorrelation01": census_corr,
        "edgeChangeF1": ef1,
        "changeEnergySimilarity": energy,
        "score": score,
    }


def objective(pair_rows: list[dict]) -> dict:
    vals = np.array([r["score"] for r in pair_rows], np.float64)
    return {
        "objective": float(.50 * np.median(vals) + .30 * np.percentile(vals, 25) + .20 * np.mean(vals)),
        "mean": float(np.mean(vals)), "median": float(np.median(vals)),
        "p25": float(np.percentile(vals, 25)), "min": float(np.min(vals)), "max": float(np.max(vals)),
    }


def eval_pose(atlas: np.ndarray, meta: dict, src_rep: dict, source_disp: list[tuple[float, float]], pose: dict, mode: str) -> dict:
    centers = trajectory_centers(pose, source_disp, mode)
    rendered = [render_atlas(atlas, meta, x, y, float(pose["radius"]), float(pose["angle"])) for x, y in centers]
    ar = reps(rendered)
    pairs = [pair_metrics(src_rep, ar, i, j) for i, j in PAIR_INDEXES]
    return {"mode": mode, "centers": centers, "pairs": pairs, "metrics": objective(pairs)}


def dedupe_seeds(seeds: list[dict]) -> list[dict]:
    out = []
    for s in seeds:
        p = s["pose"]
        dup = False
        for q in out:
            qp = q["pose"]
            if (math.hypot(p["x"] - qp["x"], p["y"] - qp["y"]) < 75
                    and angle_delta(p["angle"], qp["angle"]) < 18
                    and abs(math.log(p["radius"] / qp["radius"])) < .16):
                dup = True; break
        if not dup:
            out.append(s)
    return out


def distinct(rows: list[dict], limit: int = 8) -> list[dict]:
    out = []
    for r in rows:
        p = r["pose"]
        if any(math.hypot(p["x"] - q["pose"]["x"], p["y"] - q["pose"]["y"]) < 100
               and angle_delta(p["angle"], q["pose"]["angle"]) < 24
               and abs(math.log(p["radius"] / q["pose"]["radius"])) < .20 for q in out):
            continue
        out.append(r)
        if len(out) >= limit:
            break
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", type=Path, default=Path("replay-site"))
    ap.add_argument("--fixture", type=Path, required=True)
    ap.add_argument("--dino-candidates", type=Path, required=True)
    ap.add_argument("--dino-sequence", type=Path, required=True)
    ap.add_argument("--joint", type=Path, required=True)
    ap.add_argument("--report", type=Path, required=True)
    args = ap.parse_args()

    atlas, atlas_meta = build_atlas(args.site / "dashen-cache" / "main" / "5")
    raw = load_raw_frames(args.fixture)
    src_rep = reps(raw)
    dino = json.loads(args.dino_candidates.read_text(encoding="utf-8-sig"))
    dino_seq = json.loads(args.dino_sequence.read_text(encoding="utf-8-sig"))
    joint = json.loads(args.joint.read_text(encoding="utf-8-sig"))
    source_disp = source_displacements_from_joint(joint)

    by_rank = {int(c["rank"]): c for c in dino.get("candidates", [])}
    seeds = []
    for c in dino.get("candidates", []):
        seeds.append({"source": "dino-generator", "seedRank": c["rank"], "dinoRank": c.get("dinoRank"), "pose": {k: float(c[k]) for k in ("x", "y", "radius", "angle")}})
    for h in dino_seq.get("sequenceRankedTopK", [])[:24]:
        c = h.get("candidate", {})
        if int(c.get("rank", -1)) in by_rank:
            c = by_rank[int(c["rank"])]
        seeds.insert(0, {"source": "dino-prior-sequence", "seedRank": c.get("rank"), "dinoRank": c.get("dinoRank"), "pose": {k: float(c[k]) for k in ("x", "y", "radius", "angle")}})
    for f in joint.get("finals", []):
        p = f["pose"]
        seeds.insert(0, {"source": "joint-flow-final", "seedRank": f.get("seedRank"), "dinoRank": f.get("dinoRank"), "pose": {k: float(p[k]) for k in ("x", "y", "radius", "angle")}})
    seeds = dedupe_seeds(seeds)

    baseline = []
    for s in seeds:
        ev = eval_pose(atlas, atlas_meta, src_rep, source_disp, s["pose"], "flow")
        baseline.append({**s, "flow": ev})
    baseline.sort(key=lambda r: r["flow"]["metrics"]["objective"], reverse=True)

    search = baseline[:16]
    coarse = []
    for row in search:
        p0 = row["pose"]
        best = None
        for dy in (-16.0, 0.0, 16.0):
            for dx in (-16.0, 0.0, 16.0):
                for da in (-10.0, 0.0, 10.0):
                    p = {"x": p0["x"] + dx, "y": p0["y"] + dy, "radius": p0["radius"], "angle": norm_angle(p0["angle"] + da)}
                    ev = eval_pose(atlas, atlas_meta, src_rep, source_disp, p, "flow")
                    cand = {"source": row["source"], "seedRank": row.get("seedRank"), "dinoRank": row.get("dinoRank"), "pose": p, "flow": ev}
                    if best is None or ev["metrics"]["objective"] > best["flow"]["metrics"]["objective"]:
                        best = cand
        coarse.append(best)
    coarse.sort(key=lambda r: r["flow"]["metrics"]["objective"], reverse=True)
    coarse = distinct(coarse, 8)

    finals = []
    for row in coarse:
        p0 = row["pose"]
        best = None
        for dy in (-6.0, 0.0, 6.0):
            for dx in (-6.0, 0.0, 6.0):
                for da in (-4.0, 0.0, 4.0):
                    for rf in (.97, 1.0, 1.03):
                        p = {"x": p0["x"] + dx, "y": p0["y"] + dy, "radius": p0["radius"] * rf, "angle": norm_angle(p0["angle"] + da)}
                        ev = eval_pose(atlas, atlas_meta, src_rep, source_disp, p, "flow")
                        cand = {"source": row["source"], "seedRank": row.get("seedRank"), "dinoRank": row.get("dinoRank"), "pose": p, "flow": ev}
                        if best is None or ev["metrics"]["objective"] > best["flow"]["metrics"]["objective"]:
                            best = cand
        best["reverse"] = eval_pose(atlas, atlas_meta, src_rep, source_disp, best["pose"], "reverse")
        best["orthogonal"] = eval_pose(atlas, atlas_meta, src_rep, source_disp, best["pose"], "orthogonal")
        best["static"] = eval_pose(atlas, atlas_meta, src_rep, source_disp, best["pose"], "static")
        control_max = max(best["reverse"]["metrics"]["objective"], best["orthogonal"]["metrics"]["objective"])
        best["motionControlMargin"] = best["flow"]["metrics"]["objective"] - control_max
        best["staticMargin"] = best["flow"]["metrics"]["objective"] - best["static"]["metrics"]["objective"]
        positives = 0
        for k in range(len(PAIR_INDEXES)):
            fv = best["flow"]["pairs"][k]["score"]
            rv = best["reverse"]["pairs"][k]["score"]
            ov = best["orthogonal"]["pairs"][k]["score"]
            positives += int(fv > max(rv, ov))
        best["pairWinsVsMotionControls"] = positives
        early = [p for p in best["flow"]["pairs"] if p["toFrame"] <= 20]
        late = [p for p in best["flow"]["pairs"] if p["fromFrame"] >= 10]
        best["earlyMetrics"] = objective(early) if early else None
        best["lateMetrics"] = objective(late) if late else None
        finals.append(best)
    finals.sort(key=lambda r: r["flow"]["metrics"]["objective"], reverse=True)
    distinct_final = distinct(finals, 8)
    best = distinct_final[0] if distinct_final else None
    second = distinct_final[1] if len(distinct_final) > 1 else None
    separation = best["flow"]["metrics"]["objective"] - second["flow"]["metrics"]["objective"] if best and second else None

    # Fixed hard negatives from earlier forensic work. These are evaluated exactly as recorded and are never optimized.
    fixed_negatives = [
        {"name": "rejected-legacy-frame40-basin", "pose": {"x": 5216.8, "y": 3996.3, "radius": 96.0 * 2.456, "angle": 348.0}},
        {"name": "rejected-invariant-index-basin", "pose": {"x": 6161.5, "y": 3870.5, "radius": 360.40, "angle": 151.5}},
    ]
    for n in fixed_negatives:
        n["flow"] = eval_pose(atlas, atlas_meta, src_rep, source_disp, n["pose"], "flow")
        n["reverse"] = eval_pose(atlas, atlas_meta, src_rep, source_disp, n["pose"], "reverse")
        n["orthogonal"] = eval_pose(atlas, atlas_meta, src_rep, source_disp, n["pose"], "orthogonal")
    fixed_max = max((n["flow"]["metrics"]["objective"] for n in fixed_negatives), default=-1.0)
    fixed_sep = best["flow"]["metrics"]["objective"] - fixed_max if best else None

    strong_score = bool(best and best["flow"]["metrics"]["median"] >= .56)
    motion_margin = bool(best and best["motionControlMargin"] >= .025)
    pair_support = bool(best and best["pairWinsVsMotionControls"] >= 5)
    hard_sep = separation is None or separation >= .015
    fixed_negative_sep = fixed_sep is None or fixed_sep >= .015
    early_late = bool(best and best["earlyMetrics"] and best["lateMetrics"] and best["earlyMetrics"]["median"] >= .54 and best["lateMetrics"]["median"] >= .54)
    promising = strong_score and motion_margin and pair_support and hard_sep and fixed_negative_sep and early_late

    report = {
        "schema": "wwmsync-real-gfn-temporal-differential-v1",
        "scope": {"replayOnly": True, "productRuntimeChanged": False, "productionGateLowered": False, "knownFalseCandidateOptimized": False},
        "method": {
            "name": "motion-conditioned temporal differential correspondence",
            "representations": ["signed gradient change", "absolute gradient change", "Census rank-order change", "edge-change F1", "change-energy consistency"],
            "motivation": "cancel persistent GFN-vs-public-map appearance bias and score how local structure changes under the observed motion",
            "evaluationFrames1Based": SELECTED_1BASED,
            "pairs1Based": [[SELECTED_1BASED[i], SELECTED_1BASED[j]] for i, j in PAIR_INDEXES],
            "annulusMask": {"normalizedRadiusMin": .20, "normalizedRadiusMax": .78},
        },
        "atlas": atlas_meta,
        "sourcePlayerDisplacements": [{"frame": SELECTED_1BASED[i], "sx": d[0], "sy": d[1]} for i, d in enumerate(source_disp)],
        "sourceCandidates": {"dinoCount": len(dino.get("candidates", [])), "dedupSeedCount": len(seeds), "baselineSearchCount": len(search), "fineBasinCount": len(finals)},
        "search": {"coarse": {"positionOffsetsPx": [-16, 0, 16], "angleOffsetsDeg": [-10, 0, 10], "radiusFactors": [1]}, "fine": {"positionOffsetsPx": [-6, 0, 6], "angleOffsetsDeg": [-4, 0, 4], "radiusFactors": [.97, 1, 1.03]}},
        "acceptance": {
            "diagnosticOnly": True,
            "minimumMedianDifferentialScore": .56,
            "minimumMotionControlMargin": .025,
            "minimumPairWinsVsReverseOrOrthogonal": 5,
            "minimumDistinctBasinSeparation": .015,
            "minimumFixedRejectedBasinSeparation": .015,
            "minimumEarlyLateMedian": .54,
            "strongScore": strong_score,
            "motionMargin": motion_margin,
            "pairSupport": pair_support,
            "hardNegativeSeparation": hard_sep,
            "fixedRejectedSeparation": fixed_negative_sep,
            "earlyLateSupport": early_late,
        },
        "baselineTop": baseline[:16],
        "finals": finals,
        "hardNegativeSeparation": {"distinctFinalCount": len(distinct_final), "bestObjective": best["flow"]["metrics"]["objective"] if best else None, "secondDistinctObjective": second["flow"]["metrics"]["objective"] if second else None, "positiveSeparation": separation},
        "fixedRejectedCandidates": fixed_negatives,
        "fixedRejectedSeparation": fixed_sep,
        "best": best,
        "temporalDifferentialVerdict": "PROMISING-TRUE-LIKE-DIFFERENTIAL-BASIN" if promising else "NO-TRUE-LIKE-DIFFERENTIAL-BASIN",
        "productChangeJustified": False,
        "liveTestingJustified": False,
        "nextAction": "If promising, replay the exact basin through an independent production-suitable verifier and synthetic hard negatives before any runtime integration. If not promising, stop unsupervised representation iteration on this fixture and require paired/ground-truth data or a stronger semantic signal.",
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "report": str(args.report), "verdict": report["temporalDifferentialVerdict"], "acceptance": report["acceptance"],
        "hardNegativeSeparation": report["hardNegativeSeparation"], "fixedRejectedSeparation": fixed_sep,
        "best": None if best is None else {"seedRank": best.get("seedRank"), "dinoRank": best.get("dinoRank"), "pose": best["pose"], "flow": best["flow"]["metrics"], "reverse": best["reverse"]["metrics"], "orthogonal": best["orthogonal"]["metrics"], "static": best["static"]["metrics"], "motionControlMargin": best["motionControlMargin"], "pairWins": best["pairWinsVsMotionControls"], "early": best["earlyMetrics"], "late": best["lateMetrics"]},
        "productChangeJustified": False, "liveTestingJustified": False,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
