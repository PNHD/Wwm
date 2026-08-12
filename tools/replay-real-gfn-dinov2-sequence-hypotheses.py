#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
import torch


def load_module(name: str, source: Path):
    spec = importlib.util.spec_from_file_location(name, source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {source}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def frame_name(frame: dict) -> str | None:
    return frame.get("minimap") or frame.get("minimapFile") or frame.get("cropFile")


def load_fixture_frames(fixture_dir: Path, indexes: list[int]) -> list[tuple[str, np.ndarray]]:
    capture = json.loads((fixture_dir / "capture.json").read_text(encoding="utf-8-sig"))
    frames = capture.get("frames") or []
    if len(frames) != 40:
        raise RuntimeError(f"expected exact 40-frame fixture, got {len(frames)}")
    out: list[tuple[str, np.ndarray]] = []
    for idx in indexes:
        rec = frames[idx]
        name = frame_name(rec)
        if not name:
            raise RuntimeError(f"frame {idx + 1} has no minimap path")
        p = fixture_dir / name
        gray = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            raise RuntimeError(f"cannot read {p}")
        # Match the production-replay canvas semantics exactly: source top-left 216x216 -> 192x192.
        if gray.shape[0] >= 216 and gray.shape[1] >= 216:
            gray = gray[:216, :216]
        gray = cv2.resize(gray, (192, 192), interpolation=cv2.INTER_AREA)
        out.append((f"frame-{idx + 1:02d}:{name}", gray))
    return out


def circular_concentration(angles: list[float]) -> float:
    if not angles:
        return 0.0
    r = np.deg2rad(np.asarray(angles, np.float64))
    return float(math.hypot(float(np.mean(np.cos(r))), float(np.mean(np.sin(r)))))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", type=Path, default=Path("replay-site"))
    ap.add_argument("--fixture", type=Path, required=True)
    ap.add_argument("--dinov2-repo", type=Path, required=True)
    ap.add_argument("--xfeat-repo", type=Path, required=True)
    ap.add_argument("--temporal-observation", action="append", required=True)
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--top-k", type=int, default=64)
    ap.add_argument("--dino-shortlist", type=int, default=20)
    args = ap.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    dino_mod = load_module(
        "wwmsync_dino_anyloc",
        repo_root / "tools" / "replay-real-gfn-dinov2-anyloc-hypotheses.py",
    )
    star = dino_mod.load_xfeat_star_module(repo_root)
    sys.path.insert(0, str(args.xfeat_repo.resolve()))
    from modules.xfeat import XFeat  # type: ignore

    torch.set_num_threads(max(1, min(8, torch.get_num_threads())))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dino = torch.hub.load(str(args.dinov2_repo.resolve()), "dinov2_vits14", source="local", pretrained=True)
    dino.eval().to(device)
    xfeat = XFeat(top_k=512, detection_threshold=.02)
    xfeat.eval()

    atlas_gray, atlas_meta = star.build_atlas(args.site / "dashen-cache" / "main" / "5")
    frame_indexes = [0, 4, 9, 14, 19, 24, 29, 39]
    raw_frames = load_fixture_frames(args.fixture, frame_indexes)

    temporal: list[tuple[str, np.ndarray]] = []
    for obs in args.temporal_observation:
        p = Path(obs)
        gray = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            raise RuntimeError(f"cannot read temporal observation {p}")
        if gray.shape != (192, 192):
            gray = cv2.resize(gray, (192, 192), interpolation=cv2.INTER_AREA)
        temporal.append((p.name, gray))

    sizes = [256, 384, 512, 768, 1024, 1280]
    rotations = [float(x) for x in range(0, 360, 30)]
    retrieval_all: list[dict] = []
    bank_meta: list[dict] = []
    for variant in ("clahe", "gradient"):
        records, atlas_vlads, centers, meta = dino_mod.build_dino_bank(
            atlas_gray, star, dino, device, variant, sizes,
            stride_fraction=.75, clusters=16,
        )
        query_sets = []
        for frame_label, frame_gray in raw_frames:
            qv, _ = dino_mod.query_vlads(frame_gray, variant, star, dino, device, centers, rotations)
            query_sets.append((frame_label, qv))
        retrieved = dino_mod.aggregate_retrieval(
            records, atlas_vlads, query_sets, rotations,
            top_per_query=60,
        )
        for r in retrieved:
            r["rotationConcentration"] = circular_concentration(r["bestRotations"])
            # Ranking primarily requires temporal positional recurrence; rotation concentration is only a weak tiebreaker.
            r["sequenceRetrievalScore"] = (
                0.72 * (r["sourceSupport"] / max(1, r["sourceCount"]))
                + 0.23 * r["retrievalScore"]
                + 0.05 * r["rotationConcentration"]
            )
        retrieval_all.extend(retrieved)
        bank_meta.append(meta)

    retrieval_all.sort(
        key=lambda r: (r["sequenceRetrievalScore"], r["sourceSupport"], r["retrievalScoreRaw"]),
        reverse=True,
    )
    shortlist = dino_mod.dedupe_windows(retrieval_all, args.dino_shortlist)

    # Preserve the raw-frame recurrence score while reusing the proven local XFeat-star registration stage.
    for r in shortlist:
        r["retrievalScore"] = dino_mod.clamp(
            0.65 * r["retrievalScore"]
            + 0.30 * (r["sourceSupport"] / max(1, r["sourceCount"]))
            + 0.05 * r["rotationConcentration"],
            0.0, 1.0,
        )

    refined, refine_diag = dino_mod.local_refine(
        shortlist, atlas_gray, atlas_meta, temporal,
        star, xfeat, max(16, min(64, args.top_k)),
    )

    report = {
        "schema": "wwmsync-real-gfn-dinov2-sequence-recurrence-xfeat-hypotheses-v1",
        "scope": {
            "replayOnly": True,
            "productRuntimeChanged": False,
            "productionGateLowered": False,
            "knownFalseCandidateOptimized": False,
            "goal": "independent raw-frame place recurrence before precise local registration",
        },
        "fixture": {
            "frameCount": 40,
            "retrievalFrameIndexes1Based": [i + 1 for i in frame_indexes],
            "retrievalFrameLabels": [name for name, _ in raw_frames],
        },
        "dinov2": {
            "sourceRepo": "facebookresearch/dinov2",
            "sourceCommit": dino_mod.DINO_COMMIT,
            "model": "dinov2_vits14",
            "features": "x_norm_patchtokens",
        },
        "sequenceRetrieval": {
            "aggregation": "AnyLoc-style VLAD per raw frame; same atlas window must recur across independent times",
            "frameSources": len(raw_frames),
            "clusters": 16,
            "windowSizes": sizes,
            "strideFraction": .75,
            "queryRotationsDeg": rotations,
            "topPerFrame": 60,
        },
        "xfeatRefinement": {
            "sourceRepo": "verlab/accelerated_features",
            "sourceCommit": dino_mod.XFEAT_COMMIT,
            "mode": "XFeat-star local-only refinement inside temporally recurrent DINO windows",
        },
        "atlas": atlas_meta,
        "banks": bank_meta,
        "temporalRefinementObservations": [name for name, _ in temporal],
        "dinoShortlist": shortlist,
        "dinoShortlistCount": len(shortlist),
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
        "rawRetrievalFrameCount": len(raw_frames),
        "dinoShortlistCount": len(shortlist),
        "candidateCount": len(refined),
        "topDino": [{
            k: r.get(k) for k in (
                "x", "y", "size", "variant", "angle", "sourceSupport", "sourceCount",
                "retrievalScore", "retrievalScoreRaw", "rotationConcentration", "sequenceRetrievalScore",
            )
        } for r in shortlist[:12]],
        "topRefined": [{
            k: c.get(k) for k in (
                "rank", "x", "y", "radius", "angle", "inlierCount", "queryCoverage",
                "dinoRank", "dinoRetrievalScore", "generatorScore",
            )
        } for c in refined[:16]],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
