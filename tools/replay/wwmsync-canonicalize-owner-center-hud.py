#!/usr/bin/env python3
import argparse
import base64
import hashlib
import io
import json
import subprocess
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path("fixtures/owner-gfn-center-hud")
PROV = ROOT / "provenance.json"
REPORT = Path("owner-center-hud-canonicalization.json")
PACKAGE_OUT = Path("wwmsync_owner_center_hud_fixtures.zip")
RECOVERY_START = "ae834394cb8fe733ec32e96245a9f34ee07f9089"
AUDIT_ROOT = "15a001b4227aea6f266f666528c009ef88c87183"
PROTECTED = {
    "vision-sync.js": "58b5a1babf6a12b944f9b745b8bf7f7df573bf9b",
    "dashen-tile-cache.js": "9388960a8bff53a9cfc7471372af144b7a28c34f",
    "tools/build_dashen_visual_cache.py": "1a227d06ae41660ea3e3b832e7f1921cc507c0d7",
}
ASCII_WS = b" \t\r\n\v\f"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_blob_sha1(data):
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def sh(*args):
    return subprocess.check_output(args, text=True).strip()


def verify_guards():
    for ancestor, label in ((RECOVERY_START, "recovery starting HEAD"), (AUDIT_ROOT, "audit root HEAD")):
        if subprocess.run(
            ["git", "merge-base", "--is-ancestor", ancestor, "HEAD"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode:
            raise SystemExit(f"{label} is not an ancestor of HEAD")
    for path, want in PROTECTED.items():
        got = sh("git", "hash-object", path)
        if got != want:
            raise SystemExit(f"protected blob mismatch {path}: {got}")
    text = Path("vision-sync.js").read_text(errors="replace")
    literals = {
        "structuralGate0.58": "if(fine.scaleScore<.58)",
        "intensityGate0.42": "if(fine.intensityScore<.42)",
        "coarseBeam8": "COARSE_BEAM=8",
    }
    for name, literal in literals.items():
        if literal not in text:
            raise SystemExit(f"production guard literal not found: {name}: {literal}")
    if Path("_tmp_should_not_create").exists():
        raise SystemExit("_tmp_should_not_create must be absent")
    return {
        "recoveryStartingHead": RECOVERY_START,
        "auditRootHead": AUDIT_ROOT,
        "setupHead": sh("git", "rev-parse", "HEAD"),
        "protectedBlobSha1": PROTECTED,
        "structuralGate": 0.58,
        "intensityGate": 0.42,
        "coarseBeam": 8,
    }


def decode_base64_carrier(raw, label):
    try:
        raw.decode("ascii")
    except UnicodeDecodeError as exc:
        raise ValueError(f"{label}: carrier is not ASCII") from exc
    compact = raw.translate(None, ASCII_WS)
    removed = len(raw) - len(compact)
    if not compact:
        raise ValueError(f"{label}: empty carrier")
    if b"=" in compact[:-2]:
        raise ValueError(f"{label}: non-terminal base64 padding")
    remainder = len(compact) % 4
    if remainder == 1:
        raise ValueError(f"{label}: impossible base64 length {len(compact)} mod 4 = 1")
    implicit_padding = (4 - remainder) % 4
    if implicit_padding and b"=" in compact:
        raise ValueError(f"{label}: malformed explicit base64 padding")
    padded = compact + (b"=" * implicit_padding)
    try:
        decoded = base64.b64decode(padded, validate=True)
    except Exception as exc:
        raise ValueError(f"{label}: invalid base64 carrier") from exc
    return decoded, {
        "rawBytes": len(raw),
        "compactChars": len(compact),
        "structuralWhitespaceBytesRemoved": removed,
        "implicitTerminalPaddingCharsAdded": implicit_padding,
    }


def attempt_case_a(raw_chunks):
    try:
        decoded, details = decode_base64_carrier(b"".join(raw_chunks), "case A joined carrier")
        return {"valid": True, "decoded": decoded, "sha256": sha256(decoded), "details": details}
    except ValueError as exc:
        return {"valid": False, "decoded": None, "sha256": None, "error": str(exc)}


def attempt_case_b(raw_chunks):
    decoded_parts = []
    details = []
    try:
        for index, raw in enumerate(raw_chunks):
            decoded, detail = decode_base64_carrier(raw, f"case B chunk {index}")
            decoded_parts.append(decoded)
            details.append(detail)
        joined = b"".join(decoded_parts)
        return {"valid": True, "decoded": joined, "sha256": sha256(joined), "details": details}
    except ValueError as exc:
        return {"valid": False, "decoded": None, "sha256": None, "error": str(exc), "details": details}


def reconstruct_package(prov):
    chunks = sorted(ROOT.glob("package.b64.*"), key=lambda p: p.name)
    if [p.name for p in chunks] != ["package.b64.00", "package.b64.01"]:
        raise SystemExit(f"unexpected package carrier set: {[p.name for p in chunks]}")
    raw_chunks = [p.read_bytes() for p in chunks]
    expected = prov["sourcePackage"]["zipSha256"]

    case_a = attempt_case_a(raw_chunks)
    case_b = attempt_case_b(raw_chunks)
    a_match = case_a["valid"] and case_a["sha256"] == expected
    b_match = case_b["valid"] and case_b["sha256"] == expected

    if a_match:
        package = case_a["decoded"]
        semantics = "A_ORDERED_CHUNKS_OF_ONE_BASE64_TEXT_STREAM"
        if b_match:
            basis = (
                "Case A and case B decode to identical expected package bytes because the frozen split is "
                "base64-quantum aligned. Classify as A: package.b64.00 is a fixed-size textual prefix and "
                "package.b64.01 is its continuation; only the full joined stream needs terminal completion."
            )
        else:
            basis = "Only joined-text decode matches the immutable package SHA-256."
    elif b_match:
        package = case_b["decoded"]
        semantics = "B_INDEPENDENTLY_BASE64_ENCODED_BINARY_CHUNKS"
        basis = "Only decode-each-then-concatenate matches the immutable package SHA-256."
    else:
        raise SystemExit(
            "package SHA mismatch under both frozen carrier interpretations: "
            f"expected={expected}, caseA={case_a.get('sha256')} valid={case_a['valid']} "
            f"error={case_a.get('error')}, caseB={case_b.get('sha256')} valid={case_b['valid']} "
            f"error={case_b.get('error')}"
        )

    return package, {
        "semantics": semantics,
        "classificationBasis": basis,
        "chunks": [
            {"path": str(path), "rawBytes": len(raw)}
            for path, raw in zip(chunks, raw_chunks)
        ],
        "caseA": {k: v for k, v in case_a.items() if k != "decoded"},
        "caseB": {k: v for k, v in case_b.items() if k != "decoded"},
        "caseAAndBByteEquivalent": bool(a_match and b_match and case_a["decoded"] == case_b["decoded"]),
    }


def verify_webp(raw, item, source_name, write):
    webp_sha = sha256(raw)
    if webp_sha != item["webpSha256"]:
        raise SystemExit(f"{item['id']}: WebP SHA mismatch {webp_sha}")
    blob_sha = git_blob_sha1(raw)
    if blob_sha != item["expectedCanonicalGitBlobSha1"]:
        raise SystemExit(f"{item['id']}: canonical Git blob SHA mismatch {blob_sha}")

    with Image.open(io.BytesIO(raw)) as im:
        im.load()
        if im.size != (270, 270):
            raise SystemExit(f"{item['id']}: dimensions {im.size}")
        if im.mode != "RGB":
            raise SystemExit(f"{item['id']}: mode {im.mode}")
        rgb = im.tobytes()
    if len(rgb) != 218700:
        raise SystemExit(f"{item['id']}: RGB byte length {len(rgb)}")
    rgb_sha = sha256(rgb)
    if rgb_sha != item["rgb8Sha256"]:
        raise SystemExit(f"{item['id']}: RGB8 SHA mismatch {rgb_sha}")

    rgba = bytearray((len(rgb) // 3) * 4)
    rgba[0::4] = rgb[0::3]
    rgba[1::4] = rgb[1::3]
    rgba[2::4] = rgb[2::3]
    rgba[3::4] = b"\xff" * (len(rgb) // 3)
    rgba_sha = sha256(rgba)
    if rgba_sha != item["taskPromptRgba255CompatibilitySha256"]:
        raise SystemExit(f"{item['id']}: RGBA255 compatibility SHA mismatch {rgba_sha}")

    dst = ROOT / item["file"]
    if write:
        dst.write_bytes(raw)

    return {
        "id": item["id"],
        "path": str(dst),
        "packageMember": source_name,
        "webpSha256": webp_sha,
        "rgb8Sha256": rgb_sha,
        "taskPromptRgba255CompatibilitySha256": rgba_sha,
        "gitBlobSha1": blob_sha,
        "size": [270, 270],
        "mode": "RGB",
        "rgbByteLength": len(rgb),
        "evaluation": item["evaluation"],
    }


def recover(prov, write):
    package, carrier = reconstruct_package(prov)
    expected_zip_sha = prov["sourcePackage"]["zipSha256"]
    package_sha = sha256(package)
    if package_sha != expected_zip_sha:
        raise SystemExit(f"reconstructed package SHA mismatch {package_sha}")
    PACKAGE_OUT.write_bytes(package)

    with zipfile.ZipFile(io.BytesIO(package), "r") as zf:
        names = zf.namelist()
        if len(names) != len(set(names)):
            raise SystemExit("ZIP contains duplicate member names")
        manifest_names = [name for name in names if name.replace("\\", "/") == "manifest.json"]
        if manifest_names != ["manifest.json"]:
            raise SystemExit(f"ZIP manifest inventory mismatch: {manifest_names}")
        manifest_raw = zf.read("manifest.json")
        manifest_sha = sha256(manifest_raw)
        expected_manifest_sha = prov["sourcePackage"]["embeddedManifestSha256"]
        if manifest_sha != expected_manifest_sha:
            raise SystemExit(f"embedded manifest SHA mismatch {manifest_sha}")
        json.loads(manifest_raw.decode("utf-8"))

        webp_names = [name for name in names if name.lower().endswith(".webp")]
        if len(webp_names) != 6:
            raise SystemExit(f"ZIP must contain exactly six WebPs, got {webp_names}")
        normalized_zip_webps = {name.replace("\\", "/") for name in webp_names}
        if len(normalized_zip_webps) != 6:
            raise SystemExit("ZIP WebP member names are not unique")

        expected_by_sha = {item["webpSha256"]: item for item in prov["fixtures"]}
        if len(expected_by_sha) != 6:
            raise SystemExit("provenance WebP SHA set is not unique")

        seen = set()
        rows = []
        for member in sorted(webp_names):
            raw = zf.read(member)
            webp_sha = sha256(raw)
            item = expected_by_sha.get(webp_sha)
            if item is None:
                raise SystemExit(f"unexpected/replacement WebP member {member}: {webp_sha}")
            if item["id"] in seen:
                raise SystemExit(f"duplicate fixture bytes for {item['id']}")
            seen.add(item["id"])
            rows.append(verify_webp(raw, item, member, write))

    expected_ids = {item["id"] for item in prov["fixtures"]}
    if seen != expected_ids:
        raise SystemExit(f"fixture inventory mismatch: seen={sorted(seen)}")

    if write:
        written = sorted(path.name for path in ROOT.glob("*.webp"))
        expected_files = sorted(item["file"] for item in prov["fixtures"])
        if written != expected_files:
            raise SystemExit(f"tracked fixture target inventory mismatch: {written} != {expected_files}")

    return {
        "mode": "RECOVERY",
        "carrier": carrier,
        "reconstructedPackagePath": str(PACKAGE_OUT),
        "reconstructedPackageSha256": package_sha,
        "embeddedManifestSha256": manifest_sha,
        "zipWebpInventory": sorted(normalized_zip_webps),
        "fixtures": sorted(rows, key=lambda row: row["id"]),
    }


def steady(prov):
    expected_files = sorted(item["file"] for item in prov["fixtures"])
    actual = sorted(path.name for path in ROOT.glob("*.webp"))
    if actual != expected_files:
        raise SystemExit(f"steady-state WebP inventory mismatch: {actual} != {expected_files}")
    rows = []
    for item in prov["fixtures"]:
        path = ROOT / item["file"]
        rows.append(verify_webp(path.read_bytes(), item, "TRACKED_FILE", False))
    return {
        "mode": "STEADY_STATE",
        "descriptorInput": "six normal tracked WebPs only",
        "recoveryCarriersConsumed": False,
        "transportIndexConsumed": False,
        "gitBlobApiConsumed": False,
        "fixtures": sorted(rows, key=lambda row: row["id"]),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("recovery", "steady"), required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    if args.mode == "steady" and args.write:
        raise SystemExit("--write is valid only in recovery mode")

    prov = json.loads(PROV.read_text(encoding="utf-8"))
    if len(prov.get("fixtures", [])) != 6:
        raise SystemExit("provenance must define exactly six fixtures")
    guards = verify_guards()
    result = recover(prov, args.write) if args.mode == "recovery" else steady(prov)

    report = {
        "schema": "wwmsync-owner-center-hud-canonicalization-v2",
        "guards": guards,
        "sourcePackageExpectedSha256": prov["sourcePackage"]["zipSha256"],
        "embeddedManifestExpectedSha256": prov["sourcePackage"]["embeddedManifestSha256"],
        "pixelHashNomenclature": (
            "rgb8Sha256 is true decoded RGB8; "
            "taskPromptRgba255CompatibilitySha256 is deterministic RGB->RGBA alpha=255"
        ),
        "staleGitBlobTransportDependency": False,
        "result": result,
        "status": "PASS",
    }
    REPORT.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(REPORT.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
