#!/usr/bin/env python3
"""扫描本地 data/materials，按内容哈希去重并提取可读标题，生成迁移清单。

背景
----
本地开发机已经没有数据库（postgres 未运行），课程/PPT 的标题、归属、
与课程的关联关系都随数据库一起丢失了；data/materials/ 下只剩裸二进制文件。
要把这些文件恢复成「教师账号素材库里可打开、可编辑、��改名」的素材，
需要重建 owner_material 表的元数据行。本脚本负责产出那张表的输入清单。

注意
----
- 同一个 PPTX 往往在多个 owner 目录下留了副本（历史上每次上传都按新
  materialId 存一份）。同一内容只迁移一份，materialId 复用最早那个，
  避免素材库里出现 5 个一模一样的课件。
- classrooms/*/media/ 下是课程分镜语音（TTS 产物），它们挂在 document_stages
  上而不是 owner_material 上，课程元数据丢失后无法还原归属，因此本脚本不
  收拢它们，只单独统计。

输出
----
    data/materials-migration-manifest.json
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MATERIALS = DATA / "materials"
CLASSROOMS = DATA / "classrooms"
OUT = DATA / "materials-migration-manifest.json"

# 文件头 -> (mime, kind, 扩展名)
SIGNATURES: list[tuple[bytes, str, str, str]] = [
    (b"\x89PNG\r\n\x1a\n", "image/png", "image", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", "image", ".jpg"),
    (b"GIF8", "image/gif", "image", ".gif"),
    (b"%PDF", "application/pdf", "document", ".pdf"),
    (b"\x1aE\xdf\xa3", "video/webm", "media", ".webm"),
]

MIME_EXT = {
    "audio/mpeg": (".mp3", "media"),
    "audio/mp3": (".mp3", "media"),
    "audio/wav": (".wav", "media"),
    "audio/x-wav": (".wav", "media"),
    "audio/mp4": (".m4a", "media"),
    "audio/aac": (".aac", "media"),
    "audio/ogg": (".ogg", "media"),
    "audio/flac": (".flac", "media"),
    "video/mp4": (".mp4", "media"),
}

KIND_LABEL = {"document": "课件", "image": "图片", "media": "音频"}


def kind_label(kind: str) -> str:
    return KIND_LABEL.get(kind, kind)


def isom_has_video_track(path: Path) -> bool:
    """ISO-BMFF 容器里是否存在视频轨。

    遍历 moov 下的trak / mdia / hdlr，handler type 为 'vide' 即有视频。
    这类文件 moov 可能在文件末尾，所以整文件扫描（媒体文件不大，可接受）。
    """
    try:
        blob = path.read_bytes()
    except OSError:
        return True  # 读不出就保守当作视频
    return b"vide" in blob


def sniff(path: Path) -> tuple[str, str, str]:
    """返回 (mime, kind, 扩展名)。无法识别时抛 ValueError。"""
    head = path.read_bytes()[:32]

    for sig, mime, kind, ext in SIGNATURES:
        if head.startswith(sig):
            return mime, kind, ext

    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio/wav", "media", ".wav"

    if head[:4] == b"RIFF" and head[8:12] == b"AVI ":
        return "video/x-msvideo", "media", ".avi"

    if head[:3] == b"ID3" or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg", "media", ".mp3"

    # ISO-BMFF：ftyp 盒在偏移 4
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"M4A ", b"M4A\x00", b"M4B "):
            return "audio/mp4", "media", ".m4a"
        if brand.startswith(b"M4A"):
            return "audio/mp4", "media", ".m4a"
        # mp42/mp41 既可能是视频也可能是「MP4 容器装的纯音频」（课程导出的
        # 音频常这样）。判据是有没有视频轨：只查 moov 里的 hdlr 类型，
        # 视频轨是 'vide'，纯音频则只有 'soun'。
        if brand in (b"mp42", b"mp41", b"isom", b"iso2", b"mp4v", b"avc1", b"M4V "):
            if isom_has_video_track(path):
                return "video/mp4", "media", ".mp4"
            return "audio/mp4", "media", ".m4a"
        return "video/mp4", "media", ".mp4"

    if head[:2] == b"PK":
        try:
            with zipfile.ZipFile(path) as zf:
                names = zf.namelist()
        except zipfile.BadZipFile as exc:
            raise ValueError(f"损坏的 zip/office 文件: {exc}") from exc
        if any(n.startswith("ppt/") for n in names):
            return (
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "document",
                ".pptx",
            )
        if any(n.startswith("word/") for n in names):
            return (
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "document",
                ".docx",
            )
        raise ValueError("zip 但不是 pptx/docx")

    raise ValueError(f"无法识别的格式: {head[:12]!r}")


def pptx_title(path: Path) -> str | None:
    """从 PPTX 抽一个人类可读的标题。

    slide1 往往只是统一的封面页（同一套课件的每一章封面文字完全相同，
    区分不出章节），所以优先用 slide2 里的章节名；没有 slide2 时退回封面，
    再退回 docProps 里的元数据标题。
    """
    try:
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
            core = zf.read("docProps/core.xml").decode("utf-8", "replace") if "docProps/core.xml" in names else ""
    except zipfile.BadZipFile:
        return None

    def texts_of(slide: str) -> list[str]:
        with zipfile.ZipFile(path) as zf:
            xml = zf.read(slide).decode("utf-8", "replace")
        return [t.strip() for t in re.findall(r"<a:t>([^<]+)</a:t>", xml) if t.strip()]

    for slide in ("ppt/slides/slide2.xml", "ppt/slides/slide1.xml"):
        if slide not in names:
            continue
        try:
            texts = texts_of(slide)
        except KeyError:
            continue
        if texts:
            return re.sub(r"\s+", " ", " ".join(texts))[:120]

    m = re.search(r"<dc:title>([^<]+)</dc:title>", core)
    return m.group(1)[:120] if m else None


def main() -> int:
    if not MATERIALS.is_dir():
        print(f"找不到 {MATERIALS}", flush=True)
        return 1

    # content_hash -> 记录。同一内容只留最早出现的（按 mtime 排序保证稳定）。
    candidates: list[dict] = []
    for path in MATERIALS.rglob("*"):
        if not path.is_file():
            continue
        size = path.stat().st_size
        if size < 1024:
            # 5 字节的空壳是测试残留，不迁移
            continue
        rel_owner = path.relative_to(MATERIALS).parts[0]
        candidates.append(
            {
                "path": path,
                "size": size,
                "legacy_owner_dir": rel_owner,
                "mtime": path.stat().st_mtime,
            }
        )

    candidates.sort(key=lambda c: (c["mtime"], str(c["path"])))

    seen: dict[str, dict] = {}
    skipped: list[dict] = []
    for cand in candidates:
        digest = hashlib.sha256(cand["path"].read_bytes()).hexdigest()
        if digest in seen:
            skipped.append(
                {
                    "duplicate_of": seen[digest]["source_path"],
                    "duplicate_path": str(cand["path"].relative_to(DATA)),
                    "bytes": cand["size"],
                }
            )
            continue
        try:
            mime, kind, ext = sniff(cand["path"])
        except ValueError as exc:
            skipped.append(
                {
                    "unreadable": str(cand["path"].relative_to(DATA)),
                    "reason": str(exc),
                }
            )
            continue

        # materialId 必须全局唯一：不同 owner 目录下可能有同名文件（如两个
        # 都叫 mat_YXVkaW8vd2F2 的 wav），因此从哈希派生而不是从文件名。
        material_id = f"mat_{digest[:26]}"

        title = pptx_title(cand["path"]) if mime.endswith("presentationml.presentation") else None
        if not title:
            # 元数据丢失后音频/图片只剩哈希可用，退回带序号的可读名，
            # 避免素材库列表全是 mat_<hash> 这种无法辨认的名字。
            title = f"{kind_label(kind)} {cand['path'].name[:24]}"

        seen[digest] = {
            "material_id": material_id,
            "content_sha256": digest,
            "bytes": cand["size"],
            "mime": mime,
            "kind": kind,
            "extension": ext,
            "title": title,
            "legacy_owner_dir": cand["legacy_owner_dir"],
            "source_path": str(cand["path"].relative_to(DATA)),
        }

    # 分镜语音：单独统计，不进 owner_material
    stage_media = []
    if CLASSROOMS.is_dir():
        for stage_dir in sorted(p for p in CLASSROOMS.iterdir() if p.is_dir()):
            media_dir = stage_dir / "media"
            if not media_dir.is_dir():
                continue
            files = [f for f in media_dir.iterdir() if f.is_file()]
            stage_media.append(
                {
                    "stage_dir": stage_dir.name,
                    "file_count": len(files),
                    "bytes": sum(f.stat().st_size for f in files),
                }
            )

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "materials": sorted(seen.values(), key=lambda m: (m["kind"], m["title"] or m["source_path"])),
        "duplicates_skipped": skipped,
        "stage_media_not_migrated": stage_media,
        "note": (
            "classrooms/*/media 是课程分镜 TTS 产物，归属挂在 document_stages 上；"
            "本地数据库已丢失，无法还原其 stage 归属，故不在本清单内。"
        ),
    }

    OUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"清单已写入 {OUT}")
    print(f"  唯一素材: {len(seen)}")
    print(f"  跳过重复: {sum(1 for s in skipped if 'duplicate_of' in s)}")
    print(f"  跳过无法识别: {sum(1 for s in skipped if 'unreadable' in s)}")
    for m in manifest["materials"]:
        title = f"  <- {m['title'][:40]}" if m["title"] else ""
        print(f"    [{m['kind']:8s}] {m['mime'].split('.')[-1][:24]:24s} {m['bytes']//1024:>6d}KB  {m['material_id']}{title}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
