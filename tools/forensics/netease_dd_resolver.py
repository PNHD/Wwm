#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.parse
from collections import deque
from pathlib import Path

import netease_dd_static as base

ROOT = os.environ.get("DD_ROOT", "https://dd.163.com/")
ROOT_ORIGIN = urllib.parse.urlunsplit((*urllib.parse.urlsplit(ROOT)[:2], "", "", ""))
API_BASE = "https://appapi.cc.163.com"
DOWNLOAD_API = API_BASE + "/v1/teamchannelpkg/get_channel_download_link?channel="
REPORT_DIR = base.REPORT_DIR
SOURCE_DIR = REPORT_DIR / "fetched-text"
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
MAX_CRAWL = 140
TOKENS = [
    "get_channel_download_link", "setDownloadContext", "teamchannelpkg", "mixteamversion",
    "90111", "75609", "baseURL", "axios.create", ".create({", "appapi.cc.163.com",
    "gameyw.netease.com", "dd-link", "CCLink", "WebLink", "SharedWorker",
    "teamlink-ws.cc.163.com", "http://localhost", "https://localhost", "127.0.0.1",
    "ws://", "wss://", "WebSocket", "QLocalSocket", "QLocalServer", "NamedPipe",
    "CreateNamedPipe", "ipcRenderer", "ipcMain", "contextBridge", "cefQuery",
    "chrome.webview", "WebView2", "position", "coordinate", "coords", "map_id",
    "scene_id", "Where Winds Meet", "wherewindsmeet", "燕云十六声", "Yanyun", "yysl",
]


def raw_refs(text: str) -> list[str]:
    text = base.normalize_js_text(text)
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
            raw = raw.strip().strip("'\"`()[]{};,\\")
            if raw and not raw.startswith(("javascript:", "data:", "mailto:", "#")):
                found.add(raw)
    return sorted(found)


def resolve_ref(raw: str, source_url: str) -> tuple[str | None, str]:
    raw = raw.replace("\\/", "/")
    if raw.startswith("//"):
        raw = "https:" + raw
    if raw.startswith(("http://", "https://")):
        return base.clean_url(raw, source_url), "absolute"
    if raw.startswith("/"):
        source_host = urllib.parse.urlsplit(source_url).netloc.lower()
        root_host = urllib.parse.urlsplit(ROOT).netloc.lower()
        if source_host != root_host:
            return base.clean_url(raw, ROOT_ORIGIN + "/"), "page-origin-root-relative"
        return base.clean_url(raw, source_url), "source-origin-root-relative"
    return base.clean_url(raw, source_url), "relative"


def contexts_for(text: str, needle: str, radius: int = 1800, limit: int = 12) -> list[str]:
    out: list[str] = []
    lower = text.lower()
    n = needle.lower()
    pos = 0
    while len(out) < limit:
        i = lower.find(n, pos)
        if i < 0:
            break
        s = max(0, i - radius)
        e = min(len(text), i + len(needle) + radius)
        out.append(re.sub(r"[\r\n\t]+", " ", text[s:e]))
        pos = i + max(1, len(needle))
    return out


def should_snapshot(url: str, ctype: str) -> bool:
    host = urllib.parse.urlsplit(url).netloc.lower()
    if host not in {"dd.163.com", "static.dd.163.com", "cc.res.netease.com"}:
        return False
    return any(x in ctype for x in ("text", "javascript", "json", "xml")) or base.likely_text_asset(url)


def save_snapshot(url: str, text: str) -> dict:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    name = Path(urllib.parse.urlsplit(url).path).name or "index"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:90]
    dest = SOURCE_DIR / f"{digest}-{safe}.txt"
    dest.write_text(text, encoding="utf-8")
    return {"url": url, "path": str(dest.relative_to(REPORT_DIR)), "bytes": len(text.encode("utf-8"))}


def resolve_download_api() -> tuple[dict, dict]:
    """Resolve official desktop download using the exact read-only frontend GET."""
    res = base.fetch_small(DOWNLOAD_API)
    audit = {k: v for k, v in res.items() if k != "data"}
    audit.update({
        "method": "GET",
        "base_url_evidence": "module 90111 axios baseURL=o.Ld; module 75609 Ld=https://appapi.cc.163.com",
        "request_url": DOWNLOAD_API,
        "query": {"channel": ""},
    })
    if not res.get("ok"):
        audit["result"] = "FETCH_FAILED"
        return {}, audit
    body = res["data"].decode("utf-8", "ignore")
    audit["body_prefix"] = body[:16000]
    try:
        payload = json.loads(body)
    except Exception as e:
        audit["result"] = "INVALID_JSON"
        audit["parse_error"] = repr(e)
        return {}, audit
    audit["response"] = payload
    if payload.get("code") != 0 or not isinstance(payload.get("data"), dict):
        audit["result"] = "API_ERROR"
        return {}, audit
    data = payload["data"]
    url = data.get("x64_download_link") or data.get("x32_download_link")
    if not url:
        audit["result"] = "NO_DESKTOP_LINK"
        return {}, audit
    p = base.probe(url)
    p.update({"source": DOWNLOAD_API, "score": 1000, "api_field": "x64_download_link" if data.get("x64_download_link") else "x32_download_link"})
    audit["result"] = "RESOLVED"
    audit["selected_url"] = url
    audit["probe"] = p
    return p, audit


def main() -> int:
    q = deque([(ROOT, None, 0)])
    seen: set[str] = set()
    fetched: list[dict] = []
    edges: list[dict] = []
    contexts: list[dict] = []
    snapshots: list[dict] = []

    while q and len(seen) < MAX_CRAWL:
        url, parent, depth = q.popleft()
        if url in seen:
            continue
        seen.add(url)
        res = base.fetch_small(url)
        meta = {k: v for k, v in res.items() if k != "data"}
        meta.update({"parent": parent, "depth": depth})
        fetched.append(meta)
        if not res.get("ok"):
            continue
        data = res["data"]
        ctype = res.get("content_type", "").lower()
        if base.magic_kind(data) != "unknown" and url != ROOT:
            continue
        if not ("text" in ctype or "json" in ctype or "javascript" in ctype or "xml" in ctype or base.likely_text_asset(url) or url == ROOT):
            continue
        text = data.decode("utf-8", "ignore")
        if should_snapshot(url, ctype):
            snapshots.append(save_snapshot(url, text))
        for tok in TOKENS:
            for idx, ctx in enumerate(contexts_for(text, tok)):
                contexts.append({"source": url, "token": tok, "occurrence": idx + 1, "context": ctx})
        for raw in raw_refs(text):
            child, mode = resolve_ref(raw, res.get("final_url", url))
            if not child:
                continue
            edges.append({"from": url, "raw": raw, "to": child, "resolution": mode})
            if depth < 2 and base.likely_text_asset(child):
                q.append((child, url, depth + 1))

    (SOURCE_DIR / "manifest.json").write_text(json.dumps(snapshots, ensure_ascii=False, indent=2), encoding="utf-8")

    selected, api_audit = resolve_download_api()
    probes = [selected] if selected else []
    distribution = base.download_distribution(selected)
    (REPORT_DIR / "distribution.json").write_text(json.dumps(distribution, ensure_ascii=False, indent=2), encoding="utf-8")

    extraction = None
    scan = None
    if distribution.get("ok"):
        dist = Path(distribution["path"])
        extraction = base.recursive_extract(dist)
        scan = base.static_scan(dist, extraction)
        base.write_summary(distribution, extraction, scan, probes)
    else:
        base.write_summary(distribution, None, None, probes)

    result = {
        "root": ROOT,
        "root_origin": ROOT_ORIGIN,
        "api_base": API_BASE,
        "download_api": api_audit,
        "fetched_count": len(fetched),
        "fetched": fetched,
        "snapshots": snapshots,
        "corrected_root_relative_edges": [e for e in edges if e["resolution"] == "page-origin-root-relative"],
        "contexts": contexts,
        "selected_probe": selected,
        "distribution": distribution,
        "extraction_summary": extraction,
        "scan_summary": scan,
    }
    (REPORT_DIR / "resolver.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print("===== DD RESOLVER =====")
    print(f"fetched={len(fetched)} snapshots={len(snapshots)} contexts={len(contexts)}")
    print("-- exact download API --")
    print(json.dumps(api_audit, ensure_ascii=False))
    print("-- distribution --")
    print(json.dumps(distribution, ensure_ascii=False))
    if extraction is not None:
        print("-- extraction --")
        print(json.dumps({"root": extraction.get("root"), "file_count": extraction.get("file_count"), "total_size": extraction.get("total_size")}, ensure_ascii=False))
    if scan is not None:
        print("-- scan --")
        print(json.dumps(scan, ensure_ascii=False))
        base.print_focus(scan)
    print("-- module/baseURL evidence --")
    for row in contexts:
        if row["token"] in {"90111", "75609", "baseURL", "get_channel_download_link", "appapi.cc.163.com"}:
            print(json.dumps(row, ensure_ascii=False))
    print("-- transport/local evidence --")
    for row in contexts:
        if row["token"] in {"http://localhost", "https://localhost", "127.0.0.1", "ws://", "wss://", "WebSocket", "QLocalSocket", "QLocalServer", "NamedPipe", "CreateNamedPipe", "ipcRenderer", "ipcMain", "contextBridge", "cefQuery", "chrome.webview", "WebView2", "teamlink-ws.cc.163.com"}:
            print(json.dumps(row, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
