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
    out = list(range(0, length - patch + 1, stride))
    last = length - patch
    if out[-1] != last:
        out.append(last)
    return out


def build_atlas(tile_dir: Path) -> tuple[np.ndarray, dict]:
    records: list[tuple[int, int, Path]] = []
    for p in tile_dir.glob("*.png"):
        m = TILE_RE.match(p.name)
        if m:
            records.append((int(m.group(1)), int(m.group(2)), p))
    if not records:
        raise RuntimeError(f"no atlas tiles in {tile_dir}")
    xs = [r[0] for r in records]
    ys = [r[1] for r in records]
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


def transform_query(gray: np.ndarray, rotation_deg: float, resize_scale: float) -> tuple[np.ndarray, np.ndarray]:
    h, w = gray.shape[:2]
    center = ((w - 1) / 2.0, (h - 1) / 2.0)
    M = cv2.getRotationMatrix2D(center, rotation_deg, 1.0)
    rot = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    run = cv2.resize(rot, None, fx=resize_scale, fy=resize_scale, interpolation=cv2.INTER_CUBIC)
    return run, cv2.invertAffineTransform(M)


def query_to_original(points: np.ndarray, inv_rot: np.ndarray, resize_scale: float) -> np.ndarray:
    if not len(points):
        return points.astype(np.float32)
    p = points.astype(np.float64) / resize_scale
    hom = np.concatenate([p, np.ones((len(p), 1), np.float64)], axis=1)
    return (hom @ inv_rot.T).astype(np.float32)


def dense_extract(model, gray: np.ndarray, top_k: int) -> dict:
    with torch.inference_mode():
        return model.detectAndComputeDense(tensor_image(gray, model.dev), top_k=top_k, multiscale=True)


def star_match(model, qout: dict, aout: dict) -> tuple[np.ndarray, np.ndarray, int]:
    with torch.inference_mode():
        idxs = model.batch_match(qout["descriptors"], aout["descriptors"])
        coarse_count = int(len(idxs[0][0]))
        if coarse_count == 0:
            return np.empty((0, 2), np.float32), np.empty((0, 2), np.float32), 0
        refined = model.refine_matches(qout, aout, matches=idxs, batch_idx=0)
    arr = refined.detach().cpu().numpy().astype(np.float32)
    if arr.ndim != 2 or arr.shape[1] != 4:
        return np.empty((0, 2), np.float32), np.empty((0, 2), np.float32), coarse_count
    return arr[:, :2], arr[:, 2:], coarse_count


@dataclass
class Candidate:
    rank: int
    method: str
    queryName: str
    queryVariant: str
    atlasVariant: str
    queryScale: float
    queryRotation: float
    atlasWindowX: int
    atlasWindowY: int
    atlasWindowSize: int
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


def make_candidate(qpts: np.ndarray, apts: np.ndarray, coarse_count: int,
                   query_name: str, variant: str, qscale: float, qrot: float,
                   wx: int, wy: int, patch_size: int, atlas_meta: dict) -> Candidate | None:
    if len(qpts) < 4 or len(apts) < 4:
        return None
    q = qpts.reshape(-1, 1, 2).astype(np.float32)
    a = apts.reshape(-1, 1, 2).astype(np.float32)
    M, mask = cv2.estimateAffinePartial2D(
        q, a, method=cv2.RANSAC, ransacReprojThreshold=10.0,
        maxIters=10000, confidence=.999, refineIters=40,
    )
    if M is None or mask is None:
        return None
    inliers = mask.ravel().astype(bool)
    n = int(inliers.sum())
    if n < 4:
        return None
    aa, cc = float(M[0, 0]), float(M[1, 0])
    scale = math.hypot(aa, cc)
    if not (1.10 <= scale <= 6.75):
        return None
    angle = norm_angle(math.degrees(math.atan2(cc, aa)))
    center = M @ np.array([QUERY_CENTER[0], QUERY_CENTER[1], 1.0], np.float64)
    x, y = float(center[0]), float(center[1])
    min_x = atlas_meta["globalOriginX"] - 128
    max_x = atlas_meta["globalOriginX"] + atlas_meta["width"] + 128
    min_y = atlas_meta["globalOriginY"] - 128
    max_y = atlas_meta["globalOriginY"] + atlas_meta["height"] + 128
    if not (min_x <= x <= max_x and min_y <= y <= max_y):
        return None

    qp = q.reshape(-1, 2)
    ap = a.reshape(-1, 2)
    pred = cv2.transform(q, M).reshape(-1, 2)
    errs = np.linalg.norm(pred - ap, axis=1)[inliers]
    iq = qp[inliers]
    bbox_w = float(iq[:, 0].max() - iq[:, 0].min()) if len(iq) > 1 else 0.0
    bbox_h = float(iq[:, 1].max() - iq[:, 1].min()) if len(iq) > 1 else 0.0
    coverage = clamp((bbox_w * bbox_h) / (192.0 * 192.0), 0, 1)
    inlier_ratio = n / max(1, len(qpts))
    med_err = float(np.median(errs))
    mean_err = float(np.mean(errs))

    count_score = clamp((n - 3) / 18.0, 0, 1)
    ratio_score = clamp((inlier_ratio - .18) / .62, 0, 1)
    reproj_score = math.exp(-med_err / 6.0)
    coverage_score = clamp(coverage / .34, 0, 1)
    generator = clamp(.34 * count_score + .23 * ratio_score + .23 * reproj_score + .20 * coverage_score, 0, 1)
    return Candidate(
        rank=0, method="xfeat-star", queryName=query_name, queryVariant=variant, atlasVariant=variant,
        queryScale=qscale, queryRotation=qrot,
        atlasWindowX=wx, atlasWindowY=wy, atlasWindowSize=patch_size,
        x=x, y=y, radius=96.0 * scale, scale=scale, angle=angle,
        inlierCount=n, clusterVoteCount=len(qpts), inlierRatio=inlier_ratio,
        medianReprojectionError=med_err, meanReprojectionError=mean_err, queryCoverage=coverage,
        medianDescriptorRatio=0.0, meanCosineSimilarity=0.0, meanCosineMargin=0.0,
        voteWeight=float(coarse_count), generatorScore=generator,
        source="xfeat-star-semidense-window-ransac",
    )


def dedupe(candidates: list[Candidate], limit: int) -> list[Candidate]:
    out: list[Candidate] = []
    ordered = sorted(
        candidates,
        key=lambda c: (c.generatorScore, c.inlierCount, c.queryCoverage, c.inlierRatio),
        reverse=True,
    )
    for c in ordered:
        duplicate = False
        for p in out:
            if (math.hypot(c.x - p.x, c.y - p.y) < 100
                    and angle_delta(c.angle, p.angle) < 24
                    and abs(math.log(c.scale / p.scale)) < .22):
                duplicate = True
                break
        if not duplicate:
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
    ap.add_argument("--top-k", type=int, default=48)
    ap.add_argument("--dense-top-k", type=int, default=384)
    args = ap.parse_args()

    sys.path.insert(0, str(args.xfeat_repo.resolve()))
    from modules.xfeat import XFeat  # type: ignore

    torch.set_num_threads(max(1, min(8, torch.get_num_threads())))
    model = XFeat(top_k=max(512, args.dense_top_k), detection_threshold=.02)
    model.eval()

    atlas_gray, atlas_meta = build_atlas(args.site / "dashen-cache" / "main" / "5")
    atlas_vars = variants(atlas_gray)
    patch_size = 1024
    stride = 768
    x_positions = positions(atlas_gray.shape[1], patch_size, stride)
    y_positions = positions(atlas_gray.shape[0], patch_size, stride)

    # Cache the expensive CNN output once per atlas window/representation.
    atlas_cache: dict[tuple[str, int, int], dict] = {}
    window_records: list[dict] = []
    for variant_name in ("clahe", "gradient"):
        image = atlas_vars[variant_name]
        for wy in y_positions:
            for wx in x_positions:
                patch = image[wy:wy + patch_size, wx:wx + patch_size]
                out = dense_extract(model, patch, args.dense_top_k)
                atlas_cache[(variant_name, wx, wy)] = out
                window_records.append({
                    "variant": variant_name, "x": wx, "y": wy,
                    "featureCount": int(out["descriptors"].shape[1]),
                })

    query_rotations = [0.0, 90.0, 180.0, 270.0]
    query_scales = [1.5, 2.5, 3.75]
    raw_candidates: list[Candidate] = []
    diagnostics: list[dict] = []

    for obs in args.observation:
        p = Path(obs)
        gray = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            raise RuntimeError(f"cannot read observation {p}")
        if gray.shape != (192, 192):
            gray = cv2.resize(gray, (192, 192), interpolation=cv2.INTER_AREA)
        qvars = variants(gray)
        for variant_name in ("clahe", "gradient"):
            for qrot in query_rotations:
                for qscale in query_scales:
                    qrun, inv_rot = transform_query(qvars[variant_name], qrot, qscale)
                    qout = dense_extract(model, qrun, args.dense_top_k)
                    total_refined = 0
                    total_coarse = 0
                    produced = 0
                    best_inliers = 0
                    for wy in y_positions:
                        for wx in x_positions:
                            aout = atlas_cache[(variant_name, wx, wy)]
                            qrun_pts, apatch_pts, coarse_count = star_match(model, qout, aout)
                            total_coarse += coarse_count
                            total_refined += len(qrun_pts)
                            if len(qrun_pts) < 4:
                                continue
                            qorig = query_to_original(qrun_pts, inv_rot, qscale)
                            aglobal = apatch_pts.copy()
                            aglobal[:, 0] += wx + atlas_meta["globalOriginX"]
                            aglobal[:, 1] += wy + atlas_meta["globalOriginY"]
                            cand = make_candidate(
                                qorig, aglobal, coarse_count, p.name, variant_name,
                                qscale, qrot, wx, wy, patch_size, atlas_meta,
                            )
                            if cand is not None:
                                raw_candidates.append(cand)
                                produced += 1
                                best_inliers = max(best_inliers, cand.inlierCount)
                    diagnostics.append({
                        "query": p.name, "variant": variant_name,
                        "queryRotation": qrot, "queryScale": qscale,
                        "queryDenseFeatures": int(qout["descriptors"].shape[1]),
                        "windowsEvaluated": len(x_positions) * len(y_positions),
                        "coarseMutualMatches": total_coarse,
                        "fineRefinedMatches": total_refined,
                        "ransacCandidates": produced,
                        "bestInlierCount": best_inliers,
                    })

    top = dedupe(raw_candidates, max(16, min(64, args.top_k)))
    report = {
        "schema": "wwmsync-real-gfn-xfeat-star-hypotheses-v1",
        "scope": {
            "replayOnly": True, "productRuntimeChanged": False,
            "productionGateLowered": False, "knownFalseCandidateOptimized": False,
            "goal": "semi-dense context-aware learned correspondence candidate recall",
        },
        "xfeatStar": {
            "sourceRepo": "verlab/accelerated_features",
            "sourceCommit": "e92685f57f8318b18725c5c8c0bd28c7fe188d9a",
            "mode": "detectAndComputeDense+batch_match+refine_matches",
            "denseTopK": args.dense_top_k,
            "multiscale": True,
            "fineSubpixelRefinement": True,
        },
        "atlas": atlas_meta,
        "atlasWindows": {
            "patchSize": patch_size, "stride": stride,
            "xPositions": x_positions, "yPositions": y_positions,
            "windowCountPerVariant": len(x_positions) * len(y_positions),
            "records": window_records,
        },
        "observations": list(args.observation),
        "methods": ["xfeat-star"],
        "representationPairs": [
            {"query": "clahe", "atlas": "clahe"},
            {"query": "gradient", "atlas": "gradient"},
        ],
        "queryRotations": query_rotations,
        "queryScales": query_scales,
        "diagnostics": diagnostics,
        "candidateCountBeforeDedupe": len(raw_candidates),
        "candidates": [asdict(c) for c in top],
        "candidateGenerationVerdict": "CANDIDATES-SURFACED" if top else "NO-CANDIDATES",
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "report": str(args.report), "device": str(model.dev),
        "denseTopK": args.dense_top_k,
        "windowCountPerVariant": len(x_positions) * len(y_positions),
        "candidateCountBeforeDedupe": len(raw_candidates),
        "candidateCount": len(top),
        "top": [asdict(c) for c in top[:16]],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
