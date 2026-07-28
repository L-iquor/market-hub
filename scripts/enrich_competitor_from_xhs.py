import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


ROOT = Path(__file__).resolve().parents[1]
XHS_CLI = ROOT.parent / "xiaohongshu-cli"
BASE_TOKEN = os.environ.get("FEISHU_BASE_TOKEN", "")
TABLE_ID = "tblGpK7czdgjFZbi"
ATTACHMENT_FIELD = "附件"
COMMENT_ATTACHMENT_FIELD = "评论图片"
DOWNLOAD_DIR = ROOT / "xhs-image-cache"
LARK_CLI = str(Path.home() / "AppData" / "Roaming" / "npm" / "lark-cli.cmd")
UV_BIN = str(Path.home() / ".local" / "bin" / "uv.exe")


def run(cmd, cwd=ROOT, timeout=60):
    proc = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}")
    return proc.stdout


def run_json(cmd, cwd=ROOT, timeout=60):
    out = run(cmd, cwd=cwd, timeout=timeout)
    try:
        data = json.loads(out)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid json: {exc}: {out[:300]}") from exc
    if data.get("ok") is False:
        raise RuntimeError(json.dumps(data.get("error") or data, ensure_ascii=False))
    return data


def with_tmp_json(prefix, payload, fn):
    tmp_dir = ROOT / ".tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    name = f"{prefix}-{int(time.time() * 1000)}.json"
    path = tmp_dir / name
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    try:
        return fn(f"@.tmp/{name}")
    finally:
        try:
            path.unlink()
        except Exception:
            pass


def xhs_extract_url(cell):
    text = str(cell or "")
    match = re.search(r"https?://[^\s,)，）]+", text)
    return match.group(0) if match else ""


def scan_records(limit=None, target_ids=None):
    records = []
    remaining = set(target_ids or [])
    offset = 0
    while True:
        data = run_json([
            LARK_CLI, "base", "+record-list",
            "--base-token", BASE_TOKEN,
            "--table-id", TABLE_ID,
            "--field-id", "地址贴这里",
            "--field-id", "笔记地址",
            "--field-id", "附件",
            "--field-id", "附件地址",
            "--field-id", "热点来源",
            "--field-id", "评论文字",
            "--field-id", "评论图片",
            "--limit", "100",
            "--offset", str(offset),
            "--format", "json",
            "--as", "user",
        ], timeout=45)
        body = data.get("data") or {}
        fields = body.get("fields") or []
        rows = body.get("data") or []
        ids = body.get("record_id_list") or []
        idx = {name: fields.index(name) for name in fields}
        for record_id, row in zip(ids, rows):
            url = xhs_extract_url(row[idx["地址贴这里"]]) if "地址贴这里" in idx else ""
            if not url and "笔记地址" in idx:
                url = xhs_extract_url(row[idx["笔记地址"]])
            attachments = row[idx["附件"]] if "附件" in idx else []
            hotspot = str(row[idx["热点来源"]] or "") if "热点来源" in idx else ""
            comment_text = str(row[idx["评论文字"]] or "") if "评论文字" in idx else ""
            comment_images = row[idx["评论图片"]] if "评论图片" in idx else []
            extra = {"has_comments": bool(comment_text.strip()), "has_comment_images": bool(comment_images)}
            if target_ids:
                if record_id in remaining and url:
                    records.append({"id": record_id, "url": url, "has_attachments": bool(attachments), **extra})
                    remaining.discard(record_id)
            elif url and hotspot and not attachments:
                records.append({"id": record_id, "url": url, "has_attachments": bool(attachments), **extra})
            if limit and len(records) >= limit:
                return records
            if target_ids and not remaining:
                return records
        if not body.get("has_more"):
            break
        offset += 100
    return records


def list_candidate_records(limit):
    return scan_records(limit=limit)


def list_records_by_ids(ids):
    return scan_records(target_ids=ids)


def xhs_read(url):
    return run_json([UV_BIN, "run", "xhs", "read", url, "--json"], cwd=XHS_CLI, timeout=75)


def xhs_comments(url):
    return run_json([UV_BIN, "run", "xhs", "comments", url, "--all", "--json"], cwd=XHS_CLI, timeout=120)


def first_note_card(payload):
    for item in ((payload.get("data") or {}).get("items") or []):
        if item.get("model_type") == "note":
            return item.get("note_card") or {}
    return {}


def image_urls(card):
    urls = []
    seen = set()
    for image in card.get("image_list") or []:
        candidates = [image.get("url_default"), image.get("url_pre"), image.get("url")]
        for info in image.get("info_list") or []:
            if info.get("image_scene") == "WB_DFT":
                candidates.insert(0, info.get("url"))
            else:
                candidates.append(info.get("url"))
        for url in candidates:
            if not url:
                continue
            url = str(url).replace("http://", "https://")
            if url not in seen:
                seen.add(url)
                urls.append(url)
                break
    return urls


def fmt_time(ms):
    try:
        ms = int(ms)
    except Exception:
        return ""
    if ms <= 0:
        return ""
    return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M:%S")


ALCOHOL_TERMS = ("酒", "微醺", "低度", "果酒", "调酒", "鸡尾酒", "小酌", "啤酒", "白酒", "葡萄酒", "开瓶", "冰杯", "烧烤")
ATMOSPHERE_TERMS = ("氛围", "巴黎", "旅行", "生活", "美学", "浪漫", "窗边", "餐桌", "松弛", "独居", "随笔", "咖啡")


def classify_card(card, tags):
    text = " ".join([card.get("title") or "", card.get("desc") or "", " ".join(tags)])
    is_video = str(card.get("type") or "").lower() == "video"
    alcohol = any(term in text for term in ALCOHOL_TERMS)
    atmosphere = any(term in text for term in ATMOSPHERE_TERMS)
    angles = []
    if any(term in text for term in ("调酒", "鸡尾酒", "冰杯", "开瓶")):
        angles.append("调酒")
    if atmosphere:
        angles.append("氛围")
    if any(term in text for term in ("生活", "旅行", "日记", "随笔", "巴黎", "松弛")):
        angles.append("生活")
    if any(term in text for term in ("人生", "阶段", "选择", "故事", "困扰", "成为")):
        angles.append("叙事")
    if not angles and alcohol:
        angles.append("生活")

    purposes = []
    if alcohol or atmosphere:
        purposes.append("图片参考")
    if len(card.get("desc") or "") >= 80:
        purposes.append("文案参考")
    if atmosphere and not alcohol:
        purposes.append("文字封面参考")
    if alcohol or any(term in text for term in ("产品", "巴黎水", "小彩罐", "餐桌", "冰杯")):
        purposes.append("可直接换图")

    return {
        "作品分类": "视频" if is_video else "文案",
        "发布者类型": "KOC",
        "品牌": ["低度酒"] if alcohol else ["其它品牌"],
        "发表角度": list(dict.fromkeys(angles))[:3],
        "参考用途": list(dict.fromkeys(purposes))[:4],
    }


def download_images(record_id, urls, max_images):
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    local_files = []
    for i, url in enumerate(urls[:max_images], 1):
        target = DOWNLOAD_DIR / f"{record_id}-{i:02d}.webp"
        req = Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.xiaohongshu.com/"})
        with urlopen(req, timeout=30) as resp:
            target.write_bytes(resp.read())
        local_files.append(target.relative_to(ROOT).as_posix())
    return local_files


def update_record(record_id, card, urls):
    tags = []
    for tag in card.get("tag_list") or []:
        name = tag.get("name") or tag.get("tag_name")
        if name:
            tags.append(str(name))
    interact = card.get("interact_info") or {}
    def count(name):
        try:
            return int(interact.get(name) or 0)
        except Exception:
            return 0
    patch = {
        "笔记ID": card.get("note_id") or "",
        "笔记标题": card.get("title") or "",
        "笔记内容": card.get("desc") or "",
        "笔记标签": " ".join(f"#{tag}" for tag in tags),
        "笔记发布日期": fmt_time(card.get("time")),
        "笔记更新日期": fmt_time(card.get("last_update_time")),
        "附件地址": "\n".join(urls),
        "点赞数": count("liked_count"),
        "收藏数": count("collected_count"),
        "评论数": count("comment_count"),
        "分享数": count("share_count"),
        **classify_card(card, tags),
    }
    with_tmp_json("competitor-update", patch, lambda json_arg: run_json([
        LARK_CLI, "base", "+record-upsert",
        "--base-token", BASE_TOKEN,
        "--table-id", TABLE_ID,
        "--record-id", record_id,
        "--json", json_arg,
        "--as", "user",
    ], timeout=45))


def upload_attachments(record_id, files, field=ATTACHMENT_FIELD):
    if not files:
        return
    cmd = [
        LARK_CLI, "base", "+record-upload-attachment",
        "--base-token", BASE_TOKEN,
        "--table-id", TABLE_ID,
        "--record-id", record_id,
        "--field-id", field,
        "--as", "user",
    ]
    for file in files:
        cmd.extend(["--file", file])
    run_json(cmd, timeout=120)


def effective_comments(payload, limit=10):
    all_comments = []
    for comment in ((payload.get("data") or {}).get("comments") or []):
        all_comments.append(comment)
        all_comments.extend(comment.get("sub_comments") or [])
    rows = []
    for comment in all_comments:
        text = str(comment.get("content") or "").strip()
        pictures = comment.get("pictures") or []
        if len(text) < 15 or not pictures:
            continue
        urls = []
        for picture in pictures:
            url = picture.get("url_default") or picture.get("url_pre")
            if url:
                urls.append(str(url).replace("http://", "https://"))
        if urls:
            try:
                likes = int(comment.get("like_count") or 0)
            except Exception:
                likes = 0
            rows.append({"text": text, "likes": likes, "urls": urls})
    rows.sort(key=lambda item: (-item["likes"], -len(item["text"])))
    return rows[:max(1, limit)]


def download_comment_images(record_id, comments):
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for i, comment in enumerate(comments, 1):
        # Keep one representative image per effective comment so text/image remain paired.
        url = comment["urls"][0]
        target = DOWNLOAD_DIR / f"{record_id}-comment-{i:02d}.webp"
        req = Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.xiaohongshu.com/"})
        with urlopen(req, timeout=30) as resp:
            target.write_bytes(resp.read())
        files.append(target.relative_to(ROOT).as_posix())
    return files


def update_comments(record_id, comments):
    text = "\n\n".join(f"{i}. {item['text']}" for i, item in enumerate(comments, 1))
    with_tmp_json("competitor-comments", {"评论文字": text}, lambda json_arg: run_json([
        LARK_CLI, "base", "+record-upsert",
        "--base-token", BASE_TOKEN,
        "--table-id", TABLE_ID,
        "--record-id", record_id,
        "--json", json_arg,
        "--as", "user",
    ], timeout=45))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--max-images", type=int, default=9)
    parser.add_argument("--max-comments", type=int, default=10)
    parser.add_argument("--record-ids", default="", help="Comma-separated Feishu record ids to enrich")
    args = parser.parse_args()

    explicit_ids = [x.strip() for x in args.record_ids.split(",") if x.strip()]
    records = list_records_by_ids(explicit_ids) if explicit_ids else list_candidate_records(max(1, args.limit))
    results = []
    for rec in records:
        try:
            payload = xhs_read(rec["url"])
            card = first_note_card(payload)
            urls = image_urls(card)
            update_record(rec["id"], card, urls)
            files = []
            if not rec.get("has_attachments"):
                files = download_images(rec["id"], urls, max(1, args.max_images))
                upload_attachments(rec["id"], files)
            comment_rows = []
            comment_files = []
            if not (rec.get("has_comments") and rec.get("has_comment_images")):
                comment_rows = effective_comments(xhs_comments(rec["url"]), args.max_comments)
                if comment_rows:
                    update_comments(rec["id"], comment_rows)
                    if not rec.get("has_comment_images"):
                        comment_files = download_comment_images(rec["id"], comment_rows)
                        upload_attachments(rec["id"], comment_files, COMMENT_ATTACHMENT_FIELD)
            results.append({"id": rec["id"], "ok": True, "images": len(files), "comments": len(comment_rows), "comment_images": len(comment_files), "title": card.get("title") or ""})
            time.sleep(1.2)
        except Exception as exc:
            results.append({"id": rec["id"], "ok": False, "error": str(exc)[:500]})
    print(json.dumps({"ok": True, "processed": len(results), "results": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
