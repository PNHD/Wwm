#!/usr/bin/env python3
"""Build a bounded, same-origin Dashen raster cache for preview localization.

This intentionally fetches only fixed public tile families/ranges required by
WWMSync's current Qinghe, Kaifeng and Palace visual-localization prototype.
No caller-provided URLs are accepted and Hexi remains geometry-gated.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
FAMILIES = {
    "main": "https://img.166.net/canonical/h72/tilemap/v15.0/{z}/{x}_{y}.png?imageView&v=1",
    "sub4": "https://img.166.net/canonical/h72/tilemap/subType4/v2/{z}/{x}_{y}.png?imageView&v=1",
}

# z3 is the complete coarse pyramid required by the global matcher.
# z5 main is a bounded union around the verified Qinghe+Kaifeng projection
# extents, including a 3-tile safety margin for fine registration.
RANGES = {
    ("main", 3): (0, 7, 0, 7),
    ("sub4", 3): (0, 1, 0, 1),
    ("main", 5): (12, 28, 9, 24),
    ("sub4", 5): (0, 7, 0, 7),
}


def jobs():
    for (family, z), (min_x, max_x, min_y, max_y) in RANGES.items():
        for y in range(min_y, max_y + 1):
            for x in range(min_x, max_x + 1):
                yield family, z, x, y


def fetch_one(root: Path, family: str, z: int, x: int, y: int) -> dict:
    url = FAMILIES[family].format(z=z, x=x, y=y)
    path = root / family / str(z) / f"{x}_{y}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    last_error = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/png,image/*;q=0.8,*/*;q=0.5"})
            with urllib.request.urlopen(req, timeout=15) as response:
                data = response.read(2_000_000)
                content_type = response.headers.get("Content-Type", "")
                status = response.status
            if status != 200 or not data or not content_type.lower().startswith("image/"):
                raise RuntimeError(f"HTTP {status} content-type={content_type!r} bytes={len(data)}")
            path.write_bytes(data)
            return {
                "family": family,
                "z": z,
                "x": x,
                "y": y,
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "source": url,
            }
        except Exception as error:  # network evidence path; keep exact failing tile
            last_error = f"{type(error).__name__}: {error}"
            time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"failed {family} z{z} {x}_{y}: {last_error}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    root = args.output
    root.mkdir(parents=True, exist_ok=True)
    tile_jobs = list(jobs())
    records = []
    errors = []
    workers = min(16, max(4, (os.cpu_count() or 4) * 2))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {
            pool.submit(fetch_one, root, family, z, x, y): (family, z, x, y)
            for family, z, x, y in tile_jobs
        }
        for future in concurrent.futures.as_completed(future_map):
            tile = future_map[future]
            try:
                records.append(future.result())
            except Exception as error:
                errors.append({"tile": tile, "error": str(error)})

    records.sort(key=lambda r: (r["family"], r["z"], r["y"], r["x"]))
    manifest = {
        "version": 1,
        "scope": "preview-only public Dashen visual reference cache",
        "ranges": [
            {"family": family, "z": z, "minX": bounds[0], "maxX": bounds[1], "minY": bounds[2], "maxY": bounds[3]}
            for (family, z), bounds in sorted(RANGES.items())
        ],
        "tilesExpected": len(tile_jobs),
        "tilesFetched": len(records),
        "bytes": sum(r["bytes"] for r in records),
        "errors": errors,
        "tiles": records,
    }
    (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps({k: v for k, v in manifest.items() if k != "tiles"}, ensure_ascii=False, indent=2))
    if errors or len(records) != len(tile_jobs):
        print("Dashen visual cache incomplete", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
