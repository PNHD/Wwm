#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import urllib.error
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
BASES = {
    "main": "https://img.166.net/canonical/h72/tilemap/v{version:.1f}/{z}/{x}_{y}.png?imageView&v=1",
    "sub4": "https://img.166.net/canonical/h72/tilemap/subType4/v{version:g}/{z}/{x}_{y}.png?imageView&v=1",
}

# Representative z5 tiles spanning the current Qinghe/Kaifeng bounded cache,
# including basins repeatedly surfaced by the real-GFN diagnostics.
PROBES = {
    "main": [(5, 20, 15), (5, 24, 12), (5, 26, 13), (5, 21, 16)],
    "sub4": [(5, 2, 2), (5, 4, 4)],
}


def fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "image/png,image/*;q=0.8,*/*;q=0.5",
        "Cache-Control": "no-cache",
    })
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            data = response.read(2_000_000)
            content_type = response.headers.get("Content-Type", "")
            return {
                "status": int(response.status),
                "contentType": content_type,
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest() if data else None,
                "imageLike": bool(data) and content_type.lower().startswith("image/"),
                "finalUrl": response.geturl(),
            }
    except urllib.error.HTTPError as error:
        body = error.read(2048)
        return {
            "status": int(error.code),
            "contentType": error.headers.get("Content-Type", "") if error.headers else "",
            "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest() if body else None,
            "imageLike": False,
            "error": f"HTTPError: {error}",
        }
    except Exception as error:
        return {
            "status": None,
            "contentType": "",
            "bytes": 0,
            "sha256": None,
            "imageLike": False,
            "error": f"{type(error).__name__}: {error}",
        }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--min-version", type=int, default=1)
    ap.add_argument("--max-version", type=int, default=30)
    args = ap.parse_args()

    rows = []
    by_family_version: dict[str, dict[str, dict]] = {family: {} for family in BASES}
    for family, template in BASES.items():
        for version in range(args.min_version, args.max_version + 1):
            probe_rows = []
            for z, x, y in PROBES[family]:
                url = template.format(version=float(version), z=z, x=x, y=y)
                result = fetch(url)
                row = {"family": family, "version": version, "z": z, "x": x, "y": y, "url": url, **result}
                rows.append(row)
                probe_rows.append(row)
            image_count = sum(int(r["imageLike"]) for r in probe_rows)
            hashes = sorted({r["sha256"] for r in probe_rows if r["imageLike"] and r["sha256"]})
            by_family_version[family][str(version)] = {
                "probeCount": len(probe_rows),
                "imageCount": image_count,
                "allImage": image_count == len(probe_rows),
                "statuses": [r["status"] for r in probe_rows],
                "hashes": hashes,
            }

    available = {}
    for family, versions in by_family_version.items():
        available[family] = [int(v) for v, data in versions.items() if data["allImage"]]

    main_available = available.get("main", [])
    report = {
        "schema": "wwmsync-dashen-public-tile-revision-probe-v1",
        "scope": {
            "diagnosticOnly": True,
            "productRuntimeChanged": False,
            "purpose": "determine whether the pinned Dashen v15.0 main raster is stale relative to another publicly reachable sequential tile revision",
        },
        "versionRange": [args.min_version, args.max_version],
        "probes": {family: [{"z": z, "x": x, "y": y} for z, x, y in probes] for family, probes in PROBES.items()},
        "availableVersions": available,
        "latestFullyAvailableMainVersion": max(main_available) if main_available else None,
        "pinnedMainVersion": 15,
        "newerMainRevisionExists": bool(main_available and max(main_available) > 15),
        "byFamilyVersion": by_family_version,
        "rows": rows,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "report": str(args.report),
        "availableVersions": available,
        "latestFullyAvailableMainVersion": report["latestFullyAvailableMainVersion"],
        "newerMainRevisionExists": report["newerMainRevisionExists"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
