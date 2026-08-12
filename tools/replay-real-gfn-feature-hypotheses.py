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
QUERY_CENTER = np.array([96.0, 96.0], dtype=np.float32)


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def angle_delta(a: float, b: float) -> float:
    return abs(((a - b + 540.0) % 360.0) - 180.0)


def norm_angle(a: float) -> float:
    return a % 360.0


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


def edge_repr(gray: np.ndarray) -> np.ndarray:
    g = robust_norm(gray)
    return cv2.GaussianBlur(cv2.Canny(g, 40, 110), (3, 3), 0)


def image_variants(gray: np.ndarray) -> dict[str, np.ndarray]:
    return {
        "clahe": robust_norm(gray),
        "gradient": gradient_repr(gray),
        "edge": edge_repr(gray),
    }


@dataclass
class Vote:
    method: str
    query_name: str
    query_variant: str
    atlas_variant: str
    query_scale: float
    qx: float
    qy: float
    ax: float
    ay: float
    center_x: float
    center_y: float
    scale: float
    angle: float
    distance: float
    second_distance: float
    ratio: float
    weight: float


@dataclass
class Candidate:
    rank: int
    method: str
    queryName: str
    queryVariant: str
    atlasVariant: str
    queryScale: float
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
    voteWeight: float
    generatorScore: float
    source: str


def build_atlas(tile_dir: Path) -> tuple[np.ndarray, dict]:
    records = []
    for p in tile_dir.glob("*.png"):
        m = TILE_RE.match(p.name)
        if not m:
            continue
        x, y = int(m.group(1)), int(m.group(2))
        records.append((x, y, p))
    if not records:
        raise RuntimeError(f"no z5 atlas tiles in {tile_dir}")
    xs = [r[0] for r in records]
    ys = [r[1] for r in records]
    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
    sample = cv2.imread(str(records[0][2]), cv2.IMREAD_GRAYSCALE)
    if sample is None:
        raise RuntimeError(f"cannot read atlas tile {records[0][2]}")
    tile_h, tile_w = sample.shape[:2]
    atlas = np.zeros(((max_y - min_y + 1) * tile_h, (max_x - min_x + 1) * tile_w), dtype=np.uint8)
    for x, y, p in records:
        img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if img is None:
            raise RuntimeError(f"cannot read atlas tile {p}")
        oy, ox = (y - min_y) * tile_h, (x - min_x) * tile_w
        atlas[oy:oy + tile_h, ox:ox + tile_w] = img
    meta = {
        "tileDir": str(tile_dir),
        "tileCount": len(records),
        "tileWidth": tile_w,
        "tileHeight": tile_h,
        "minTileX": min_x,
        "maxTileX": max_x,
        "minTileY": min_y,
        "maxTileY": max_y,
        "globalOriginX": min_x * tile_w,
        "globalOriginY": min_y * tile_h,
        "width": atlas.shape[1],
        "height": atlas.shape[0],
    }
    return atlas, meta


def create_detector(method: str):
    if method == "sift":
        return cv2.SIFT_create(nfeatures=70000, contrastThreshold=0.012, edgeThreshold=14, sigma=1.2), cv2.NORM_L2, 0.80
    if method == "orb":
        return cv2.ORB_create(nfeatures=90000, scaleFactor=1.15, nlevels=12, edgeThreshold=19, patchSize=31, fastThreshold=7), cv2.NORM_HAMMING, 0.86
    raise ValueError(method)


def detect(detector, image: np.ndarray):
    kps, desc = detector.detectAndCompute(image, None)
    return list(kps or []), desc


def greedy_clusters(votes: list[Vote]) -> list[list[Vote]]:
    clusters: list[list[Vote]] = []
    centers: list[tuple[float, float, float, float]] = []
    for v in sorted(votes, key=lambda x: x.weight, reverse=True):
        best = None
        best_cost = 1e9
        for i, (cx, cy, ls, ang) in enumerate(centers):
            dxy = math.hypot(v.center_x - cx, v.center_y - cy)
            dlog = abs(math.log(max(v.scale, 1e-6)) - ls)
            dang = angle_delta(v.angle, ang)
            if dxy <= 110 and dlog <= 0.34 and dang <= 30:
                cost = dxy / 110 + dlog / 0.34 + dang / 30
                if cost < best_cost:
                    best_cost, best = cost, i
        if best is None:
            clusters.append([v])
            centers.append((v.center_x, v.center_y, math.log(max(v.scale, 1e-6)), v.angle))
        else:
            c = clusters[best]
            c.append(v)
            w = np.array([max(x.weight, 1e-6) for x in c], dtype=np.float64)
            cx = float(np.average([x.center_x for x in c], weights=w))
            cy = float(np.average([x.center_y for x in c], weights=w))
            ls = float(np.average([math.log(max(x.scale, 1e-6)) for x in c], weights=w))
            rr = np.deg2rad([x.angle for x in c])
            s = float(np.average(np.sin(rr), weights=w))
            co = float(np.average(np.cos(rr), weights=w))
            ang = norm_angle(math.degrees(math.atan2(s, co)))
            centers[best] = (cx, cy, ls, ang)
    return clusters


def affine_candidate(cluster: list[Vote], atlas_meta: dict) -> Candidate | None:
    if len(cluster) < 3:
        return None
    q = np.float32([[v.qx, v.qy] for v in cluster]).reshape(-1, 1, 2)
    a = np.float32([[v.ax - atlas_meta["globalOriginX"], v.ay - atlas_meta["globalOriginY"]] for v in cluster]).reshape(-1, 1, 2)
    M, mask = cv2.estimateAffinePartial2D(
        q,
        a,
        method=cv2.RANSAC,
        ransacReprojThreshold=11.0,
        maxIters=5000,
        confidence=0.997,
        refineIters=25,
    )
    if M is None or mask is None:
        return None
    inliers = mask.ravel().astype(bool)
    n = int(inliers.sum())
    if n < 3:
        return None
    aa, cc = float(M[0, 0]), float(M[1, 0])
    scale = math.hypot(aa, cc)
    if not (1.15 <= scale <= 6.75):
        return None
    angle = norm_angle(math.degrees(math.atan2(cc, aa)))
    center_local = M @ np.array([QUERY_CENTER[0], QUERY_CENTER[1], 1.0], dtype=np.float64)
    x = float(center_local[0] + atlas_meta["globalOriginX"])
    y = float(center_local[1] + atlas_meta["globalOriginY"])
    min_gx, max_gx = atlas_meta["globalOriginX"], atlas_meta["globalOriginX"] + atlas_meta["width"]
    min_gy, max_gy = atlas_meta["globalOriginY"], atlas_meta["globalOriginY"] + atlas_meta["height"]
    if x < min_gx - 128 or x > max_gx + 128 or y < min_gy - 128 or y > max_gy + 128:
        return None
    qp = q.reshape(-1, 2)
    ap = a.reshape(-1, 2)
    pred = cv2.transform(q, M).reshape(-1, 2)
    err = np.linalg.norm(pred - ap, axis=1)
    inerr = err[inliers]
    iq = qp[inliers]
    if len(iq) >= 2:
        bbox_w = float(iq[:, 0].max() - iq[:, 0].min())
        bbox_h = float(iq[:, 1].max() - iq[:, 1].min())
        coverage = clamp((bbox_w * bbox_h) / (192.0 * 192.0), 0.0, 1.0)
    else:
        coverage = 0.0
    ratios = np.array([v.ratio for v in cluster], dtype=np.float64)[inliers]
    weights = np.array([v.weight for v in cluster], dtype=np.float64)[inliers]
    inlier_ratio = n / len(cluster)
    med_err = float(np.median(inerr))
    mean_err = float(np.mean(inerr))
    med_ratio = float(np.median(ratios))
    vote_weight = float(np.sum(weights))
    count_score = clamp((n - 2) / 12.0, 0, 1)
    inlier_score = clamp((inlier_ratio - 0.30) / 0.65, 0, 1)
    reproj_score = math.exp(-med_err / 7.0)
    coverage_score = clamp(coverage / 0.32, 0, 1)
    descriptor_score = clamp((0.90 - med_ratio) / 0.28, 0, 1)
    generator = clamp(0.30 * count_score + 0.20 * inlier_score + 0.20 * reproj_score + 0.15 * coverage_score + 0.15 * descriptor_score, 0, 1)
    v0 = cluster[0]
    return Candidate(
        rank=0,
        method=v0.method,
        queryName=v0.query_name,
        queryVariant=v0.query_variant,
        atlasVariant=v0.atlas_variant,
        queryScale=v0.query_scale,
        x=x,
        y=y,
        radius=96.0 * scale,
        scale=scale,
        angle=angle,
        inlierCount=n,
        clusterVoteCount=len(cluster),
        inlierRatio=inlier_ratio,
        medianReprojectionError=med_err,
        meanReprojectionError=mean_err,
        queryCoverage=coverage,
        medianDescriptorRatio=med_ratio,
        voteWeight=vote_weight,
        generatorScore=generator,
        source="local-feature-hough-ransac",
    )


def dedupe(candidates: list[Candidate], limit: int) -> list[Candidate]:
    out: list[Candidate] = []
    for c in sorted(candidates, key=lambda x: (x.generatorScore, x.inlierCount, x.queryCoverage), reverse=True):
        duplicate = False
        for p in out:
            if math.hypot(c.x - p.x, c.y - p.y) < 95 and angle_delta(c.angle, p.angle) < 24 and abs(math.log(c.scale / p.scale)) < 0.22:
                duplicate = True
                break
        if not duplicate:
            out.append(c)
        if len(out) >= limit:
            break
    for i, c in enumerate(out, 1):
        c.rank = i
    return out


def match_votes(method: str, query_name: str, qvariant_name: str, avariant_name: str, qscale: float,
                qimg: np.ndarray, atlas_img: np.ndarray, atlas_meta: dict, atlas_cache: dict) -> tuple[list[Vote], dict]:
    detector, norm, ratio_gate = create_detector(method)
    cache_key = (method, avariant_name)
    if cache_key not in atlas_cache:
        akps, adesc = detect(detector, atlas_img)
        atlas_cache[cache_key] = (akps, adesc)
    else:
        akps, adesc = atlas_cache[cache_key]
    if qscale != 1:
        qrun = cv2.resize(qimg, None, fx=qscale, fy=qscale, interpolation=cv2.INTER_CUBIC)
    else:
        qrun = qimg
    qkps, qdesc = detect(detector, qrun)
    stats = {
        "method": method,
        "query": query_name,
        "queryVariant": qvariant_name,
        "atlasVariant": avariant_name,
        "queryScale": qscale,
        "queryKeypoints": len(qkps),
        "atlasKeypoints": len(akps),
        "ratioGate": ratio_gate,
        "knnMatches": 0,
        "acceptedVotes": 0,
    }
    if qdesc is None or adesc is None or len(qkps) < 3 or len(akps) < 3:
        return [], stats
    matcher = cv2.BFMatcher(normType=norm, crossCheck=False)
    knn = matcher.knnMatch(qdesc, adesc, k=2)
    stats["knnMatches"] = len(knn)
    votes: list[Vote] = []
    origin = np.array([atlas_meta["globalOriginX"], atlas_meta["globalOriginY"]], dtype=np.float64)
    for pair in knn:
        if len(pair) < 2:
            continue
        m, n = pair
        if n.distance <= 1e-9 or m.distance >= ratio_gate * n.distance:
            continue
        qkp, akp = qkps[m.queryIdx], akps[m.trainIdx]
        qxy = np.array(qkp.pt, dtype=np.float64) / qscale
        axy_local = np.array(akp.pt, dtype=np.float64)
        axy_global = axy_local + origin
        qsize = max(qkp.size / qscale, 1e-3)
        scale = float(akp.size / qsize)
        if not (1.15 <= scale <= 6.75):
            continue
        angle = norm_angle(float(akp.angle - qkp.angle))
        r = math.radians(angle)
        R = np.array([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]], dtype=np.float64)
        center = axy_global - scale * (R @ (qxy - QUERY_CENTER))
        min_gx, max_gx = atlas_meta["globalOriginX"], atlas_meta["globalOriginX"] + atlas_meta["width"]
        min_gy, max_gy = atlas_meta["globalOriginY"], atlas_meta["globalOriginY"] + atlas_meta["height"]
        if center[0] < min_gx - 160 or center[0] > max_gx + 160 or center[1] < min_gy - 160 or center[1] > max_gy + 160:
            continue
        ratio = float(m.distance / n.distance)
        weight = clamp((ratio_gate - ratio) / max(0.08, ratio_gate - 0.45), 0.03, 1.0)
        votes.append(Vote(
            method=method,
            query_name=query_name,
            query_variant=qvariant_name,
            atlas_variant=avariant_name,
            query_scale=qscale,
            qx=float(qxy[0]), qy=float(qxy[1]),
            ax=float(axy_global[0]), ay=float(axy_global[1]),
            center_x=float(center[0]), center_y=float(center[1]),
            scale=scale, angle=angle,
            distance=float(m.distance), second_distance=float(n.distance), ratio=ratio, weight=weight,
        ))
    stats["acceptedVotes"] = len(votes)
    return votes, stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", type=Path, default=Path("replay-site"))
    ap.add_argument("--observation", action="append", required=True, help="May be supplied multiple times")
    ap.add_argument("--report", type=Path, default=Path("replay-output/wwmsync-real-gfn-feature-hypotheses.json"))
    ap.add_argument("--top-k", type=int, default=24)
    args = ap.parse_args()

    atlas_gray, atlas_meta = build_atlas(args.site / "dashen-cache" / "main" / "5")
    atlas_variants = image_variants(atlas_gray)
    pairs = [
        ("clahe", "clahe"),
        ("gradient", "gradient"),
        ("edge", "edge"),
        ("gradient", "clahe"),
    ]
    methods = ["sift", "orb"]
    qscales = [1.0, 2.0]
    atlas_cache: dict = {}
    all_candidates: list[Candidate] = []
    diagnostics: list[dict] = []

    for obs in args.observation:
        p = Path(obs)
        gray = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            raise RuntimeError(f"cannot read observation {p}")
        if gray.shape != (192, 192):
            gray = cv2.resize(gray, (192, 192), interpolation=cv2.INTER_AREA)
        qvars = image_variants(gray)
        for method in methods:
            for qvar, avar in pairs:
                for qs in qscales:
                    votes, stat = match_votes(method, p.name, qvar, avar, qs, qvars[qvar], atlas_variants[avar], atlas_meta, atlas_cache)
                    clusters = greedy_clusters(votes)
                    stat["clusters"] = len(clusters)
                    produced = 0
                    for cluster in sorted(clusters, key=lambda c: (len(c), sum(v.weight for v in c)), reverse=True)[:80]:
                        cand = affine_candidate(cluster, atlas_meta)
                        if cand is None:
                            continue
                        all_candidates.append(cand)
                        produced += 1
                    stat["ransacCandidates"] = produced
                    diagnostics.append(stat)

    top = dedupe(all_candidates, max(8, min(64, args.top_k)))
    report = {
        "schema": "wwmsync-real-gfn-local-feature-hypotheses-v1",
        "scope": {
            "replayOnly": True,
            "productRuntimeChanged": False,
            "productionGateLowered": False,
            "knownFalseCandidateOptimized": False,
            "goal": "candidate recall via rotation/scale-invariant local correspondences",
        },
        "atlas": atlas_meta,
        "observations": list(args.observation),
        "methods": methods,
        "queryScales": qscales,
        "representationPairs": [{"query": q, "atlas": a} for q, a in pairs],
        "diagnostics": diagnostics,
        "candidateCountBeforeDedupe": len(all_candidates),
        "candidates": [asdict(c) for c in top],
        "candidateGenerationVerdict": "CANDIDATES-SURFACED" if top else "NO-CANDIDATES",
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "report": str(args.report),
        "atlas": atlas_meta,
        "candidateCountBeforeDedupe": len(all_candidates),
        "candidateCount": len(top),
        "top": [asdict(c) for c in top[:8]],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
