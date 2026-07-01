import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parent
XHS_CLI = ROOT.parent / "xiaohongshu-cli"
OUTPUT = ROOT / "topic-signals.json"
CONFIG_PATH = ROOT / "topic-config.json"

DEFAULT_CONFIG = {
    "cacheHours": 12,
    "seeds": ["低度酒", "果酒推荐", "女生喝什么酒", "烧烤喝什么", "微醺"],
    "sources": {
        "homeFeed": True,
        "keywordSearch": True,
        "topicSearch": True,
        "crossPlatform": True,
        "savedResearchFallback": True,
    },
}
TOPHUB_CHANNELS = ("微博", "知乎", "小红书", "抖音", "哔哩哔哩", "百度")


def load_config():
    config = json.loads(json.dumps(DEFAULT_CONFIG, ensure_ascii=False))
    try:
        incoming = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return config
    if isinstance(incoming.get("cacheHours"), (int, float)):
        config["cacheHours"] = max(0.25, min(float(incoming["cacheHours"]), 24))
    seeds = incoming.get("seeds")
    if isinstance(seeds, list):
        cleaned = [str(seed).strip() for seed in seeds if str(seed).strip()]
        if cleaned:
            config["seeds"] = cleaned[:20]
    sources = incoming.get("sources")
    if isinstance(sources, dict):
        for key in config["sources"]:
            if key in sources:
                config["sources"][key] = bool(sources[key])
    return config


def run_xhs(*args):
    command = ["uv", "run", "xhs", *args, "--json"]
    proc = subprocess.run(
        command,
        cwd=XHS_CLI,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    time.sleep(1.5)
    if proc.returncode:
        return {"ok": False, "error": proc.stderr.strip() or proc.stdout.strip()}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"invalid xhs json: {exc}"}


def check_xhs_status():
    try:
        return run_xhs("status")
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def ensure_xhs_authenticated(wait_seconds=120):
    status = check_xhs_status()
    user = ((status or {}).get("data") or {}).get("user") or {}
    authenticated = bool((status or {}).get("ok")) and bool((status or {}).get("data", {}).get("authenticated"))
    guest = bool(user.get("guest"))
    if authenticated and not guest:
        return {"ok": True, "status": status, "needs_login": False}

    helper = ROOT / "scripts" / "xhs-login-qrcode.ps1"
    if helper.exists():
        try:
            subprocess.Popen(
                [
                    "powershell",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(helper),
                ],
                cwd=str(ROOT),
            )
        except Exception:
            pass

    deadline = time.time() + max(30, int(wait_seconds))
    last = status
    while time.time() < deadline:
        time.sleep(5)
        last = check_xhs_status()
        user = ((last or {}).get("data") or {}).get("user") or {}
        authenticated = bool((last or {}).get("ok")) and bool((last or {}).get("data", {}).get("authenticated"))
        guest = bool(user.get("guest"))
        if authenticated and not guest:
            return {"ok": True, "status": last, "needs_login": False}

    return {"ok": False, "status": last, "needs_login": True, "error": "xhs_login_required"}


def count(value):
    text = str(value or "0").strip().replace(",", "")
    multiplier = 1
    if text.endswith("万"):
        multiplier, text = 10000, text[:-1]
    elif text.endswith("亿"):
        multiplier, text = 100000000, text[:-1]
    try:
        return int(float(text) * multiplier)
    except ValueError:
        return 0


def cover_url(card):
    for item in (card.get("cover") or {}).get("info_list") or []:
        if item.get("url"):
            return item["url"].replace("http://", "https://")
    return ""

ALCOHOL_TERMS = (
    "酒", "微醺", "低度", "果酒", "调酒", "鸡尾酒", "小酌", "酒单", "酒鬼",
    "啤酒", "白酒", "清酒", "梅酒", "金酒", "威士忌", "葡萄酒", "莫斯卡托",
    "烧烤", "烤串", "撸串", "夜宵", "聚会", "开瓶", "冰杯", "气泡", "青提", "菠萝",
)
ATMOSPHERE_TERMS = (
    "氛围", "松弛", "生活", "美学", "旅行", "巴黎", "咖啡", "餐桌", "窗边",
    "晚风", "夜晚", "独居", "vlog", "浪漫", "随笔", "小彩罐", "饮料", "水",
)
NEGATIVE_TERMS = (
    "找工作", "双休", "简历", "超自然", "小说", "求推荐", "管理岗", "性情大变",
    "掉称", "减肥", "减脂", "讨好", "戒掉", "工资", "上岸", "考研",
)


def relevance_score(title, desc="", tags=None, keyword=""):
    body = " ".join([str(title or ""), str(desc or ""), " ".join(tags or [])]).lower()
    score = 0
    if keyword and keyword.lower() in body:
        score += 2
    score += sum(2 for term in ALCOHOL_TERMS if term.lower() in body)
    score += sum(1 for term in ATMOSPHERE_TERMS if term.lower() in body)
    score -= sum(4 for term in NEGATIVE_TERMS if term.lower() in body)
    return score


def note_tags(card):
    tags = []
    for tag in card.get("tag_list") or []:
        name = tag.get("name") or tag.get("tag_name")
        if name:
            tags.append(str(name))
    return tags


def notes_from(payload, source, keyword=""):
    notes = []
    hot_queries = []
    data = payload.get("data") or {}
    for item in data.get("items") or []:
        if item.get("model_type") == "hot_query":
            for query in (item.get("hot_query") or {}).get("queries") or []:
                word = query.get("search_word") or query.get("name")
                if word:
                    hot_queries.append(word)
            continue
        if item.get("model_type") != "note":
            continue
        card = item.get("note_card") or {}
        xsec_token = item.get("xsec_token") or card.get("xsec_token") or ""
        xsec_source = item.get("xsec_source") or source.replace("xhs_", "pc_")
        title = card.get("display_title") or card.get("title") or ""
        if not title:
            continue
        desc = card.get("desc") or ""
        tags = note_tags(card)
        relevance = relevance_score(title, desc, tags, keyword)
        if keyword and relevance < 2:
            continue
        interact = card.get("interact_info") or {}
        notes.append({
            "id": item.get("id", ""),
            "xsec_token": xsec_token,
            "xsec_source": xsec_source,
            "title": title,
            "desc": desc,
            "type": card.get("type") or "",
            "tags": tags,
            "relevance": relevance,
            "keyword": keyword,
            "source": source,
            "likes": count(interact.get("liked_count")),
            "collects": count(interact.get("collected_count")),
            "comments": count(interact.get("comment_count")),
            "cover": cover_url(card),
            "author": (card.get("user") or {}).get("nickname", ""),
        })
    return notes, hot_queries


def fetch_tophub():
    try:
        response = requests.get(
            "https://tophub.today/",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=20,
        )
        response.raise_for_status()
    except Exception as exc:
        return [], str(exc)

    soup = BeautifulSoup(response.text, "html.parser")
    rows = []
    for block in soup.select(".cc-cd"):
        label = block.select_one(".cc-cd-lb")
        platform = label.get_text(" ", strip=True) if label else ""
        if not any(name in platform for name in TOPHUB_CHANNELS):
            continue
        for rank, item in enumerate(block.select(".cc-cd-cb-ll")[:12], 1):
            title_node = item.select_one(".t")
            heat_node = item.select_one(".e")
            link_node = item.select_one("a")
            title = title_node.get_text(" ", strip=True) if title_node else ""
            if title:
                rows.append({
                    "title": title,
                    "platform": re.split(r"\s+[·|]", platform)[0],
                    "rank": rank,
                    "heat": heat_node.get_text(" ", strip=True) if heat_node else "",
                    "url": link_node.get("href", "") if link_node else "",
                })
    return rows[:80], ""


def topic_rows(payload, keyword):
    rows = []
    for topic in (payload.get("data") or {}).get("topic_info_dtos") or []:
        name = topic.get("name") or ""
        if name:
            rows.append({
                "keyword": keyword,
                "name": name,
                "views": count(topic.get("view_num")),
                "link": topic.get("link", ""),
            })
    return rows


def load_previous():
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except Exception:
        return {}


def load_legacy_research():
    files = sorted(ROOT.parent.glob("xhs_topic_research_*.json"), reverse=True)
    for file in files:
        try:
            data = json.loads(file.read_text(encoding="utf-8"))
            if not data.get("top_notes") and not data.get("top_topics"):
                continue
            notes = []
            for row in data.get("top_notes") or []:
                notes.append({
                    "id": row.get("note_id", ""),
                    "title": row.get("title", ""),
                    "keyword": row.get("keyword", ""),
                    "source": "xhs_saved_research",
                    "likes": row.get("liked", 0),
                    "collects": row.get("collected", 0),
                    "comments": row.get("comments", 0),
                    "cover": "",
                    "author": row.get("author", ""),
                })
            topics = [{
                "keyword": row.get("keyword", ""),
                "name": row.get("name", ""),
                "views": row.get("view_num", 0),
                "link": row.get("link", ""),
            } for row in data.get("top_topics") or []]
            queries = [row[0] for row in data.get("hot_query_counter") or [] if row]
            return notes, topics, queries
        except Exception:
            continue
    return [], [], []


def main():
    config = load_config()
    seeds = config["seeds"]
    sources = config["sources"]
    previous = load_previous()
    auth = ensure_xhs_authenticated(wait_seconds=90)
    if not auth["ok"]:
        result = {
            "ok": False,
            "error": "XHS 登录态未就绪，已尝试打开登录助手，请先扫码后重跑。",
            "details": auth,
        }
        OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False))
        return
    reuse_saved = os.environ.get("TOPIC_REUSE_SAVED") == "1"
    skip_search = os.environ.get("TOPIC_SKIP_SEARCH") == "1"
    feed_payload = {"ok": False} if reuse_saved or not sources.get("homeFeed", True) else run_xhs("feed")
    feed_notes, _ = notes_from(feed_payload, "xiaohongshu_home") if feed_payload.get("ok") else ([], [])

    searches = []
    topics = []
    hot_queries = []
    errors = []
    for seed in ([] if reuse_saved or skip_search else seeds):
        if sources.get("keywordSearch", True):
            for sort in ("popular", "latest"):
                payload = run_xhs("search", seed, "--sort", sort)
                if payload.get("ok"):
                    notes, queries = notes_from(payload, f"xhs_{sort}", seed)
                    searches.extend(notes[:12])
                    hot_queries.extend(queries)
                else:
                    errors.append(f"{seed}/{sort}: {payload.get('error', 'failed')}")
        if sources.get("topicSearch", True):
            payload = run_xhs("topics", seed)
            if payload.get("ok"):
                topics.extend(topic_rows(payload, seed))

    cross_platform, tophub_error = fetch_tophub() if sources.get("crossPlatform", True) else ([], "")
    if tophub_error:
        errors.append(f"tophub: {tophub_error}")

    searches.sort(key=lambda row: row["likes"] + row["collects"] * 2 + row["comments"] * 3, reverse=True)
    topics.sort(key=lambda row: row["views"], reverse=True)
    feed_notes.sort(key=lambda row: row["likes"], reverse=True)

    legacy_notes, legacy_topics, legacy_queries = load_legacy_research() if sources.get("savedResearchFallback", True) else ([], [], [])
    if not feed_notes:
        feed_notes = previous.get("homeFeed") or []
    if not searches:
        searches = previous.get("searchNotes") or legacy_notes
    if not topics:
        topics = previous.get("topics") or legacy_topics
    if not hot_queries:
        hot_queries = previous.get("hotQueries") or legacy_queries
    if not cross_platform:
        cross_platform = previous.get("crossPlatform") or []

    result = {
        "schemaVersion": 1,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "skills": {
            "xiaohongshu-ops": {"ok": bool(feed_notes), "samples": len(feed_notes)},
            "xhs-content-plan": {"ok": bool(searches), "samples": len(searches)},
            "inkroam-topic-expert": {"ok": bool(cross_platform), "samples": len(cross_platform)},
        },
        "config": config,
        "seeds": seeds,
        "homeFeed": feed_notes[:20],
        "searchNotes": searches[:60],
        "hotQueries": list(dict.fromkeys(hot_queries))[:40],
        "topics": topics[:40],
        "crossPlatform": cross_platform,
        "errors": errors,
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "path": str(OUTPUT), "counts": {
        "home": len(result["homeFeed"]),
        "search": len(result["searchNotes"]),
        "topics": len(result["topics"]),
        "cross": len(result["crossPlatform"]),
    }}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
