#!/usr/bin/env python3
"""把本地知识包的归属改写到指定教师账号。

为什么需要这个脚本
------------------
知识包 json 里的 `ownerId` 决定了「谁能看到、能改、能删」。这份本地数据的
ownerId 有三种历史遗留状态，都会导致在服务器上登录教师账号后仍无法编辑：

  1. `anon:f87f2935-...`  —— 早期匿名访问时创建的，属于浏览器匿名 cookie 身份
  2. `user:9ea5b437-...`  —— 属于另一个（本地开发库的）用户 uuid
  3. 完全没有 ownerId 字段 —— 会被当成「共享包」，禁止修改和删除

而登录态用户的 ownerId 格式是 `user:<数据库里的 uuid>`（见
lib/server/auth/identity.ts 的 resolveAuthenticatedOwnerId），
所以必须把三者统一改写成目标账号的 `user:<id>`。

同时显式写入 `visibility: 'private'`，避免个别包残留 `public` 状态后对
所有登录用户可见（那会让「只有本人能改」的语义失效）。

用法
----
    python3 scripts/reassign-knowledge-owner.py \
        --dir data/knowledge \
        --owner user:c8737bf3-1b22-483f-8e09-f5378c1aea2b

    # 先干跑看看会改什么
    python3 scripts/reassign-knowledge-owner.py --dir data/knowledge \
        --owner user:xxx --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="改写知识包 ownerId")
    parser.add_argument("--dir", required=True, help="知识包目录")
    parser.add_argument(
        "--owner",
        required=True,
        help="目标 ownerId，形如 user:<uuid> 或 anon:<uuid>",
    )
    parser.add_argument(
        "--visibility",
        default="private",
        choices=["private", "public"],
        help="统一写入的可见性（默认 private，保证只有本人可改）",
    )
    parser.add_argument("--dry-run", action="store_true", help="只打印将要做的改动")
    args = parser.parse_args()

    owner = args.owner
    if ":" not in owner or not owner.split(":", 1)[1].strip():
        print(f"owner 格式不对，应为 user:<uuid> 或 anon:<uuid>，收到: {owner}", file=sys.stderr)
        return 2

    pkg_dir = Path(args.dir)
    files = sorted(pkg_dir.glob("*.json"))
    if not files:
        print(f"{pkg_dir} 下没有 *.json 知识包", file=sys.stderr)
        return 1

    changed = 0
    for path in files:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)

        before_owner = data.get("ownerId")
        before_vis = data.get("visibility")

        if before_owner == owner and before_vis == args.visibility:
            print(f"[skip] {path.name}: 已是目标归属 ({owner}, {args.visibility})")
            continue

        if args.dry_run:
            print(
                f"[dry]  {path.name}: ownerId {before_owner!r} -> {owner!r}, "
                f"visibility {before_vis!r} -> {args.visibility!r}"
            )
            continue

        # ownerId 必须放在 version 之后、nodes 之前，保持与既有文件一致的字段顺序
        data["ownerId"] = owner
        data["visibility"] = args.visibility
        # sharedWithUserIds 残留会把包共享给旧用户，一并清空
        if "sharedWithUserIds" in data:
            data["sharedWithUserIds"] = []

        # json.dumps 保序（sort_keys=False），ensure_ascii=False 让中文保持可读
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        changed += 1
        print(
            f"[ok]   {path.name}: ownerId {before_owner!r} -> {owner!r}, "
            f"visibility {before_vis!r} -> {args.visibility!r}"
        )

    print(f"\n共处理 {len(files)} 个包，{'改动' if not args.dry_run else '将改动'} {changed} 个")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
