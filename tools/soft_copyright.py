"""重新生成软著《源程序清单》，并给出《源代码说明》要填的规模数字。

清单是生成物，不该手改——手改必然和数据对不上。改完代码跑一次：

    python3 -m tools.soft_copyright          # 重写清单并打印规模表
    python3 -m tools.soft_copyright --check  # 只校验清单是否过期（不写文件）

统计口径：项目自有源代码，不含第三方依赖、`node_modules`、构建产物（`frontend/dist`）、
数据目录和测试临时文件。
"""
from __future__ import annotations

import argparse
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# 发版改这里；《软件说明书》的版本记录最后一行必须与它一致（doc_check 会校验）
SOFTWARE_VERSION = "V2.0"
LIST_PATH = ROOT / "交付材料" / "01-软件著作权" / "源程序清单.txt"

SECTIONS = [
    ("后端（Python）", ["app.py"], ["rag"]),
    ("前端（TypeScript/TSX/CSS）", [], ["frontend/src"]),
    ("测试（Python）", [], ["tests"]),
    ("工具（Python）", [], ["tools"]),
    ("浏览器回归（TypeScript/Python）", ["frontend/playwright.config.ts"], ["frontend/e2e"]),
]

SKIP_DIRS = {"__pycache__", "node_modules", "dist", ".git"}
SKIP_FILE_SUFFIXES = (".tmp.spec.ts",)
SUFFIXES = {".py", ".ts", ".tsx", ".css"}


def _lines(path: pathlib.Path) -> int:
    try:
        return len(path.read_text(encoding="utf-8").splitlines())
    except UnicodeDecodeError:
        return len(path.read_bytes().splitlines())


def collect() -> list[tuple[str, list[tuple[str, int]]]]:
    """[(小节名, [(相对路径, 行数), ...]), ...]，按路径排序。"""
    out = []
    for title, single_files, folders in SECTIONS:
        items: list[tuple[str, int]] = []
        for name in single_files:
            path = ROOT / name
            if path.exists():
                items.append((name, _lines(path)))
        for folder in folders:
            base = ROOT / folder
            if not base.exists():
                continue
            for path in sorted(base.rglob("*")):
                if path.is_dir() or path.suffix not in SUFFIXES:
                    continue
                if any(part in SKIP_DIRS for part in path.parts):
                    continue
                if path.name.endswith(SKIP_FILE_SUFFIXES):
                    continue
                items.append((str(path.relative_to(ROOT)), _lines(path)))
        items.sort(key=lambda item: item[0])
        out.append((title, items))
    return out


def render() -> str:
    sections = collect()
    total_files = sum(len(items) for _, items in sections)
    total_lines = sum(lines for _, items in sections for _, lines in items)
    lines = [f"源程序清单（首期原型 {SOFTWARE_VERSION}）", "", ]
    for title, items in sections:
        if not items:
            continue
        lines.append(title)
        for path, count in items:
            lines.append(f"{count:7d} {path}")
        lines.append(f"{sum(c for _, c in items):7d} total")
    lines.append("合计")
    lines.append(f"{total_lines:7d} total（{total_files} 个文件）")
    lines.append("说明")
    lines += [
        "- 以上为项目自有源代码，不含第三方依赖包、node_modules、构建产物（frontend/dist）；",
        "- 本文件由 `python3 -m tools.soft_copyright` 生成，勿手改；",
        "- 登录与角色：rag/auth.py（PBKDF2 认证 + 登录限速）、用户管理页 AdminPage.tsx、登录页 LoginPage.tsx；",
        "- 检索：rag/retrieval.py（TF-IDF 基线 + 向量接管）、rag/embeddings.py（嵌入后端与出口门禁）；",
        "- 政策语料：rag/corpus.py（导入）、tools/fetch_corpus.py（抓取清洗，唯一联网环节）；",
        "- 外部数据接入契约：rag/schemas.py、rag/ingest.py；",
        "- 课题卷宗：rag/dossiers.py（材料角色、计划类型体检与人工确认）、DossierWorkbench.tsx；",
        "- 解析安全：rag/parsers.py（DOCX 实体防护、PDF 页数上限、解压总量上限）；",
        "- 提交软著时按本清单导出前后各 30 页源程序（每页约 50 行），页眉标注软件名称/版本号/页码。",
    ]
    return "\n".join(lines) + "\n"


def summary() -> dict[str, tuple[int, int]]:
    result = {}
    for title, items in collect():
        result[title] = (len(items), sum(c for _, c in items))
    return result


def parse_list(text: str) -> dict[str, int]:
    """把清单里的「行数 路径」抽成字典，用于比对。"""
    found = {}
    for raw in text.splitlines():
        parts = raw.split(None, 1)
        if len(parts) != 2 or not parts[0].isdigit():
            continue
        path = parts[1].strip()
        if " " in path or path.endswith("total"):  # 跳过小节合计行
            continue
        if "/" in path or pathlib.Path(path).suffix in SUFFIXES:
            found[path] = int(parts[0])
    return found


def check() -> list[str]:
    problems = []
    if not LIST_PATH.exists():
        return ["源程序清单.txt 不存在"]
    listed = parse_list(LIST_PATH.read_text(encoding="utf-8"))
    actual = {
        path: count for _, items in collect() for path, count in items
    }
    for path, count in actual.items():
        if path not in listed:
            problems.append(f"清单缺 {path}（实际 {count} 行）")
        elif listed[path] != count:
            problems.append(f"{path} 清单写 {listed[path]} 行，实际 {count} 行")
    for path in listed:
        if path not in actual:
            problems.append(f"清单多出 {path}（文件已不存在）")
    header = LIST_PATH.read_text(encoding="utf-8").splitlines()[0]
    if SOFTWARE_VERSION not in header:
        problems.append(f"清单版本号与脚本不一致（脚本 {SOFTWARE_VERSION}）")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="生成/校验软著源程序清单")
    parser.add_argument("--check", action="store_true", help="只校验，不写文件")
    args = parser.parse_args()

    if args.check:
        problems = check()
        if problems:
            print(f"源程序清单已过期（{len(problems)} 处）：")
            for item in problems:
                print("  -", item)
            print("\n运行 python3 -m tools.soft_copyright 重新生成。")
            return 1
        print("源程序清单与代码一致。")
        return 0

    text = render()
    LIST_PATH.write_text(text, encoding="utf-8")
    table = summary()
    print(f"已写入 {LIST_PATH.relative_to(ROOT)}（{SOFTWARE_VERSION}）\n")
    print("| 部分 | 文件数 | 行数 |")
    print("|---|---:|---:|")
    total_files = total_lines = 0
    for title, (files, lines) in table.items():
        total_files += files
        total_lines += lines
        print(f"| {title} | {files} | {lines:,} |")
    print(f"| 合计 | {total_files} | {total_lines:,} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
