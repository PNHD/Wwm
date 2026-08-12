#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import asdict
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from sklearn.cluster import MiniBatchKMeans

DINO_COMMIT = "7764ea0f912e53c92e82eb78a2a1631e92725fc8"
XFEAT_COMMIT = "e92685f57f8318b18725c5c8c0bd28c7fe188d9a"
DINO_INPUT = 224
DINO_MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
DINO_STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def angle_delta(a: float, b: float) -> float:
    return abs(((a - b + 540.0) % 360.0) - 180.0)


def circular_mean_deg(values: list[float], weights: list[float] | None = None) -> float:
    if not values:
        return 0.0
    r = np.deg2rad(np.asarray(values, np.float64))
    w = np.ones(len(values), np.float64) if weights is None else np.asarray(weights, np.float64)
    s = float(np.sum(np.sin(r) * w))
    c = float(np.sum(np.cos(r) * w))
    return math.degrees(math.atan2(s, c)) % 360.0


def positions(length: int, patch: int, stride: int) -> list[int]:
    if length <= patch:
        return [0]
    vals = list(range(0, length - patch + 1, stride))
    last = length - patch
    if vals[-1] != last:
        vals.append(last)
    return vals


def load_xfeat_star_module(repo_root: Path):
    source = repo_root / "tools" / "replay-real-gfn-xfeat-star-hypotheses.py"
    spec = importlib.util.spec_from_file_location("wwmsync_xfeat_star", source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {source}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def central_context(gray: np.ndarray, crop: int = 160) -> np.ndarray:
    if gray.shape != (192, 192):
        gray = cv2.resize(gray, (192, 192), interpolation=cv2.INTER_AREA)
    off = (192 - crop) // 2
    img = gray[off:off + crop, off:off + crop].copy()
    # Remove the persistent player/center overlay from the learned context descriptor.
    mask = np.zeros_like(img, np.uint8)
    cv2.circle(mask, (crop // 2, crop // 2), 18, 255, -1)
    img = cv2.inpaint(img, mask, 5, cv2.INPAINT_TELEA)
    return img


def rotate_square(gray: np.ndarray, angle: float) -> np.ndarray:
    h, w = gray.shape[:2]
    M = cv2.getRotationMatrix2D(((w - 1) / 2.0, (h - 1) / 2.0), angle, 1.0)
    return cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)


def dino_batch(images: list[np.ndarray], device: torch.device) -> torch.Tensor:
    arr = []
    for img in images:
        if img.ndim == 2:
            rgb = np.repeat(img[..., None], 3, axis=2)
        else:
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        rgb = cv2.resize(rgb, (DINO_INPUT, DINO_INPUT), interpolation=cv2.INTER_AREA)
        arr.append(torch.from_numpy(rgb).permute(2, 0, 1).float() / 255.0)
    t = torch.stack(arr, dim=0)
    mean = DINO_MEAN.to(t.device)
    std = DINO_STD.to(t.device)
    return ((t - mean) / std).to(device)


def extract_patch_tokens(model, images: list[np.ndarray], device: torch.device, batch_size: int = 12) -> np.ndarray:
    out = []
    with torch.inference_mode():
        for i in range(0, len(images), batch_size):
            t = dino_batch(images[i:i + batch_size], device)
            feat = model.forward_features(t)["x_norm_patchtokens"]
            feat = F.normalize(feat, dim=-1)
            out.append(feat.cpu().numpy().astype(np.float16))
    return np.concatenate(out, axis=0) if out else np.empty((0, 256, 384), np.float16)


def fit_vlad_centers(tokens: np.ndarray, clusters: int, seed: int = 2304) -> np.ndarray:
    if tokens.ndim != 3 or len(tokens) == 0:
        raise RuntimeError("empty DINO token bank")
    flat = tokens.reshape(-1, tokens.shape[-1]).astype(np.float32)
    # Deterministic broad sampling across every atlas window.
    max_samples = min(48000, len(flat))
    if len(flat) > max_samples:
        idx = np.linspace(0, len(flat) - 1, max_samples, dtype=np.int64)
        flat = flat[idx]
    km = MiniBatchKMeans(
        n_clusters=clusters,
        random_state=seed,
        batch_size=4096,
        n_init=1,
        max_iter=120,
        reassignment_ratio=0.01,
    )
    km.fit(flat)
    centers = km.cluster_centers_.astype(np.float32)
    centers /= np.maximum(np.linalg.norm(centers, axis=1, keepdims=True), 1e-8)
    return centers


def make_vlads(tokens: np.ndarray, centers: np.ndarray, batch_size: int = 32) -> np.ndarray:
    device = torch.device("cpu")
    ct = torch.from_numpy(centers).float().to(device)
    all_vlads = []
    for i in range(0, len(tokens), batch_size):
        x = torch.from_numpy(tokens[i:i + batch_size].astype(np.float32)).to(device)
        x = F.normalize(x, dim=-1)
        sims = torch.einsum("bnd,kd->bnk", x, ct)
        labels = sims.argmax(dim=-1)
        residual = x[:, :, None, :] - ct[None, None, :, :]
        one_hot = F.one_hot(labels, num_classes=ct.shape[0]).float().unsqueeze(-1)
        v = (residual * one_hot).sum(dim=1)
        v = F.normalize(v, dim=-1)
        v = F.normalize(v.reshape(v.shape[0], -1), dim=-1)
        all_vlads.append(v.numpy().astype(np.float32))
    return np.concatenate(all_vlads, axis=0)


def representation(gray: np.ndarray, name: str, star) -> np.ndarray:
    if name == "clahe":
        return star.robust_norm(gray)
    if name == "gradient":
        return star.gradient_repr(gray)
    raise ValueError(name)


def build_dino_bank(atlas_gray: np.ndarray, star, model, device: torch.device,
                    variant: str, sizes: list[int], stride_fraction: float,
                    clusters: int) -> tuple[list[dict], np.ndarray, np.ndarray, dict]:
    rep = representation(atlas_gray, variant, star)
    records: list[dict] = []
    images: list[np.ndarray] = []
    for size in sizes:
        stride = max(96, int(round(size * stride_fraction)))
        for y in positions(rep.shape[0], size, stride):
            for x in positions(rep.shape[1], size, stride):
                images.append(rep[y:y + size, x:x + size])
                records.append({"x": x, "y": y, "size": size, "stride": stride, "variant": variant})
    tokens = extract_patch_tokens(model, images, device)
    centers = fit_vlad_centers(tokens, clusters=clusters, seed=2304 + (0 if variant == "clahe" else 17))
    vlads = make_vlads(tokens, centers)
    meta = {
        "variant": variant,
        "windowCount": len(records),
        "sizes": sizes,
        "strideFraction": stride_fraction,
        "clusters": clusters,
        "tokenShape": list(tokens.shape),
        "descriptorDim": int(vlads.shape[1]),
    }
    return records, vlads, centers, meta


def query_vlads(observation: np.ndarray, variant: str, star, model, device: torch.device,
                centers: np.ndarray, rotations: list[float]) -> tuple[np.ndarray, np.ndarray]:
    rep = representation(observation, variant, star)
    context = central_context(rep)
    imgs = [rotate_square(context, a) for a in rotations]
    tokens = extract_patch_tokens(model, imgs, device)
    return make_vlads(tokens, centers), tokens


def aggregate_retrieval(records: list[dict], atlas_vlads: np.ndarray,
                        query_sets: list[tuple[str, np.ndarray]], rotations: list[float],
                        top_per_query: int) -> list[dict]:
    per_source = []
    for source_name, qv in query_sets:
        sims = qv @ atlas_vlads.T
        best_rot_idx = sims.argmax(axis=0)
        best_sim = sims[best_rot_idx, np.arange(sims.shape[1])]
        order = np.argsort(-best_sim)
        top_mask = np.zeros(len(records), np.uint8)
        top_mask[order[:min(top_per_query, len(order))]] = 1
        per_source.append({"name": source_name, "bestSim": best_sim, "bestRot": best_rot_idx, "topMask": top_mask})

    raw_scores = []
    results = []
    for idx, rec in enumerate(records):
        sims = [float(s["bestSim"][idx]) for s in per_source]
        rots = [rotations[int(s["bestRot"][idx])] for s in per_source]
        support = int(sum(int(s["topMask"][idx]) for s in per_source))
        med = float(np.median(sims))
        avg = float(np.mean(sims))
        p25 = float(np.percentile(sims, 25))
        consistency = float(np.std(sims))
        angle = circular_mean_deg(rots, [max(0.01, x + 1.0) for x in sims])
        aggregate = 0.45 * avg + 0.35 * med + 0.20 * p25 - 0.05 * consistency
        raw_scores.append(aggregate)
        results.append({
            **rec,
            "retrievalScoreRaw": aggregate,
            "meanSimilarity": avg,
            "medianSimilarity": med,
            "p25Similarity": p25,
            "similarityStd": consistency,
            "sourceSupport": support,
            "sourceCount": len(per_source),
            "bestRotations": rots,
            "angle": angle,
        })

    scores = np.asarray(raw_scores, np.float64)
    p50 = float(np.percentile(scores, 50))
    p995 = float(np.percentile(scores, 99.5))
    denom = max(1e-6, p995 - p50)
    for r in results:
        r["retrievalScore"] = clamp((r["retrievalScoreRaw"] - p50) / denom, 0.0, 1.0)
    return sorted(results, key=lambda r: (r["sourceSupport"], r["retrievalScoreRaw"]), reverse=True)


def dedupe_windows(candidates: list[dict], limit: int) -> list[dict]:
    out: list[dict] = []
    for c in candidates:
        cx = c["x"] + c["size"] / 2
        cy = c["y"] + c["size"] / 2
        duplicate = False
        for p in out:
            px = p["x"] + p["size"] / 2
            py = p["y"] + p["size"] / 2
            near = math.hypot(cx - px, cy - py) < 0.32 * min(c["size"], p["size"])
            scale_near = abs(math.log(c["size"] / p["size"])) < 0.28
            if near and scale_near:
                duplicate = True
                break
        if not duplicate:
            out.append(c)
        if len(out) >= limit:
            break
    return out


def local_refine(dino_windows: list[dict], atlas_gray: np.ndarray, atlas_meta: dict,
                 observations: list[tuple[str, np.ndarray]], star, xfeat_model,
                 top_k: int) -> tuple[list[dict], list[dict]]:
    atlas_variants = star.variants(atlas_gray)
    raw: list[dict] = []
    diagnostics: list[dict] = []
    for dino_rank, dino in enumerate(dino_windows, 1):
        wx, wy, size = int(dino["x"]), int(dino["y"]), int(dino["size"])
        # Pad the DINO window enough for local affine refinement while staying bounded.
        pad = int(round(size * 0.18))
        x0 = max(0, wx - pad)
        y0 = max(0, wy - pad)
        x1 = min(atlas_gray.shape[1], wx + size + pad)
        y1 = min(atlas_gray.shape[0], wy + size + pad)
        base_angle = float(dino["angle"])
        refine_angles = sorted({(base_angle + da) % 360.0 for da in (-20, -10, 0, 10, 20)})
        window_produced = 0
        best_inliers = 0
        for variant in ("clahe", "gradient"):
            patch = atlas_variants[variant][y0:y1, x0:x1]
            aout = star.dense_extract(xfeat_model, patch, 512)
            for obs_name, obs_gray in observations:
                qbase = star.variants(obs_gray)[variant]
                for qrot in refine_angles:
                    for qscale in (1.5, 2.5, 3.75):
                        qrun, inv = star.transform_query(qbase, qrot, qscale)
                        qout = star.dense_extract(xfeat_model, qrun, 512)
                        qrun_pts, apatch_pts, coarse_count = star.star_match(xfeat_model, qout, aout)
                        if len(qrun_pts) < 4:
                            continue
                        qorig = star.query_to_original(qrun_pts, inv, qscale)
                        aglobal = apatch_pts.copy()
                        aglobal[:, 0] += x0 + atlas_meta["globalOriginX"]
                        aglobal[:, 1] += y0 + atlas_meta["globalOriginY"]
                        cand = star.make_candidate(
                            qorig, aglobal, coarse_count, obs_name, variant,
                            qscale, qrot, x0, y0, max(x1 - x0, y1 - y0), atlas_meta,
                        )
                        if cand is None:
                            continue
                        c = asdict(cand)
                        local = float(c["generatorScore"])
                        support_factor = dino["sourceSupport"] / max(1, dino["sourceCount"])
                        c["dinoRank"] = dino_rank
                        c["dinoRetrievalScore"] = float(dino["retrievalScore"])
                        c["dinoRetrievalScoreRaw"] = float(dino["retrievalScoreRaw"])
                        c["dinoSourceSupport"] = int(dino["sourceSupport"])
                        c["dinoSourceCount"] = int(dino["sourceCount"])
                        c["dinoWindow"] = {k: dino[k] for k in ("x", "y", "size", "variant", "angle")}
                        c["localGeneratorScore"] = local
                        c["generatorScore"] = clamp(0.52 * local + 0.38 * float(dino["retrievalScore"]) + 0.10 * support_factor, 0, 1)
                        c["source"] = "dinov2-anyloc-retrieval+xfeat-star-local-refine"
                        raw.append(c)
                        window_produced += 1
                        best_inliers = max(best_inliers, int(c["inlierCount"]))
        diagnostics.append({
            "dinoRank": dino_rank,
            "window": {k: dino[k] for k in ("x", "y", "size", "variant", "angle")},
            "retrievalScore": dino["retrievalScore"],
            "retrievalScoreRaw": dino["retrievalScoreRaw"],
            "sourceSupport": dino["sourceSupport"],
            "refinedCandidateCount": window_produced,
            "bestInlierCount": best_inliers,
        })

    ordered = sorted(
        raw,
        key=lambda c: (c["generatorScore"], c["dinoSourceSupport"], c["inlierCount"], c["queryCoverage"]),
        reverse=True,
    )
    out: list[dict] = []
    for c in ordered:
        duplicate = False
        for p in out:
            if (math.hypot(c["x"] - p["x"], c["y"] - p["y"]) < 92
                    and angle_delta(c["angle"], p["angle"]) < 20
                    and abs(math.log(c["scale"] / p["scale"])) < 0.20):
                duplicate = True
                break
        if not duplicate:
            out.append(c)
        if len(out) >= top_k:
            break
    for i, c in enumerate(out, 1):
        c["rank"] = i
    return out, diagnostics


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", type=Path, default=Path("replay-site"))
    ap.add_argument("--dinov2-repo", type=Path, required=True)
    ap.add_argument("--xfeat-repo", type=Path, required=True)
    ap.add_argument("--observation", action="append", required=True)
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--top-k", type=int, default=64)
    ap.add_argument("--dino-shortlist", type=int, default=18)
    args = ap.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    star = load_xfeat_star_module(repo_root)
    sys.path.insert(0, str(args.xfeat_repo.resolve()))
    from modules.xfeat import XFeat  # type: ignore

    torch.set_num_threads(max(1, min(8, torch.get_num_threads())))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dino = torch.hub.load(str(args.dinov2_repo.resolve()), "dinov2_vits14", source="local", pretrained=True)
    dino.eval().to(device)
    xfeat = XFeat(top_k=512, detection_threshold=.02)
    xfeat.eval()

    atlas_gray, atlas_meta = star.build_atlas(args.site / "dashen-cache" / "main" / "5")
    observations: list[tuple[str, np.ndarray]] = []
    for obs in args.observation:
        p = Path(obs)
        gray = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            raise RuntimeError(f"cannot read observation {p}")
        if gray.shape != (192, 192):
            gray = cv2.resize(gray, (192, 192), interpolation=cv2.INTER_AREA)
        observations.append((p.name, gray))

    sizes = [256, 384, 512, 768, 1024, 1280]
    rotations = [float(x) for x in range(0, 360, 30)]
    all_retrieval: list[dict] = []
    bank_meta: list[dict] = []
    for variant in ("clahe", "gradient"):
        records, atlas_vlads, centers, meta = build_dino_bank(
            atlas_gray, star, dino, device, variant, sizes,
            stride_fraction=.75, clusters=16,
        )
        query_sets = []
        for obs_name, obs_gray in observations:
            qv, _ = query_vlads(obs_gray, variant, star, dino, device, centers, rotations)
            query_sets.append((obs_name, qv))
        retrieval = aggregate_retrieval(records, atlas_vlads, query_sets, rotations, top_per_query=80)
        all_retrieval.extend(retrieval)
        bank_meta.append(meta)

    all_retrieval.sort(key=lambda r: (r["sourceSupport"], r["retrievalScoreRaw"]), reverse=True)
    dino_shortlist = dedupe_windows(all_retrieval, args.dino_shortlist)
    refined, refine_diag = local_refine(
        dino_shortlist, atlas_gray, atlas_meta, observations,
        star, xfeat, max(16, min(64, args.top_k)),
    )

    report = {
        "schema": "wwmsync-real-gfn-dinov2-anyloc-xfeat-hypotheses-v1",
        "scope": {
            "replayOnly": True,
            "productRuntimeChanged": False,
            "productionGateLowered": False,
            "knownFalseCandidateOptimized": False,
            "goal": "contextual place retrieval before precise local registration",
        },
        "dinov2": {
            "sourceRepo": "facebookresearch/dinov2",
            "sourceCommit": DINO_COMMIT,
            "model": "dinov2_vits14",
            "features": "x_norm_patchtokens",
        },
        "anylocStyle": {
            "aggregation": "hard-assignment VLAD over normalized DINOv2 patch tokens",
            "clusters": 16,
            "windowSizes": sizes,
            "strideFraction": .75,
            "queryRotationsDeg": rotations,
            "queryContextCrop": 160,
            "centerOverlayInpaintRadius": 18,
        },
        "xfeatRefinement": {
            "sourceRepo": "verlab/accelerated_features",
            "sourceCommit": XFEAT_COMMIT,
            "mode": "XFeat-star semi-dense local-only refinement inside DINO shortlist",
        },
        "atlas": atlas_meta,
        "observations": [name for name, _ in observations],
        "banks": bank_meta,
        "dinoShortlist": dino_shortlist,
        "dinoShortlistCount": len(dino_shortlist),
        "refinementDiagnostics": refine_diag,
        "candidateCountBeforeDedupe": int(sum(d["refinedCandidateCount"] for d in refine_diag)),
        "candidates": refined,
        "candidateGenerationVerdict": "CANDIDATES-SURFACED" if refined else "NO-CANDIDATES",
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "report": str(args.report),
        "device": str(device),
        "dinoShortlistCount": len(dino_shortlist),
        "refinedCandidateCount": len(refined),
        "topDino": [{k: r[k] for k in ("x", "y", "size", "variant", "angle", "sourceSupport", "sourceCount", "retrievalScore", "retrievalScoreRaw")} for r in dino_shortlist[:12]],
        "topRefined": [{k: c.get(k) for k in ("rank", "x", "y", "radius", "angle", "inlierCount", "queryCoverage", "localGeneratorScore", "dinoRetrievalScore", "generatorScore", "dinoRank")} for c in refined[:16]],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
