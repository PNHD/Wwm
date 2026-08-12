#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import cv2
import numpy as np
import torch

TILE_RE = re.compile(r"^(\d+)_(\d+)\.png$")
QUERY_CENTER = np.array([96.0, 96.0], dtype=np.float32)


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def norm_angle(a: float) -> float:
    return a % 360.0


def angle_delta(a: float, b: float) -> float:
    return abs(((a - b + 540.0) % 360.0) - 180.0)


def robust_norm(gray: np.ndarray) -> np.ndarray:
    gray = gray.astype(np.float32)
    lo, hi = np.percentile(gray, [2, 98])
    if hi <= lo + 1e-6:
        return np.zeros_like(gray, dtype=np.uint8)
    out = np.clip((gray - lo) * (255.0 / (hi - lo)), 0, 255).astype(np.uint8)
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(out)


def gradient_repr(gray: np.ndarray) -> np.ndarray:
    g = robust_norm(gray)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    p = float(np.percentile(mag, 97))
    if p <= 1e-6:
        return np.zeros_like(g)
    return np.clip(mag * (255.0 / p), 0, 255).astype(np.uint8)


def variants(gray: np.ndarray) -> dict[str, np.ndarray]:
    return {"clahe": robust_norm(gray), "gradient": gradient_repr(gray)}


def positions(length: int, patch: int, stride: int) -> list[int]:
    if length <= patch:
        return [0]
    out = list(range(0, max(1, length - patch + 1), stride))
    last = length - patch
    if out[-1] != last:
        out.append(last)
    return out


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
        "tileDir": str(tile_dir), "tileCount": len(records), "tileWidth": tw, "tileHeight": th,
        "minTileX": min_x, "maxTileX": max_x, "minTileY": min_y, "maxTileY": max_y,
        "globalOriginX": min_x * tw, "globalOriginY": min_y * th,
        "width": int(atlas.shape[1]), "height": int(atlas.shape[0]),
    }
    return atlas, meta


def tensor_image(gray: np.ndarray, device: torch.device) -> torch.Tensor:
    rgb = np.repeat(gray[..., None], 3, axis=2)
    return torch.from_numpy(rgb).permute(2, 0, 1).float().unsqueeze(0).to(device) / 255.0


def extract(model, gray: np.ndarray, top_k: int, threshold: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    with torch.inference_mode():
        out = model.detectAndCompute(tensor_image(gray, model.dev), top_k=top_k, detection_threshold=threshold)[0]
    kp = out["keypoints"].detach().cpu().numpy().astype(np.float32)
    desc = out["descriptors"].detach().cpu().numpy().astype(np.float32)
    score = out["scores"].detach().cpu().numpy().astype(np.float32)
    return kp, desc, score


def transform_query(gray: np.ndarray, rotation_deg: float, scale: float) -> tuple[np.ndarray, np.ndarray]:
    h, w = gray.shape[:2]
    center = ((w - 1) / 2.0, (h - 1) / 2.0)
    M = cv2.getRotationMatrix2D(center, rotation_deg, 1.0)
    rot = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    if scale != 1.0:
        run = cv2.resize(rot, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    else:
        run = rot
    inv = cv2.invertAffineTransform(M)
    return run, inv


def query_points_to_original(kp: np.ndarray, inv_rot: np.ndarray, scale: float) -> np.ndarray:
    if not len(kp):
        return kp.copy()
    p = kp.astype(np.float64) / scale
    hom = np.concatenate([p, np.ones((len(p), 1), np.float64)], axis=1)
    return (hom @ inv_rot.T).astype(np.float32)


@dataclass
class MatchRec:
    qx: float
    qy: float
    ax: float
    ay: float
    cosine: float
    margin: float
    query_score: float
    atlas_score: float
    weight: float


@dataclass
class Candidate:
    rank: int
    method: str
    queryName: str
    queryVariant: str
    atlasVariant: str
    queryScale: float
    queryRotation: float
    x: float
    y: float
    radius: float
    scale: float
    angle: float
    inlierCount: int
    clusterVoteCount: int
    inlierRatio: float
    medianReprojectionError: float
    meanReprojectionError: float
    queryCoverage: float
    medianDescriptorRatio: float
    meanCosineSimilarity: float
    meanCosineMargin: float
    voteWeight: float
    generatorScore: float
    source: str


def build_feature_bank(model, image: np.ndarray, meta: dict, patch_size: int, stride: int,
                       top_k: int, threshold: float) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    all_kp, all_desc, all_score = [], [], []
    xs = positions(image.shape[1], patch_size, stride)
    ys = positions(image.shape[0], patch_size, stride)
    patch_records = []
    for py in ys:
        for px in xs:
            patch = image[py:py + patch_size, px:px + patch_size]
            kp, desc, score = extract(model, patch, top_k=top_k, threshold=threshold)
            if len(kp):
                kp[:, 0] += px + meta["globalOriginX"]
                kp[:, 1] += py + meta["globalOriginY"]
                all_kp.append(kp); all_desc.append(desc); all_score.append(score)
            patch_records.append({"x": px, "y": py, "features": int(len(kp))})
    if not all_desc:
        return np.empty((0, 2), np.float32), np.empty((0, 64), np.float32), np.empty((0,), np.float32), {"patches": patch_records}
    kp = np.concatenate(all_kp, axis=0)
    desc = np.concatenate(all_desc, axis=0)
    score = np.concatenate(all_score, axis=0)
    return kp, desc, score, {
        "patchSize": patch_size, "stride": stride, "patchCount": len(patch_records),
        "featureCount": int(len(kp)), "patches": patch_records,
    }


def build_flann(desc: np.ndarray):
    matcher = cv2.FlannBasedMatcher(dict(algorithm=1, trees=8), dict(checks=128))
    matcher.add([np.ascontiguousarray(desc, dtype=np.float32)])
    matcher.train()
    return matcher


def global_matches(qkp: np.ndarray, qdesc: np.ndarray, qscore: np.ndarray,
                   akp: np.ndarray, adesc: np.ndarray, ascore: np.ndarray, matcher,
                   min_cos: float, min_margin: float) -> list[MatchRec]:
    if len(qdesc) == 0 or len(adesc) == 0:
        return []
    k = min(8, len(adesc))
    knn = matcher.knnMatch(np.ascontiguousarray(qdesc, dtype=np.float32), k=k)
    out: list[MatchRec] = []
    for qi, neighbors in enumerate(knn):
        if not neighbors:
            continue
        first = neighbors[0]
        a0 = akp[first.trainIdx]
        second = None
        for m in neighbors[1:]:
            if np.linalg.norm(akp[m.trainIdx] - a0) >= 20.0:
                second = m
                break
        if second is None and len(neighbors) > 1:
            second = neighbors[-1]
        d1 = float(first.distance)
        d2 = float(second.distance) if second is not None else 2.0
        cos1 = clamp(1.0 - (d1 * d1) / 2.0, -1.0, 1.0)
        cos2 = clamp(1.0 - (d2 * d2) / 2.0, -1.0, 1.0)
        margin = cos1 - cos2
        if cos1 < min_cos or margin < min_margin:
            continue
        qs = float(qscore[qi]) if qi < len(qscore) else 1.0
        aps = float(ascore[first.trainIdx]) if first.trainIdx < len(ascore) else 1.0
        weight = max(1e-6, (cos1 - min_cos + .02) * (margin + .02) * math.sqrt(max(qs, 1e-5) * max(aps, 1e-5)))
        out.append(MatchRec(
            qx=float(qkp[qi, 0]), qy=float(qkp[qi, 1]),
            ax=float(a0[0]), ay=float(a0[1]), cosine=cos1, margin=margin,
            query_score=qs, atlas_score=aps, weight=weight,
        ))
    return out


def regional_groups(matches: list[MatchRec], cell: int = 448) -> list[list[MatchRec]]:
    bins: dict[tuple[int, int], list[MatchRec]] = {}
    for m in matches:
        key = (int(math.floor(m.ax / cell)), int(math.floor(m.ay / cell)))
        bins.setdefault(key, []).append(m)
    groups = []
    for bx, by in bins:
        merged = []
        for yy in range(by - 1, by + 2):
            for xx in range(bx - 1, bx + 2):
                merged.extend(bins.get((xx, yy), []))
        if len(merged) >= 3:
            groups.append(merged)
    groups.sort(key=lambda g: (len(g), sum(x.weight for x in g)), reverse=True)
    return groups


def candidate_from_group(group: list[MatchRec], query_name: str, qvar: str, avar: str,
                         qscale: float, qrot: float, atlas_meta: dict) -> Candidate | None:
    if len(group) < 3:
        return None
    q = np.float32([[m.qx, m.qy] for m in group]).reshape(-1, 1, 2)
    a = np.float32([[m.ax, m.ay] for m in group]).reshape(-1, 1, 2)
    M, mask = cv2.estimateAffinePartial2D(q, a, method=cv2.RANSAC, ransacReprojThreshold=12.0,
                                         maxIters=8000, confidence=.998, refineIters=30)
    if M is None or mask is None:
        return None
    inliers = mask.ravel().astype(bool)
    n = int(inliers.sum())
    if n < 3:
        return None
    aa, cc = float(M[0, 0]), float(M[1, 0])
    scale = math.hypot(aa, cc)
    if not 1.15 <= scale <= 6.75:
        return None
    angle = norm_angle(math.degrees(math.atan2(cc, aa)))
    center = M @ np.array([QUERY_CENTER[0], QUERY_CENTER[1], 1.0], np.float64)
    x, y = float(center[0]), float(center[1])
    min_x, max_x = atlas_meta["globalOriginX"] - 128, atlas_meta["globalOriginX"] + atlas_meta["width"] + 128
    min_y, max_y = atlas_meta["globalOriginY"] - 128, atlas_meta["globalOriginY"] + atlas_meta["height"] + 128
    if not (min_x <= x <= max_x and min_y <= y <= max_y):
        return None
    qp = q.reshape(-1, 2); ap = a.reshape(-1, 2)
    pred = cv2.transform(q, M).reshape(-1, 2)
    errs = np.linalg.norm(pred - ap, axis=1)[inliers]
    iq = qp[inliers]
    bbox_w = float(iq[:, 0].max() - iq[:, 0].min()) if len(iq) > 1 else 0.0
    bbox_h = float(iq[:, 1].max() - iq[:, 1].min()) if len(iq) > 1 else 0.0
    coverage = clamp((bbox_w * bbox_h) / (192.0 * 192.0), 0, 1)
    sims = np.array([m.cosine for m in group], np.float64)[inliers]
    margins = np.array([m.margin for m in group], np.float64)[inliers]
    weights = np.array([m.weight for m in group], np.float64)[inliers]
    inlier_ratio = n / len(group)
    med_err = float(np.median(errs)); mean_err = float(np.mean(errs))
    mean_sim = float(np.mean(sims)); mean_margin = float(np.mean(margins))
    count_score = clamp((n - 2) / 10.0, 0, 1)
    inlier_score = clamp((inlier_ratio - .12) / .55, 0, 1)
    reproj_score = math.exp(-med_err / 7.0)
    coverage_score = clamp(coverage / .28, 0, 1)
    similarity_score = clamp((mean_sim - .72) / .23, 0, 1)
    generator = clamp(.30 * count_score + .18 * inlier_score + .20 * reproj_score + .14 * coverage_score + .18 * similarity_score, 0, 1)
    return Candidate(
        rank=0, method="xfeat", queryName=query_name, queryVariant=qvar, atlasVariant=avar,
        queryScale=qscale, queryRotation=qrot, x=x, y=y, radius=96.0 * scale, scale=scale, angle=angle,
        inlierCount=n, clusterVoteCount=len(group), inlierRatio=inlier_ratio,
        medianReprojectionError=med_err, meanReprojectionError=mean_err, queryCoverage=coverage,
        medianDescriptorRatio=float(1.0 - np.median(sims)), meanCosineSimilarity=mean_sim,
        meanCosineMargin=mean_margin, voteWeight=float(weights.sum()), generatorScore=generator,
        source="xfeat-global-descriptor-regional-ransac",
    )


def dedupe(candidates: list[Candidate], limit: int) -> list[Candidate]:
    out = []
    for c in sorted(candidates, key=lambda z: (z.generatorScore, z.inlierCount, z.meanCosineSimilarity, z.queryCoverage), reverse=True):
        same = False
        for p in out:
            if math.hypot(c.x - p.x, c.y - p.y) < 100 and angle_delta(c.angle, p.angle) < 24 and abs(math.log(c.scale / p.scale)) < .22:
                same = True
                break
        if not same:
            out.append(c)
        if len(out) >= limit:
            break
    for i, c in enumerate(out, 1):
        c.rank = i
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", type=Path, default=Path("replay-site"))
    ap.add_argument("--xfeat-repo", type=Path, required=True)
    ap.add_argument("--observation", action="append", required=True)
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--top-k", type=int, default=32)
    args = ap.parse_args()

    sys.path.insert(0, str(args.xfeat_repo.resolve()))
    from modules.xfeat import XFeat  # type: ignore

    torch.set_num_threads(max(1, min(8, torch.get_num_threads())))
    model = XFeat(top_k=1536, detection_threshold=.02)
    model.eval()

    atlas_gray, atlas_meta = build_atlas(args.site / "dashen-cache" / "main" / "5")
    atlas_vars = variants(atlas_gray)
    bank_meta = {}
    banks = {}
    for name in ["clahe", "gradient"]:
        kp, desc, score, meta = build_feature_bank(model, atlas_vars[name], atlas_meta,
                                                    patch_size=768, stride=640, top_k=768, threshold=.02)
        if not len(desc):
            raise RuntimeError(f"XFeat atlas bank empty for {name}")
        banks[name] = (kp, desc, score, build_flann(desc))
        bank_meta[name] = meta

    diagnostics = []
    raw_candidates: list[Candidate] = []
    rotations = [0.0, 90.0, 180.0, 270.0]
    query_scale = 2.0
    for obs in args.observation:
        p = Path(obs)
        gray = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            raise RuntimeError(f"cannot read observation {p}")
        if gray.shape != (192, 192):
            gray = cv2.resize(gray, (192, 192), interpolation=cv2.INTER_AREA)
        qvars = variants(gray)
        for vname in ["clahe", "gradient"]:
            akp, adesc, ascore, matcher = banks[vname]
            for rot in rotations:
                run, inv = transform_query(qvars[vname], rot, query_scale)
                qkp_run, qdesc, qscore = extract(model, run, top_k=1536, threshold=.015)
                qkp = query_points_to_original(qkp_run, inv, query_scale)
                matches = global_matches(qkp, qdesc, qscore, akp, adesc, ascore, matcher,
                                         min_cos=.72, min_margin=.012)
                groups = regional_groups(matches, cell=448)
                produced = 0
                for group in groups[:120]:
                    cand = candidate_from_group(group, p.name, vname, vname, query_scale, rot, atlas_meta)
                    if cand is not None:
                        raw_candidates.append(cand); produced += 1
                diagnostics.append({
                    "query": p.name, "queryVariant": vname, "atlasVariant": vname,
                    "queryRotation": rot, "queryScale": query_scale,
                    "queryKeypoints": int(len(qkp)), "atlasKeypoints": int(len(akp)),
                    "acceptedMatches": int(len(matches)), "regionalGroups": int(len(groups)),
                    "ransacCandidates": int(produced),
                })

    top = dedupe(raw_candidates, max(12, min(64, args.top_k)))
    report = {
        "schema": "wwmsync-real-gfn-xfeat-hypotheses-v1",
        "scope": {"replayOnly": True, "productRuntimeChanged": False, "productionGateLowered": False,
                  "knownFalseCandidateOptimized": False, "goal": "learned local correspondence candidate recall"},
        "xfeat": {"sourceRepo": "verlab/accelerated_features", "sourceCommit": "e92685f57f8318b18725c5c8c0bd28c7fe188d9a",
                  "featureType": "sparse-64d-l2-normalized"},
        "atlas": atlas_meta, "atlasBanks": bank_meta,
        "observations": list(args.observation), "methods": ["xfeat"],
        "representationPairs": [{"query": "clahe", "atlas": "clahe"}, {"query": "gradient", "atlas": "gradient"}],
        "queryRotations": rotations, "queryScale": query_scale,
        "diagnostics": diagnostics, "candidateCountBeforeDedupe": len(raw_candidates),
        "candidates": [asdict(c) for c in top],
        "candidateGenerationVerdict": "CANDIDATES-SURFACED" if top else "NO-CANDIDATES",
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "report": str(args.report), "device": str(model.dev), "candidateCountBeforeDedupe": len(raw_candidates),
        "candidateCount": len(top), "atlasBanks": {k: {kk: vv for kk, vv in v.items() if kk != "patches"} for k, v in bank_meta.items()},
        "top": [asdict(c) for c in top[:12]],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
