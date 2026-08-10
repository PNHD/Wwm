#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, deque
from pathlib import Path

ROOT = os.environ.get("DD_ROOT", "https://dd.163.com/")
OUT = Path(os.environ.get("DD_FORENSIC_OUT", "dd-forensic"))
OUT.mkdir(parents=True, exist_ok=True)
FETCH_DIR = OUT / "fetched"
EXTRACT_DIR = OUT / "extracted"
REPORT_DIR = OUT / "report"
for d in (FETCH_DIR, EXTRACT_DIR, REPORT_DIR):
    d.mkdir(parents=True, exist_ok=True)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
MAX_TEXT = 20 * 1024 * 1024
MAX_DOWNLOAD = 1800 * 1024 * 1024
MAX_SCAN_FILE = 120 * 1024 * 1024
MAX_CRAWL = 140
TIMEOUT = 30


def log(msg: str) -> None:
    print(f"[dd-forensic] {msg}", flush=True)


def req(url: str, method: str = "GET", headers: dict[str, str] | None = None):
    h = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    return urllib.request.Request(url, method=method, headers=h)


def fetch_small(url: str, limit: int = MAX_TEXT) -> dict:
    started = time.time()
    try:
        with urllib.request.urlopen(req(url), timeout=TIMEOUT) as r:
            data = r.read(limit + 1)
            return {
                "ok": True,
                "url": url,
                "final_url": r.geturl(),
                "status": getattr(r, "status", 200),
                "content_type": r.headers.get("Content-Type", ""),
                "content_disposition": r.headers.get("Content-Disposition", ""),
                "content_length": r.headers.get("Content-Length", ""),
                "truncated": len(data) > limit,
                "data": data[:limit],
                "elapsed": round(time.time() - started, 3),
            }
    except Exception as e:
        return {"ok": False, "url": url, "error": repr(e), "elapsed": round(time.time() - started, 3)}


def normalize_js_text(text: str) -> str:
    text = html.unescape(text)
    text = text.replace("\\/", "/")
    text = re.sub(r"\\u002[fF]", "/", text)
    text = re.sub(r"\\x2[fF]", "/", text)
    text = re.sub(r"\\u003[aA]", ":", text)
    return text


def clean_url(raw: str, base: str) -> str | None:
    raw = raw.strip().strip("'\"`()[]{};,\\")
    if not raw or raw.startswith(("javascript:", "data:", "mailto:", "#")):
        return None
    raw = raw.replace("\\/", "/")
    if raw.startswith("//"):
        raw = "https:" + raw
    try:
        u = urllib.parse.urljoin(base, raw)
        p = urllib.parse.urlsplit(u)
        if p.scheme not in ("http", "https") or not p.netloc:
            return None
        return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, p.query, ""))
    except Exception:
        return None


def extract_refs(text: str, base: str) -> list[str]:
    text = normalize_js_text(text)
    found: set[str] = set()
    patterns = [
        r"(?is)(?:href|src|url|downloadUrl|download_url|packageUrl|package_url|installerUrl|updateUrl|manifestUrl)\s*[:=]\s*[\"']([^\"']+)",
        r"(?i)https?://[^\s\"'<>\\]+",
        r"(?i)(?<!:)//[^\s\"'<>\\]+",
        r"[\"'](/[^\"'<>\s]{2,})[\"']",
    ]
    for pat in patterns:
        for m in re.finditer(pat, text):
            raw = m.group(1) if m.lastindex else m.group(0)
            u = clean_url(raw, base)
            if u:
                found.add(u)
    return sorted(found)


def likely_text_asset(url: str) -> bool:
    p = urllib.parse.urlsplit(url)
    path = p.path.lower()
    ext = Path(path).suffix
    if ext in {".js", ".mjs", ".cjs", ".json", ".html", ".htm", ".css", ".txt", ".xml", ".map"}:
        return True
    return any(k in path for k in ("manifest", "version", "config", "download", "update", "index")) and not ext


def provenance_allowed(parent: str, child: str) -> bool:
    # Every fetched child must be directly referenced by an already fetched official page/asset.
    # Cross-domain CDN/download URLs are allowed only through that recorded provenance edge.
    return parent.startswith("http") and child.startswith(("http://", "https://"))


def candidate_score(url: str, source: str) -> int:
    p = urllib.parse.urlsplit(url)
    host = p.netloc.lower()
    path = p.path.lower()
    q = p.query.lower()
    whole = path + "?" + q
    ext = Path(path).suffix.lower()
    score = 0
    if ext in {".exe", ".msi"}:
        score += 140
    elif ext in {".zip", ".7z", ".rar", ".cab", ".nupkg"}:
        score += 110
    elif ext in {".dmg", ".pkg"}:
        score -= 160
    if host == "adl.netease.com" or host.endswith(".adl.netease.com"):
        score += 95
    if any(k in host for k in ("download", "dl.netease", "gdl", "adl")):
        score += 45
    for token, pts in (
        ("/d/g/dd/", 85), ("installer", 65), ("setup", 60), ("download", 40),
        ("client", 35), ("windows", 45), ("win64", 45), ("win32", 35), ("pc", 20),
        ("beibei", 25), ("netease-dd", 25),
    ):
        if token in whole:
            score += pts
    if any(k in whole for k in ("android", "ios", "iphone", "macos", "darwin", ".dmg", ".pkg")):
        score -= 120
    # Keep source only for audit; don't award points merely because the source is dd.163.com.
    return score


def magic_kind(data: bytes) -> str:
    if data.startswith(b"MZ"):
        return "pe-executable"
    if data.startswith(b"PK\x03\x04"):
        return "zip"
    if data.startswith(b"7z\xbc\xaf\x27\x1c"):
        return "7z"
    if data.startswith(b"Rar!"):
        return "rar"
    if data.startswith(b"MSCF"):
        return "cab"
    if data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
        return "ole-msi-or-compound"
    return "unknown"


def probe(url: str) -> dict:
    try:
        with urllib.request.urlopen(req(url, headers={"Range": "bytes=0-32767"}), timeout=TIMEOUT) as r:
            data = r.read(32768)
            final_url = r.geturl()
            kind = magic_kind(data)
            ctype = r.headers.get("Content-Type", "")
            cdisp = r.headers.get("Content-Disposition", "")
            binary = kind != "unknown" or any(x in ctype.lower() for x in (
                "octet-stream", "application/x-msdownload", "application/zip", "application/x-7z", "application/vnd.microsoft",
            )) or bool(re.search(r"(?i)filename=.*\.(?:exe|msi|zip|7z|rar|cab)", cdisp))
            return {
                "ok": True,
                "url": url,
                "final_url": final_url,
                "status": getattr(r, "status", 200),
                "content_type": ctype,
                "content_disposition": cdisp,
                "content_length": r.headers.get("Content-Length", ""),
                "content_range": r.headers.get("Content-Range", ""),
                "magic": kind,
                "binary": binary,
                "sample_sha256": hashlib.sha256(data).hexdigest(),
            }
    except Exception as e:
        return {"ok": False, "url": url, "error": repr(e)}


def discover() -> tuple[dict, list[dict], list[dict]]:
    q = deque([(ROOT, None, 0)])
    seen: set[str] = set()
    fetched: list[dict] = []
    edges: list[dict] = []
    url_sources: dict[str, str] = {ROOT: "ROOT"}
    all_refs: set[str] = set()

    while q and len(seen) < MAX_CRAWL:
        url, parent, depth = q.popleft()
        if url in seen:
            continue
        seen.add(url)
        res = fetch_small(url)
        meta = {k: v for k, v in res.items() if k != "data"}
        meta.update({"parent": parent, "depth": depth})
        fetched.append(meta)
        if not res.get("ok"):
            continue
        data = res["data"]
        ctype = res.get("content_type", "").lower()
        if magic_kind(data) != "unknown" and url != ROOT:
            continue
        if not ("text" in ctype or "json" in ctype or "javascript" in ctype or "xml" in ctype or likely_text_asset(url) or url == ROOT):
            continue
        text = data.decode("utf-8", "ignore")
        refs = extract_refs(text, res.get("final_url", url))
        for child in refs:
            all_refs.add(child)
            if child not in url_sources:
                url_sources[child] = url
            edges.append({"from": url, "to": child})
            if depth < 2 and likely_text_asset(child) and provenance_allowed(url, child):
                q.append((child, url, depth + 1))

    scored = []
    for u in all_refs:
        s = candidate_score(u, url_sources.get(u, ""))
        if s >= 55:
            scored.append({"url": u, "source": url_sources.get(u, ""), "score": s})
    scored.sort(key=lambda x: x["score"], reverse=True)

    probes: list[dict] = []
    chosen: dict = {}
    for c in scored[:40]:
        p = probe(c["url"])
        p.update({"source": c["source"], "score": c["score"]})
        probes.append(p)
        if p.get("ok") and p.get("binary"):
            final_path = urllib.parse.urlsplit(p.get("final_url", c["url"])).path.lower()
            if any(final_path.endswith(x) for x in (".dmg", ".pkg")):
                continue
            if not chosen or c["score"] > chosen.get("score", -999):
                chosen = p.copy()

    root_meta = next((x for x in fetched if x["url"] == ROOT), {})
    audit = {
        "root": ROOT,
        "root_fetch": root_meta,
        "fetched": fetched,
        "provenance_edges": edges,
        "candidate_count": len(scored),
        "candidates": scored,
        "probes": probes,
        "chosen_probe": chosen,
    }
    (REPORT_DIR / "provenance.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    return chosen, fetched, probes


def filename_from_headers(meta: dict) -> str:
    cdisp = meta.get("content_disposition", "")
    m = re.search(r"(?i)filename\*?=(?:UTF-8''|\")?([^\";]+)", cdisp)
    if m:
        name = urllib.parse.unquote(m.group(1).strip())
        if name:
            return Path(name).name
    path = urllib.parse.urlsplit(meta.get("final_url") or meta.get("url", "")).path
    name = Path(path).name
    if name and "." in name:
        return name
    kind = meta.get("magic")
    return {"pe-executable": "dd-installer.exe", "zip": "dd-package.zip", "7z": "dd-package.7z", "rar": "dd-package.rar", "cab": "dd-package.cab", "ole-msi-or-compound": "dd-installer.msi"}.get(kind, "dd-distribution.bin")


def download_distribution(meta: dict) -> dict:
    if not meta:
        return {"ok": False, "reason": "no binary distribution candidate was resolved from official-page provenance"}
    url = meta["url"]
    dest = OUT / filename_from_headers(meta)
    h = hashlib.sha256()
    total = 0
    try:
        with urllib.request.urlopen(req(url), timeout=90) as r, dest.open("wb") as f:
            final_url = r.geturl()
            declared = r.headers.get("Content-Length")
            if declared and declared.isdigit() and int(declared) > MAX_DOWNLOAD:
                return {"ok": False, "reason": f"distribution exceeds static-analysis cap: {declared} bytes", "final_url": final_url}
            while True:
                chunk = r.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_DOWNLOAD:
                    f.close()
                    dest.unlink(missing_ok=True)
                    return {"ok": False, "reason": f"distribution exceeded {MAX_DOWNLOAD} byte cap", "final_url": final_url}
                h.update(chunk)
                f.write(chunk)
            first = dest.read_bytes()[:32768]
            return {
                "ok": True,
                "path": str(dest),
                "source_url": url,
                "source_asset": meta.get("source"),
                "final_url": final_url,
                "size": total,
                "sha256": h.hexdigest(),
                "magic": magic_kind(first),
                "content_type": r.headers.get("Content-Type", ""),
                "content_disposition": r.headers.get("Content-Disposition", ""),
            }
    except Exception as e:
        dest.unlink(missing_ok=True)
        return {"ok": False, "reason": repr(e), "source_url": url, "source_asset": meta.get("source")}


def dir_size(path: Path) -> int:
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total


def run_cmd(cmd: list[str], timeout: int = 240) -> dict:
    try:
        p = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        return {"cmd": cmd, "returncode": p.returncode, "output": p.stdout[-20000:]}
    except Exception as e:
        return {"cmd": cmd, "returncode": -1, "output": repr(e)}


def extract_one(src: Path, dest: Path) -> dict:
    dest.mkdir(parents=True, exist_ok=True)
    attempts = []
    if shutil.which("7z"):
        r = run_cmd(["7z", "x", "-y", "-bd", str(src), f"-o{dest}"])
        attempts.append(r)
        if r["returncode"] == 0 and any(dest.rglob("*")):
            return {"ok": True, "method": "7z", "source": str(src), "dest": str(dest), "attempts": attempts}
    if src.suffix.lower() == ".exe" and shutil.which("innoextract"):
        r = run_cmd(["innoextract", "--silent", "--output-dir", str(dest), str(src)])
        attempts.append(r)
        if r["returncode"] == 0 and any(dest.rglob("*")):
            return {"ok": True, "method": "innoextract", "source": str(src), "dest": str(dest), "attempts": attempts}
    return {"ok": False, "source": str(src), "dest": str(dest), "attempts": attempts}


def recursive_extract(dist: Path) -> dict:
    root = EXTRACT_DIR / "root"
    root_res = extract_one(dist, root)
    results = [root_res]
    if not root_res.get("ok"):
        (REPORT_DIR / "extraction.json").write_text(json.dumps({"root": root_res, "nested": []}, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"root": root_res, "nested": [], "file_count": 0, "total_size": 0}

    archive_exts = {".zip", ".7z", ".rar", ".cab", ".msi", ".nupkg"}
    q = deque([(p, 1) for p in root.rglob("*") if p.is_file()])
    seen_hash: set[str] = set()
    nested = []
    processed = 0
    while q and processed < 80 and dir_size(EXTRACT_DIR) < 8 * 1024 * 1024 * 1024:
        p, depth = q.popleft()
        if depth > 3:
            continue
        try:
            size = p.stat().st_size
        except OSError:
            continue
        name = p.name.lower()
        is_archive = p.suffix.lower() in archive_exts
        is_sfx = p.suffix.lower() == ".exe" and size > 2 * 1024 * 1024 and any(k in name for k in ("setup", "install", "update", "patch", "package", "client", "app"))
        if not (is_archive or is_sfx) or size > 700 * 1024 * 1024:
            continue
        try:
            digest = hashlib.sha256(p.read_bytes()).hexdigest()
        except Exception:
            continue
        if digest in seen_hash:
            continue
        seen_hash.add(digest)
        processed += 1
        dest = EXTRACT_DIR / "nested" / f"d{depth}-{digest[:16]}-{re.sub(r'[^A-Za-z0-9._-]+', '_', p.name)[:80]}"
        res = extract_one(p, dest)
        res.update({"depth": depth, "sha256": digest, "size": size})
        nested.append(res)
        if res.get("ok"):
            for child in dest.rglob("*"):
                if child.is_file():
                    q.append((child, depth + 1))

    # Electron ASAR is static packaging. Extract only if present; never execute packaged application code.
    asar_results = []
    npx = shutil.which("npx")
    if npx:
        for asar in list(EXTRACT_DIR.rglob("*.asar"))[:20]:
            dest = asar.with_name(asar.name + ".extracted")
            r = run_cmd([npx, "--yes", "@electron/asar", "extract", str(asar), str(dest)], timeout=180)
            asar_results.append({"source": str(asar), "dest": str(dest), **r})

    files = [p for p in EXTRACT_DIR.rglob("*") if p.is_file()]
    result = {
        "root": root_res,
        "nested": nested,
        "asar": asar_results,
        "file_count": len(files),
        "total_size": sum(p.stat().st_size for p in files if p.exists()),
    }
    (REPORT_DIR / "extraction.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


PATTERNS = {
    "game": [
        r"Where\s*Winds\s*Meet", r"wherewindsmeet", r"where[_-]?winds[_-]?meet", r"燕云十六声", r"燕雲十六聲",
        r"Yanyun", r"YanYun", r"yysls?", r"\bWWM\b",
    ],
    "dd_beibei": [r"\bBeibei\b", r"贝贝", r"貝貝", r"网易DD", r"NetEase\s*DD", r"\bDD\b"],
    "loopback": [r"127\.0\.0\.1", r"localhost", r"\[::1\]", r"0\.0\.0\.0"],
    "websocket": [r"ws://", r"wss://", r"WebSocket", r"websocket"],
    "ipc": [
        r"\\\\\.\\pipe\\", r"NamedPipe", r"CreateNamedPipe", r"CallNamedPipe", r"WM_COPYDATA",
        r"QLocalSocket", r"QLocalServer", r"AF_UNIX", r"unix://", r"ipc://", r"localSocket", r"localServer",
    ],
    "browser_bridge": [
        r"ipcRenderer", r"ipcMain", r"contextBridge", r"webContents", r"cefQuery", r"window\.cefQuery", r"CefSharp",
        r"WebView2", r"chrome\.webview", r"addHostObjectToScript", r"RegisterJsObject", r"Electron",
    ],
    "state": [
        r"position", r"pos[_-]?[xyz]", r"coordinate", r"coords?", r"location", r"map[_-]?id", r"scene[_-]?id",
        r"progress", r"currentTime", r"duration", r"playback", r"timestamp", r"seek", r"currentTrack", r"trackId",
        r"playing", r"paused", r"坐标", r"座標", r"位置", r"进度", r"進度",
    ],
    "protocol": [r"protobuf", r"\.proto", r"msgpack", r"MessagePack", r"grpc", r"JSON\.parse", r"parseFrom", r"SerializeTo"],
}
COMPILED = {k: [re.compile(p, re.I) for p in pats] for k, pats in PATTERNS.items()}
URL_RE = re.compile(r"(?i)\b(?:https?|wss?)://[^\s\"'<>]{4,240}")
LOOP_URL_RE = re.compile(r"(?i)\b(?:https?|wss?)://(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{2,5})?[^\s\"'<>]{0,180}")
PIPE_RE = re.compile(r"(?i)\\\\\.\\pipe\\[^\s\"'<>]{1,160}")
SCHEME_RE = re.compile(r"(?i)\b([a-z][a-z0-9+.-]{2,30})://[^\s\"'<>]{0,180}")


def binary_strings(raw: bytes) -> str:
    parts: list[str] = []
    for m in re.finditer(rb"[\x20-\x7e]{5,}", raw):
        try:
            parts.append(m.group(0).decode("ascii"))
        except Exception:
            pass
    # Common PE/resource UTF-16LE strings; include CJK range as printable payload.
    try:
        u = raw.decode("utf-16le", "ignore")
        parts.extend(re.findall(r"[\x20-\x7e\u3400-\u9fff]{5,}", u))
    except Exception:
        pass
    return "\n".join(parts)


def context(text: str, start: int, end: int, radius: int = 180) -> str:
    s = max(0, start - radius)
    e = min(len(text), end + radius)
    return re.sub(r"[\r\n\t]+", " ", text[s:e])[:700]


def scan_file(path: Path) -> tuple[set[str], list[dict], set[str], set[str], set[str]]:
    try:
        size = path.stat().st_size
        if size <= 0 or size > MAX_SCAN_FILE:
            return set(), [], set(), set(), set()
        raw = path.read_bytes()
    except Exception:
        return set(), [], set(), set(), set()

    suffix = path.suffix.lower()
    text_like = suffix in {".js", ".mjs", ".cjs", ".json", ".html", ".htm", ".css", ".txt", ".xml", ".ini", ".cfg", ".conf", ".yaml", ".yml", ".log", ".md", ".proto"}
    if text_like:
        text = raw.decode("utf-8", "ignore")
        if len(text) < 20:
            text = raw.decode("utf-16le", "ignore")
    else:
        text = binary_strings(raw)

    cats: set[str] = set()
    hits: list[dict] = []
    for cat, regs in COMPILED.items():
        count = 0
        for rg in regs:
            for m in rg.finditer(text):
                cats.add(cat)
                if count < 8:
                    hits.append({"category": cat, "match": m.group(0)[:180], "context": context(text, m.start(), m.end())})
                count += 1
                if count >= 30:
                    break
            if count >= 30:
                break

    loop_urls = {m.group(0) for m in LOOP_URL_RE.finditer(text)}
    pipes = {m.group(0) for m in PIPE_RE.finditer(text)}
    schemes = set()
    for m in SCHEME_RE.finditer(text):
        scheme = m.group(1).lower()
        if scheme not in {"http", "https", "ws", "wss", "file", "ftp"}:
            schemes.add(m.group(0))
    return cats, hits, loop_urls, pipes, schemes


def static_scan(dist: Path, extraction: dict) -> dict:
    scan_roots = [dist]
    if extraction.get("root", {}).get("ok"):
        scan_roots.extend([p for p in EXTRACT_DIR.rglob("*") if p.is_file()])
    inventory = []
    hit_rows = []
    cooccurrence = []
    loop_urls: set[str] = set()
    pipes: set[str] = set()
    schemes: set[str] = set()
    counts = Counter()
    unique: set[str] = set()

    with (REPORT_DIR / "inventory.tsv").open("w", encoding="utf-8") as inv:
        inv.write("sha256\tsize\tpath\n")
        for p in scan_roots:
            sp = str(p)
            if sp in unique:
                continue
            unique.add(sp)
            try:
                size = p.stat().st_size
                digest = hashlib.sha256(p.read_bytes()).hexdigest() if size <= 700 * 1024 * 1024 else "SKIPPED_LARGE"
            except Exception:
                continue
            inv.write(f"{digest}\t{size}\t{sp}\n")
            inventory.append({"path": sp, "size": size, "sha256": digest})
            cats, hits, urls, pipe_set, scheme_set = scan_file(p)
            loop_urls.update(urls)
            pipes.update(pipe_set)
            schemes.update(scheme_set)
            for c in cats:
                counts[c] += 1
            if cats:
                for h in hits:
                    hit_rows.append({"path": sp, **h})
            if len(cats & {"game", "loopback", "websocket", "ipc", "browser_bridge", "state"}) >= 2:
                cooccurrence.append({"path": sp, "categories": sorted(cats), "size": size})

    with (REPORT_DIR / "hits.tsv").open("w", encoding="utf-8") as f:
        f.write("category\tpath\tmatch\tcontext\n")
        for h in hit_rows:
            f.write("\t".join(str(h[k]).replace("\t", " ").replace("\n", " ") for k in ("category", "path", "match", "context")) + "\n")

    triples = [x for x in cooccurrence if "game" in x["categories"] and "state" in x["categories"] and any(c in x["categories"] for c in ("loopback", "websocket", "ipc", "browser_bridge"))]
    transport_state = [x for x in cooccurrence if "state" in x["categories"] and any(c in x["categories"] for c in ("loopback", "websocket", "ipc", "browser_bridge"))]
    result = {
        "files_scanned": len(inventory),
        "category_file_counts": dict(counts),
        "exact_loopback_urls": sorted(loop_urls),
        "named_pipes": sorted(pipes),
        "custom_schemes": sorted(schemes),
        "cooccurrence": sorted(cooccurrence, key=lambda x: ("game" not in x["categories"], "state" not in x["categories"], x["path"]))[:250],
        "game_transport_state_files": triples,
        "transport_state_files": transport_state[:100],
    }
    (REPORT_DIR / "scan.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def write_summary(distribution: dict, extraction: dict | None, scan: dict | None, probes: list[dict]) -> None:
    lines = ["# NetEase DD / Beibei static bridge forensic", ""]
    if not distribution.get("ok"):
        lines += ["## Result", "", "STATUS: HARD_BLOCKER_DISTRIBUTION_NOT_RESOLVED", f"Reason: {distribution.get('reason')}", "", "Top probed official-page candidates:"]
        for p in probes[:15]:
            lines.append(f"- score={p.get('score')} binary={p.get('binary')} magic={p.get('magic')} source={p.get('source')} url={p.get('url')} final={p.get('final_url')} error={p.get('error','')}")
    else:
        lines += [
            "## Official distribution",
            "",
            f"- source asset: {distribution.get('source_asset')}",
            f"- source URL: {distribution.get('source_url')}",
            f"- final URL: {distribution.get('final_url')}",
            f"- bytes: {distribution.get('size')}",
            f"- SHA-256: {distribution.get('sha256')}",
            f"- magic: {distribution.get('magic')}",
            "",
            "## Extraction",
            "",
            f"- root extraction: {bool(extraction and extraction.get('root',{}).get('ok'))}",
            f"- extracted file count: {(extraction or {}).get('file_count',0)}",
            f"- extracted bytes: {(extraction or {}).get('total_size',0)}",
            "",
            "## Static scan",
            "",
            f"- files scanned: {(scan or {}).get('files_scanned',0)}",
            f"- category file counts: {json.dumps((scan or {}).get('category_file_counts',{}), ensure_ascii=False)}",
            f"- exact loopback URLs: {json.dumps((scan or {}).get('exact_loopback_urls',[])[:50], ensure_ascii=False)}",
            f"- named pipes: {json.dumps((scan or {}).get('named_pipes',[])[:50], ensure_ascii=False)}",
            f"- custom schemes: {json.dumps((scan or {}).get('custom_schemes',[])[:50], ensure_ascii=False)}",
            f"- GAME+TRANSPORT+STATE files: {len((scan or {}).get('game_transport_state_files',[]))}",
            f"- TRANSPORT+STATE files: {len((scan or {}).get('transport_state_files',[]))}",
        ]
        if scan and scan.get("game_transport_state_files"):
            lines += ["", "### Decisive co-occurrence candidates"]
            for x in scan["game_transport_state_files"][:30]:
                lines.append(f"- {x['path']} :: {','.join(x['categories'])}")
        elif extraction and not extraction.get("root", {}).get("ok"):
            lines += ["", "STATUS: HARD_BLOCKER_DISTRIBUTION_PACKAGING_NOT_EXTRACTABLE_STATICALLY"]
        else:
            lines += ["", "STATUS: NO_PROVEN_USABLE_LOCAL_BRIDGE_YET"]
    (REPORT_DIR / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def print_focus(scan: dict | None) -> None:
    summary = (REPORT_DIR / "summary.md").read_text(encoding="utf-8")
    print("\n===== DD FORENSIC SUMMARY =====\n" + summary)
    if not scan:
        return
    decisive_paths = {x["path"] for x in scan.get("game_transport_state_files", [])}
    transport_paths = {x["path"] for x in scan.get("transport_state_files", [])[:20]}
    focus = decisive_paths | transport_paths
    if not focus:
        return
    print("===== FOCUSED HIT CONTEXTS =====")
    shown = 0
    with (REPORT_DIR / "hits.tsv").open(encoding="utf-8", errors="ignore") as f:
        next(f, None)
        for line in f:
            cols = line.rstrip("\n").split("\t", 3)
            if len(cols) != 4:
                continue
            cat, path, match, ctx = cols
            if path in focus and cat in {"game", "loopback", "websocket", "ipc", "browser_bridge", "state", "protocol"}:
                print(f"[{cat}] {path}\n  match={match}\n  context={ctx[:600]}")
                shown += 1
                if shown >= 120:
                    break


def main() -> int:
    log(f"root={ROOT}")
    chosen, fetched, probes = discover()
    log(f"fetched official/reference assets={len(fetched)}; probes={len(probes)}")
    distribution = download_distribution(chosen)
    (REPORT_DIR / "distribution.json").write_text(json.dumps(distribution, ensure_ascii=False, indent=2), encoding="utf-8")
    if not distribution.get("ok"):
        write_summary(distribution, None, None, probes)
        print_focus(None)
        return 0

    log(f"downloaded distribution bytes={distribution['size']} sha256={distribution['sha256']} path={distribution['path']}")
    dist = Path(distribution["path"])
    extraction = recursive_extract(dist)
    log(f"root extraction={extraction.get('root',{}).get('ok')} files={extraction.get('file_count')} bytes={extraction.get('total_size')}")
    scan = static_scan(dist, extraction)
    log(f"scan files={scan.get('files_scanned')} categories={scan.get('category_file_counts')}")
    write_summary(distribution, extraction, scan, probes)
    print_focus(scan)
    return 0


if __name__ == "__main__":
    sys.exit(main())
