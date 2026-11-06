"""本地批量排队与进度查询；实际识别由服务内单工作线程完成，不调用云服务。"""
from __future__ import annotations

import argparse
import json
from collections import Counter

from rag import db, material_processing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", required=True, help="导入批次 meta.import_batch")
    parser.add_argument("--enqueue", action="store_true", help="将批次材料加入本地处理队列")
    parser.add_argument("--retry-failed", action="store_true", help="仅将失败任务重新排队")
    args = parser.parse_args()
    with db.connect() as conn:
        rows = [dict(row) for row in conn.execute("SELECT id,meta_json FROM documents ORDER BY text_len DESC").fetchall()]
    selected = [row for row in rows if json.loads(row["meta_json"] or "{}").get("import_batch") == args.batch]
    if not selected:
        print("未找到该导入批次；未修改任何材料")
        return 1
    counts = Counter()
    for row in selected:
        quality = json.loads(row["meta_json"] or "{}").get("quality") or {}
        state = quality.get("state", "unprocessed")
        if args.enqueue and state == ("failed" if args.retry_failed else "unprocessed"):
            try:
                material_processing.enqueue(row["id"], "local-maintenance")
                state = "queued"
            except ValueError:
                state = "protected_or_unavailable"
        counts[state] += 1
    print(json.dumps({"documents": len(selected), "states": dict(counts)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
