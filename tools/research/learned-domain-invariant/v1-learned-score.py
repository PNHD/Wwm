#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
import os
import platform
import statistics
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
import torch
import torch.nn.functional as tF
import torchvision
from torchvision.transforms import InterpolationMode
from torchvision.transforms import functional as tvF


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json_sha(obj) -> str:
    raw = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return sha256_bytes(raw)


def percentile(values, q):
    if not values:
        return None
    a = sorted(values)
    if len(a) == 1:
        return a[0]
    pos = (len(a) - 1) * q
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return a[lo]
    return a[lo] * (hi - pos) + a[hi] * (pos - lo)


def set_determinism():
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    torch.set_grad_enabled(False)


def load_model(dino_repo: str, weights: str):
    sys.path.insert(0, dino_repo)
    from dinov2.hub.backbones import dinov2_vits14_reg
    model = dinov2_vits14_reg(pretrained=False)
    try:
        state = torch.load(weights, map_location="cpu", weights_only=True)
    except TypeError:
        state = torch.load(weights, map_location="cpu")
    model.load_state_dict(state, strict=True)
    model.to("cpu")
    model.eval()
    return model


MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]


def preprocess_rgb192(rgb: bytes):
    if len(rgb) != 192 * 192 * 3:
        raise ValueError(f"RGB192 byte length {len(rgb)}")
    arr = np.frombuffer(rgb, dtype=np.uint8).reshape(192, 192, 3)
    img = Image.fromarray(arr, mode="RGB")
    resized = tvF.resize(img, [196, 196], interpolation=InterpolationMode.BICUBIC, antialias=True)
    pre = np.asarray(resized, dtype=np.uint8)
    if pre.shape != (196, 196, 3):
        raise AssertionError(pre.shape)
    pre_bytes = pre.tobytes(order="C")
    tensor = tvF.pil_to_tensor(resized).to(dtype=torch.float32).div_(255.0)
    tensor = tvF.normalize(tensor, mean=MEAN, std=STD)
    if tuple(tensor.shape) != (3, 196, 196) or not torch.isfinite(tensor).all():
        raise AssertionError("preprocess tensor conformance")
    return tensor, sha256_bytes(pre_bytes), sha256_bytes(rgb)


def extract_batch(model, tensors):
    batch = torch.stack(tensors, dim=0)
    start = time.perf_counter()
    with torch.inference_mode():
        out = model.forward_features(batch)
    elapsed = time.perf_counter() - start
    cls = out["x_norm_clstoken"].detach().cpu()
    reg = out["x_norm_regtokens"].detach().cpu()
    patch = out["x_norm_patchtokens"].detach().cpu()
    if tuple(cls.shape[1:]) != (384,) or tuple(reg.shape[1:]) != (4, 384) or tuple(patch.shape[1:]) != (196, 384):
        raise AssertionError(f"feature shape cls={tuple(cls.shape)} reg={tuple(reg.shape)} patch={tuple(patch.shape)}")
    if not torch.isfinite(cls).all() or not torch.isfinite(reg).all() or not torch.isfinite(patch).all():
        raise AssertionError("non-finite model output")
    global_mean = tF.normalize(patch.mean(dim=1), p=2, dim=1)
    patch_norm = tF.normalize(patch, p=2, dim=2)
    return [
        {"global": global_mean[i].clone(), "patch": patch_norm[i].clone(), "cls": cls[i].clone()}
        for i in range(batch.shape[0])
    ], elapsed


def score_heads(query_feature, reference_feature):
    qg, rg = query_feature["global"], reference_feature["global"]
    qp, rp = query_feature["patch"], reference_feature["patch"]
    l1 = float(torch.dot(qg, rg))
    aligned = (qp * rp).sum(dim=1)
    l2 = float(aligned.mean())
    sim = qp @ rp.T
    l3 = float(0.5 * (sim.max(dim=1).values.mean() + sim.max(dim=0).values.mean()))
    if not all(math.isfinite(x) for x in [l1, l2, l3]):
        raise AssertionError("non-finite learned score")
    return {"L1": l1, "L2": l2, "L3": l3}


def synthetic_conformance(model):
    raw = bytearray(192 * 192 * 3)
    for y in range(192):
        for x in range(192):
            i = (y * 192 + x) * 3
            raw[i] = (x * 7 + y * 3) & 255
            raw[i + 1] = (x * 5 + y * 11) & 255
            raw[i + 2] = (x * 13 + y * 2) & 255
    t1, h1, r1 = preprocess_rgb192(bytes(raw))
    t2, h2, r2 = preprocess_rgb192(bytes(raw))
    if h1 != h2 or r1 != r2 or not torch.equal(t1, t2):
        raise AssertionError("input transform repeat instability")
    f, elapsed = extract_batch(model, [t1, t2])
    if not torch.equal(f[0]["global"], f[1]["global"]) or not torch.equal(f[0]["patch"], f[1]["patch"]):
        raise AssertionError("repeat embeddings not bitwise identical")
    identity = score_heads(f[0], f[0])
    for name, value in identity.items():
        if abs(value - 1.0) >= 2e-6:
            raise AssertionError(f"{name} identity {value}")
    return {
        "status": "PASS",
        "syntheticOnly": True,
        "inputTransformRepeatStable": True,
        "repeatEmbeddingsBitwiseEqual": True,
        "patchTokenCount": 196,
        "embeddingDimension": 384,
        "registerTokenCount": 4,
        "registerTokensExcludedFromSimilaritySamples": True,
        "identity": identity,
        "inferenceSecondsForTwo": elapsed,
    }


def summarize_candidate_results(candidates, head, mode, locked_index):
    rows = []
    for c in candidates:
        if mode == "locked":
            p = c["poses"][locked_index]
        else:
            p = max(c["poses"], key=lambda z: z["scores"][head])
        rows.append({
            "candidateId": c["candidateId"],
            "role": c["role"],
            "classification": c["classification"],
            "productionRank": c.get("productionRank"),
            "score": p["scores"][head],
            "pose": p["pose"],
            "rgb8Sha256": p["rgb8Sha256"],
            "pre196RgbSha256": p["pre196RgbSha256"],
        })
    gt = rows[0]
    wrong = rows[1:]
    strongest = max(wrong, key=lambda r: r["score"])
    margin = gt["score"] - strongest["score"]
    rank = 1 + sum(1 for r in wrong if r["score"] > gt["score"])
    ties = sum(1 for r in wrong if r["score"] == gt["score"])
    return {
        "gtScore": gt["score"],
        "strongestWrongScore": strongest["score"],
        "strongestWrongCandidateId": strongest["candidateId"],
        "margin": margin,
        "gtRank": rank,
        "ties": ties,
        "positive": margin > 0,
        "bestGtPose": gt["pose"],
        "bestWrongPose": strongest["pose"],
        "rows": rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render-dir", required=True)
    ap.add_argument("--prereg", required=True)
    ap.add_argument("--dinov2-repo", required=True)
    ap.add_argument("--weights", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--control", required=True)
    args = ap.parse_args()
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    result = {
        "schema": "wwmsync-learned-v1-control-outcome-v1",
        "status": "RUNNING",
        "controlId": args.control,
        "head": os.environ.get("GITHUB_SHA"),
        "productionChange": "NO",
    }
    try:
        prereg = json.loads(Path(args.prereg).read_text())
        if prereg["learnedOutcomesInspected"] is not False or prereg["frozenBeforeLearnedGtWrongOutcomes"] is not True:
            raise AssertionError("prereg is not prospective")
        expected = prereg["runtime"]
        if platform.python_version() != expected["python"]:
            raise AssertionError(f"python {platform.python_version()} != {expected['python']}")
        if torch.__version__ != expected["pytorch"] or torchvision.__version__ != expected["torchvision"]:
            raise AssertionError(f"runtime mismatch torch={torch.__version__} torchvision={torchvision.__version__}")
        if sha256_bytes(Path(args.weights).read_bytes()) != prereg["modelProvenance"]["weight"]["sha256"]:
            raise AssertionError("weight SHA mismatch")
        if Path(args.weights).stat().st_size != prereg["modelProvenance"]["weight"]["byteSize"]:
            raise AssertionError("weight size mismatch")
        set_determinism()
        model = load_model(args.dinov2_repo, args.weights)
        if model.training or torch.is_grad_enabled():
            raise AssertionError("model eval/no-grad conformance")

        # This synthetic/non-GT check is intentionally completed before real query/reference bytes are opened.
        result["conformance"] = synthetic_conformance(model)

        render_dir = Path(args.render_dir)
        manifest = json.loads((render_dir / "render-manifest.json").read_text())
        if manifest["status"] != "PASS" or manifest["controlId"] != args.control:
            raise AssertionError("render manifest invalid")
        if manifest["referencePack"]["candidateCount"] != 9 or manifest["referencePack"]["posesPerCandidate"] != 81:
            raise AssertionError("render population invalid")
        pack_path = render_dir / "references.rgbpack"
        if sha256_bytes(pack_path.read_bytes()) != manifest["referencePack"]["sha256"]:
            raise AssertionError("reference pack SHA mismatch")

        preprocess_contract = {
            "source": "192x192 RGB8",
            "resize": [196, 196],
            "implementation": "torchvision.transforms.functional.resize(PIL RGB)",
            "interpolation": "BICUBIC",
            "antialias": True,
            "float": "float32 [0,1]",
            "mean": MEAN,
            "std": STD,
        }
        preprocess_contract_sha = canonical_json_sha(preprocess_contract)
        result["preprocessContract"] = {**preprocess_contract, "sha256": preprocess_contract_sha}

        qraw = (render_dir / "query.rgb").read_bytes()
        qt, qpre, qraw_sha = preprocess_rgb192(qraw)
        qt2, qpre2, _ = preprocess_rgb192(qraw)
        if qpre != qpre2 or not torch.equal(qt, qt2):
            raise AssertionError("real query preprocess repeat instability")
        qfeatures, qtime = extract_batch(model, [qt])
        query_feature = qfeatures[0]
        result["query"] = {
            "rgb192Sha256": qraw_sha,
            "expectedRgb192Sha256": manifest["query"]["expectedRgb8Sha256"],
            "pre196RgbSha256": qpre,
            "pre196HashRepeatStable": True,
            "inferenceSeconds": qtime,
        }
        if qraw_sha != manifest["query"]["rgb8Sha256"]:
            raise AssertionError("query raw SHA mismatch")

        cache = {}
        cache_hits = 0
        cache_misses = 0
        inference_seconds = []
        candidate_results = []
        with pack_path.open("rb") as pack:
            pending = []
            pending_meta = []
            def flush_pending():
                nonlocal cache_hits, cache_misses
                if not pending:
                    return []
                feats, elapsed = extract_batch(model, pending)
                per = elapsed / len(pending)
                inference_seconds.extend([per] * len(pending))
                for meta, feat in zip(pending_meta, feats):
                    cache[meta["cacheKey"]] = feat
                    cache_misses += 1
                out = list(zip(pending_meta, feats))
                pending.clear(); pending_meta.clear()
                return out

            for c in manifest["candidates"]:
                crow = {
                    "candidateId": c["candidateId"], "role": c["role"], "classification": c["classification"],
                    "productionRank": c.get("productionRank"), "base": c["base"], "poses": []
                }
                staged = []
                for pose_index, p in enumerate(c["poses"]):
                    pack.seek(p["offset"])
                    raw = pack.read(p["byteSize"])
                    if len(raw) != p["byteSize"] or sha256_bytes(raw) != p["rgb8Sha256"]:
                        raise AssertionError(c["candidateId"] + " packed reference corruption")
                    tensor, pre_hash, raw_hash = preprocess_rgb192(raw)
                    pose_tuple = [p["pose"]["angleDeltaDeg"], p["pose"]["radiusFactor"], p["pose"]["xOffsetPx"], p["pose"]["yOffsetPx"]]
                    key_obj = {
                        "contentSha256": pre_hash,
                        "candidateId": c["candidateId"],
                        "pose": pose_tuple,
                        "modelWeightSha256": prereg["modelProvenance"]["weight"]["sha256"],
                        "modelSourceCommit": prereg["modelProvenance"]["sourceCommit"],
                        "preprocessContractSha256": preprocess_contract_sha,
                    }
                    cache_key = canonical_json_sha(key_obj)
                    meta = {
                        "poseIndex": pose_index, "pose": p["pose"], "rgb8Sha256": raw_hash,
                        "pre196RgbSha256": pre_hash, "cacheKey": cache_key
                    }
                    if cache_key in cache:
                        cache_hits += 1
                        staged.append((meta, cache[cache_key]))
                    else:
                        pending.append(tensor); pending_meta.append(meta)
                        if len(pending) == prereg["featureCaching"]["batchSize"]:
                            staged.extend(flush_pending())
                staged.extend(flush_pending())
                staged.sort(key=lambda z: z[0]["poseIndex"])
                if len(staged) != 81:
                    raise AssertionError(c["candidateId"] + " scored pose count")
                for meta, feat in staged:
                    crow["poses"].append({**meta, "scores": score_heads(query_feature, feat)})
                candidate_results.append(crow)
                print(json.dumps({"controlId": args.control, "candidateId": c["candidateId"], "posesScored": len(crow["poses"])}), flush=True)

        locked_index = manifest["poseGrid"]["lockedIndex"]
        result["heads"] = {}
        for head in ["L1", "L2", "L3"]:
            locked = summarize_candidate_results(candidate_results, head, "locked", locked_index)
            pose81 = summarize_candidate_results(candidate_results, head, "pose81", locked_index)
            result["heads"][head] = {
                "locked": locked,
                "pose81": pose81,
                "orderingChanged": locked["gtRank"] != pose81["gtRank"] or locked["positive"] != pose81["positive"] or locked["strongestWrongCandidateId"] != pose81["strongestWrongCandidateId"],
            }
        result["candidateResults"] = candidate_results
        result["cache"] = {
            "contract": "pre196 content SHA + candidate ID + pose + model weight SHA + source commit + preprocess contract SHA",
            "entries": len(cache), "hits": cache_hits, "misses": cache_misses,
            "duplicateInferenceForbidden": True,
        }
        result["runtime"] = {
            "referenceInferencePerImageSecondsMedian": statistics.median(inference_seconds) if inference_seconds else None,
            "referenceInferencePerImageSecondsP95": percentile(inference_seconds, .95),
            "referenceImages": len(inference_seconds),
            "torchNumThreads": torch.get_num_threads(),
            "torchNumInteropThreads": torch.get_num_interop_threads(),
        }
        result["control"] = manifest.get("control")
        result["status"] = "PASS"
    except Exception as exc:
        result["status"] = "FAIL"
        result["error"] = repr(exc)
        raise
    finally:
        (out_dir / f"{args.control}.json").write_text(json.dumps(result, indent=2) + "\n")
        (out_dir / f"{args.control}.status.txt").write_text(f"STATUS={result['status']}\nCONTROL={args.control}\nPRODUCTION_CHANGE=NO\n")


if __name__ == "__main__":
    main()
