#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import urllib.parse
from collections import deque
from pathlib import Path

import netease_dd_static as base

ROOT = os.environ.get("DD_ROOT", "https://dd.163.com/")
ROOT_ORIGIN = urllib.parse.urlunsplit((*urllib.parse.urlsplit(ROOT)[:2], "", "", ""))
REPORT_DIR = base.REPORT_DIR
MAX_CRAWL = 140
TOKENS = [
    "get_channel_download_link",
    "setDownloadContext",
    "teamchannelpkg",
    "mixteamversion",
    "dd-link",
    "http://localhost",
    "https://localhost",
    "ws://",
    "wss://",
    "WebSocket",
    "QLocalSocket",
    "NamedPipe",
    "ipcRenderer",
    "contextBridge",
    "cefQuery",
    "chrome.webview",
    "position",
    "coordinate",
    "coords",
    "map_id",
    "scene_id",
    "Where Winds Meet",
    "wherewindsmeet",
    "燕云十六声",
    "Yanyun",
    "yysl",
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
        # Root-relative URLs embedded inside CDN-hosted JS execute in the page's
        # origin, not the CDN asset origin. The old crawler incorrectly joined
        # these against static.dd.163.com, hiding official /v1 download APIs.
        if source_host != root_host:
            return base.clean_url(raw, ROOT_ORIGIN + "/"), "page-origin-root-relative"
        return base.clean_url(raw, source_url), "source-origin-root-relative"
    return base.clean_url(raw, source_url), "relative"


def snippet(text: str, needle: str, radius: int = 1400) -> str:
    pos = text.lower().find(needle.lower())
    if pos < 0:
        return ""
    s = max(0, pos - radius)
    e = min(len(text), pos + len(needle) + radius)
    return re.sub(r"[\r\n\t]+", " ", text[s:e])


def main() -> int:
    q = deque([(ROOT, None, 0)])
    seen: set[str] = set()
    fetched: list[dict] = []
    edges: list[dict] = []
    contexts: list[dict] = []
    all_refs: dict[str, dict] = {}

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
        for tok in TOKENS:
            if tok.lower() in text.lower():
                contexts.append({"source": url, "token": tok, "context": snippet(text, tok)})
        for raw in raw_refs(text):
            child, mode = resolve_ref(raw, res.get("final_url", url))
            if not child:
                continue
            edge = {"from": url, "raw": raw, "to": child, "resolution": mode}
            edges.append(edge)
            all_refs.setdefault(child, edge)
            if depth < 2 and base.likely_text_asset(child):
                q.append((child, url, depth + 1))

    # Explicitly GET corrected official API endpoints. GET is read-only; do not
    # POST or mutate any server/client state in this forensic stage.
    corrected_apis = [
        urllib.parse.urljoin(ROOT_ORIGIN + "/", "v1/teamchannelpkg/get_channel_download_link"),
        urllib.parse.urljoin(ROOT_ORIGIN + "/", "v1/mixteamversion/setDownloadContext"),
    ]
    api_gets: list[dict] = []
    response_refs: dict[str, dict] = {}
    for api in corrected_apis:
        res = base.fetch_small(api)
        meta = {k: v for k, v in res.items() if k != "data"}
        if res.get("ok"):
            text = res["data"].decode("utf-8", "ignore")
            meta["body_prefix"] = text[:12000]
            for raw in raw_refs(text):
                child, mode = resolve_ref(raw, res.get("final_url", api))
                if child:
                    response_refs.setdefault(child, {"url": child, "source": api, "resolution": mode})
        api_gets.append(meta)

    candidates: list[dict] = []
    for u, edge in {**all_refs, **response_refs}.items():
        if isinstance(edge, dict) and "url" in edge:
            source = edge.get("source", "")
        else:
            source = edge.get("from", "")
        score = base.candidate_score(u, source)
        if score >= 55:
            candidates.append({"url": u, "source": source, "score": score})
    candidates.sort(key=lambda x: x["score"], reverse=True)

    probes: list[dict] = []
    chosen: dict = {}
    for c in candidates[:50]:
        p = base.probe(c["url"])
        p.update(c)
        probes.append(p)
        if p.get("ok") and p.get("binary") and (not chosen or c["score"] > chosen.get("score", -999)):
            chosen = p.copy()

    result = {
        "root": ROOT,
        "root_origin": ROOT_ORIGIN,
        "fetched_count": len(fetched),
        "fetched": fetched,
        "corrected_root_relative_edges": [e for e in edges if e["resolution"] == "page-origin-root-relative"],
        "api_gets": api_gets,
        "contexts": contexts,
        "candidate_count": len(candidates),
        "candidates": candidates,
        "probes": probes,
        "chosen_probe": chosen,
    }
    (REPORT_DIR / "resolver.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print("===== DD RESOLVER =====")
    print(f"fetched={len(fetched)} corrected_edges={len(result['corrected_root_relative_edges'])} candidates={len(candidates)} probes={len(probes)}")
    print("-- corrected API GETs --")
    for r in api_gets:
        print(json.dumps(r, ensure_ascii=False))
    print("-- high-signal contexts --")
    for row in contexts[:80]:
        if row["token"] in {"get_channel_download_link", "setDownloadContext", "http://localhost", "ws://", "wss://", "WebSocket", "position", "Where Winds Meet", "燕云十六声", "yysl"}:
            print(json.dumps(row, ensure_ascii=False))
    print("-- candidate probes --")
    for row in probes[:30]:
        print(json.dumps(row, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
