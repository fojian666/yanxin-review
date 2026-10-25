"""文档漂移检查：把「文档里写的」和「代码里实际的」对一遍。

文档不会自己报错，只会在评审时被人发现「这里写的和做的不一样」。这个脚本把
能机器核对的那部分固定下来，每轮改完跑一次：

    python3 -m tools.doc_check          # 只报不一致
    python3 -m tools.doc_check -v       # 连通过项一起打印

核对项：
1. 测试数量：`def test_` 计数 vs 各文档里写的「N 项」；
2. 接口清单：app.py 的 /api 路由 vs README 的 API 表；
3. 模块清单：rag/ 与 tools/ 下的文件 vs README 目录树、AGENTS 模块地图；
4. 环境变量：config.py 读取的变量 vs .env.example；
5. 软著材料：源程序清单的行数/文件数、三个文件的版本号、源代码说明的合计；
6. 过时表述：早期「检索就是 TF-IDF」这类已经被推翻的说法。

只读脚本：不改任何文件，只输出结论；发现不一致时退出码为 1。
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# 覆盖全部文档，包括交付材料（它们也会被评审看到）
DOCS = [
    "README.md",
    "AGENTS.md",
    "SECURITY.md",
    "DESIGN.md",
    "实施方案-RAG垂类模型与智能问答.md",
    "交付材料/00-考核指标对照表.md",
    "交付材料/01-软件著作权/软件说明书.md",
    "交付材料/02-试点验证报告（本地验证初稿）.md",
    "交付材料/03-研究报告（初稿）.md",
    "交付材料/04-论文提纲与实验设计.md",
]

# 已被推翻的表述：文档里再出现就是没跟上代码
STALE_PHRASES = [
    ("检索是 TF-IDF，不是向量检索", "向量后端已接入，见 README「检索策略」"),
    ("不是向量检索", "向量后端已接入"),
    ("当前检索为字符 n-gram TF-IDF", "向量已接入，TF-IDF 只是基线与回落"),
    ("当前未使用向量检索", "向量已接入"),
    ("检索为字符 n-gram TF-IDF，非向量检索", "向量已接入"),
]


def _read(rel: str) -> str:
    path = ROOT / rel
    return path.read_text(encoding="utf-8") if path.exists() else ""


def docs() -> dict[str, str]:
    return {rel: _read(rel) for rel in DOCS}


def test_count() -> int:
    total = 0
    for path in (ROOT / "tests").glob("test_*.py"):
        total += len(re.findall(r"^def test_", path.read_text(encoding="utf-8"), re.M))
    return total


def _normalize(path: str) -> str:
    """把 {doc_id} / <id> 统一成 *，好和文档里的写法对齐。"""
    return re.sub(r"[{<][^}>]+[}>]", "*", path)


def routes() -> list[tuple[str, str]]:
    src = _read("app.py")
    found = re.findall(r'@app\.(get|post|put|delete|patch)\("([^"]+)"', src)
    # 同一路径的 GET/POST 是两条路由，不能按路径去重
    return sorted({(method.upper(), path) for method, path in found if path.startswith("/api")})


def modules() -> list[str]:
    names = []
    for folder in ("rag", "tools"):
        for path in sorted((ROOT / folder).glob("*.py")):
            if path.name != "__init__.py":
                names.append(path.name)
    return names


def env_vars() -> list[str]:
    src = _read("rag/config.py")
    found = set(re.findall(r'os\.getenv\(\s*"([A-Z_]+)"', src))
    found |= set(re.findall(r'_env_flag\("([A-Z_]+)"', src))
    return sorted(found)


def check_verbose(enabled: bool) -> list[tuple[str, str]]:
    problems: list[tuple[str, str]] = []
    texts = docs()

    def ok(msg: str) -> None:
        if enabled:
            print(f"  [通过] {msg}")

    # 1) 测试数量
    actual_tests = test_count()
    mentioned: dict[str, list[int]] = {}
    for rel, text in texts.items():
        for match in re.finditer(r"(?:回归测试|pytest[^0-9]{0,12})\s*(\d+)\s*项", text):
            mentioned.setdefault(rel, []).append(int(match.group(1)))
    for rel, values in mentioned.items():
        for value in values:
            if value != actual_tests:
                problems.append((rel, f"写的是 {value} 项测试，实际 {actual_tests} 项"))
    ok(f"测试数量一致（{actual_tests} 项，{len(mentioned)} 处提及）")

    # 2) 接口清单：路径归一后逐个比，前缀相同不算覆盖
    api = routes()
    readme = texts.get("README.md", "")
    table = readme[readme.find("## 10. API 摘要"):] if "## 10. API 摘要" in readme else ""
    listed = {_normalize(item) for item in re.findall(r"`(/api/[^`]+)`", table)}
    for _method, path in api:
        if _normalize(path) not in listed:
            problems.append(("README.md", f"API 表缺 {path}"))
    ok(f"API 表核对 {len(api)} 条路由")

    # 3) 模块清单
    tree = readme[readme.find("## 9. 目录结构"):] if "## 9. 目录结构" in readme else ""
    agents = texts.get("AGENTS.md", "")
    for name in modules():
        if name not in tree:
            problems.append(("README.md", f"目录结构缺 {name}"))
        if name not in agents:
            problems.append(("AGENTS.md", f"模块地图缺 {name}"))
    ok(f"模块清单覆盖 {len(modules())} 个文件")

    # 4) 环境变量
    example = _read(".env.example")
    for name in env_vars():
        if name not in example and name != "DASHSCOPE_API_KEY":  # 该变量是别名，不单列
            problems.append((".env.example", f"缺 {name}"))
    ok(f"环境变量覆盖 {len(env_vars())} 个")

    # 5) 软著材料：清单是生成物，说明书/说明是手写，三者必须自洽
    from tools import soft_copyright

    list_rel = "交付材料/01-软件著作权/源程序清单.txt"
    for item in soft_copyright.check():
        problems.append((list_rel, item))

    manual = _read("交付材料/01-软件著作权/软件说明书.md")
    if soft_copyright.SOFTWARE_VERSION not in manual:
        problems.append(
            ("交付材料/01-软件著作权/软件说明书.md",
             f"版本号没跟上代码（应为 {soft_copyright.SOFTWARE_VERSION}）")
        )
    table = _read("交付材料/01-软件著作权/源代码说明.md")
    summary = soft_copyright.summary()
    total_files = sum(files for files, _ in summary.values())
    total_lines = sum(lines for _, lines in summary.values())
    hit = re.search(r"\| 合计 \| (\d+) \| ([\d,]+) \|", table)
    if not hit:
        problems.append(("交付材料/01-软件著作权/源代码说明.md", "找不到「合计」行"))
    elif (int(hit.group(1)), int(hit.group(2).replace(",", ""))) != (total_files, total_lines):
        problems.append(
            ("交付材料/01-软件著作权/源代码说明.md",
             f"合计写 {hit.group(1)} 个文件 / {hit.group(2)} 行，实际 {total_files} 个 / {total_lines:,} 行")
        )
    ok(f"软著材料自洽（{total_files} 个文件 / {total_lines:,} 行，{soft_copyright.SOFTWARE_VERSION}）")

    # 6) 过时表述
    for phrase, why in STALE_PHRASES:
        for rel, text in texts.items():
            if phrase in text:
                problems.append((rel, f"过时表述「{phrase}」——{why}"))
    ok("没有已知的过时表述")

    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="文档漂移检查")
    parser.add_argument("-v", "--verbose", action="store_true", help="打印通过项")
    args = parser.parse_args()

    print("文档漂移检查")
    problems = check_verbose(args.verbose)
    if not problems:
        print("没有发现漂移。")
        return 0
    print(f"\n发现 {len(problems)} 处不一致：")
    for rel, msg in problems:
        print(f"  - {rel}: {msg}")
    print("\n改完再跑一次；确实是文档该改就改文档，是代码该改就改代码，别只改一处。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
