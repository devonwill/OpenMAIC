#!/usr/bin/env python3
"""把迁移清单里的素材打包成一个 tar + 一份 SQL，供上传到服务器后一次性入库。

用法：
    python3 scripts/pack-materials-for-upload.py \
        --manifest data/materials-migration-manifest.json \
        --out /tmp/materials-upload

产出：
    /tmp/materials-upload/materials.tar   # 文件，路径已是 data/ 下的目标相对路径
    /tmp/materials-upload/seed.sql        # owner_material 的 INSERT 语句
    /tmp/materials-upload/manifest.json   # 拷贝的清单，便于服务器侧核对
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def sql_literal(value: str | None) -> str:
    if value is None:
        return "NULL"
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def main() -> int:
    parser = argparse.ArgumentParser(description="打包素材与入库 SQL")
    parser.add_argument(
        "--manifest",
        default=str(DATA / "materials-migration-manifest.json"),
        help="build-material-manifest.py 产出的清单",
    )
    parser.add_argument("--out", default="/tmp/materials-upload", help="输出目录")
    parser.add_argument(
        "--owner-id",
        required=True,
        help="目标 ownerId，形如 user:<uuid>（owner_material.owner_id 原样存这个值）",
    )
    parser.add_argument(
        "--oss-prefix",
        default=None,
        help="oss_key 前缀，形如 materials/user_<uuid>；默认由 owner-id 推导",
    )
    args = parser.parse_args()

    owner_id = args.owner_id
    # 与 app/api/materials/route.ts 的 ownerMaterialObjectKey 保持一致
    oss_prefix = args.oss_prefix or f"materials/{owner_id.replace('[^A-Za-z0-9._-]', '_')}"

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    materials = manifest["materials"]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    import tarfile

    now_ms = int(time.time() * 1000)
    tar_path = out_dir / "materials.tar"
    sql_lines: list[str] = [
        "-- 迁移自本地 data/materials（本地数据库已丢失，按内容哈希去重后重建元数据）",
        "-- owner_id 直接使用 owner_material.owner_id 的原始值，读取侧按它分区过滤",
        "BEGIN;",
    ]
    packed: list[dict] = []

    with tarfile.open(tar_path, "w") as tar:
        for m in materials:
            src = DATA / m["source_path"]
            if not src.is_file():
                print(f"  跳过（源文件不存在）: {m['source_path']}")
                continue

            material_id = m["material_id"]
            oss_key = f"{oss_prefix}/{material_id}"
            # 与上传接口一致：字节落在 data/<oss_key>
            arcname = f"materials/{oss_prefix.split('/', 1)[1]}/{material_id}"
            tar.add(src, arcname=arcname)

            name = f"{m['title'] or material_id}{m['extension']}"
            sql_lines.append(
                "INSERT INTO owner_material "
                "(id, owner_id, kind, mime, bytes, original_name, oss_key, sha256, status, extraction, created_at) "
                "VALUES ("
                f"{sql_literal(material_id)}, "
                f"{sql_literal(owner_id)}, "
                f"{sql_literal(m['kind'])}, "
                f"{sql_literal(m['mime'])}, "
                f"{int(m['bytes'])}, "
                f"{sql_literal(name)}, "
                f"{sql_literal(oss_key)}, "
                f"{sql_literal(m['content_sha256'])}, "
                "'ready', "
                "'{\"status\":\"idle\"}'::jsonb, "
                f"{now_ms}) "
                "ON CONFLICT (id) DO UPDATE SET "
                "owner_id = EXCLUDED.owner_id, original_name = EXCLUDED.original_name, "
                "oss_key = EXCLUDED.oss_key, mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, "
                "sha256 = EXCLUDED.sha256, kind = EXCLUDED.kind, "
                "status = 'ready', deleted_at = NULL;"
            )
            packed.append({**m, "original_name": name, "oss_key": oss_key})
            print(f"  打包 {arcname}  ({m['bytes']//1024}KB)  {name[:50]}")

    sql_lines.append("COMMIT;")
    (out_dir / "seed.sql").write_text("\n".join(sql_lines) + "\n", encoding="utf-8")
    (out_dir / "manifest.json").write_text(
        json.dumps(packed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    total = sum(p["bytes"] for p in packed)
    print(f"\n共 {len(packed)} 个素材, {total/1024/1024:.1f}MB")
    print(f"  tar  : {tar_path}  ({tar_path.stat().st_size/1024/1024:.1f}MB)")
    print(f"  sql  : {out_dir / 'seed.sql'}")
    print(f"  目标目录: {oss_prefix}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
