#!/usr/bin/env python3
"""抓取公开政策原文并生成溯源清单。

只抓「政府公开信息」类公文（可自由引用），不抓任何期刊全文、专家信息或个人数据。
产物写入项目根的 `corpus/`（随仓库入库，clone 即用）：

    corpus/sources.json                         溯源清单：URL / 许可 / 抓取时间 / sha256
    corpus/policy/<id>.txt                      清洗后的政策纯文本

原始 HTML/PDF **不落盘**，只记录字节数与 sha256——需要复核时按清单 URL 重抓一次即可。

用法：
    python3 tools/fetch_corpus.py               # 抓取全部并重写清单
    python3 tools/fetch_corpus.py --only most_research_misconduct
    python3 tools/fetch_corpus.py --check       # 不联网，只校验现有快照与清单是否一致

退出码：0 全部成功；1 有源抓取失败或校验不通过。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from urllib.parse import urlparse
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
CORPUS_DIR = BASE_DIR / "corpus"
POLICY_DIR = CORPUS_DIR / "policy"
MANIFEST = CORPUS_DIR / "sources.json"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
TIMEOUT = 30
RETRIES = 2

# 待抓取的公开公文。新增来源时在这里追加一条即可，清单与文本会自动生成。
SOURCES: list[dict] = [
    {
        "id": "most_research_misconduct",
        "kind": "policy",
        "title": "科研失信行为调查处理规则",
        "issuer": "科技部等二十二部门",
        "doc_no": "国科发监〔2022〕221号",
        "published_at": "2022-09-14",
        "year": 2022,
        "url": (
            "https://www.most.gov.cn/xxgk/xinxifenlei/fdzdgknr/fgzc/gfxwj/"
            "gfxwj2022/202209/t20220907_182313.html"
        ),
        "format": "html",
        "container_id": "Zoom",
        "anchors": ["科研失信行为调查处理规则", "第一章", "第一条"],
        "license": "政府公开信息（行政规范性文件）",
        "license_note": "科学技术部政府信息公开栏目主动公开的公文；引用请保留发布机关与文号。",
        "usage": "政策合规检索、预审政策依据引用",
    },
    {
        "id": "jiangsu_project_credit",
        "kind": "policy",
        "title": "江苏省科技计划项目信用管理办法",
        "issuer": "江苏省科学技术厅",
        "doc_no": "苏科技规〔2022〕3号",
        "published_at": "2022-11-29",
        "year": 2022,
        "url": "https://kjj.lyg.gov.cn/lygskxjsj/upload/cd8b5057-058e-4042-ab30-d0b40e27a865.pdf",
        "format": "pdf",
        "anchors": ["江苏省科技计划项目信用管理办法", "第一条", "信用管理"],
        "license": "政府公开信息（行政规范性文件）",
        "license_note": (
            "江苏省科学技术厅印发、标注「此件主动公开」；本快照取自连云港市科技局网站转载件，"
            "引用请以省科技厅发布版本为准。"
        ),
        "usage": "政策合规检索、预审政策依据引用",
        "channel_note": "转载渠道：连云港市科技局（kjj.lyg.gov.cn）",
    },
]

BLOCK_TAGS = {
    "p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6",
    "section", "article", "table", "blockquote", "pre",
}
SENTENCE_END = "。；：！？!?;:"
STRUCT_START = re.compile(
    r"^\s*(第[一二三四五六七八九十百零〇\d]+[章节条]|附件|目录|（[一二三四五六七八九十]+）|\([一二三四五六七八九十]+\))"
)
# 公文抬头/落款：不能与上一行拼接，否则「文件」+「文号」+「标题」会糊成一段
BREAK_BEFORE = re.compile(
    r"^(附件\s*[：:]|.{0,24}年\d{1,2}月\d{1,2}日\s*$|（此件主动公开）|江苏省科学技术厅\s*$)"
)
# 上一行是文件头时也不拼下一行
NO_MERGE_PREV = re.compile(r"(文件|通知|〔\d{4}〕\d+号|主动公开）)\s*$")


class _ContainerText(HTMLParser):
    """提取指定 id 容器内的可见文本；块级标签换行。用于政府网站正文（TRS/Zoom）。"""

    def __init__(self, container_id: str) -> None:
        super().__init__(convert_charrefs=True)
        self.container_id = container_id
        self.depth = 0
        self.capturing = False
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = dict(attrs)
        if not self.capturing:
            if tag == "div" and attrs_map.get("id") == self.container_id:
                self.capturing = True
                self.depth = 1
            return
        if tag == "div":
            self.depth += 1
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.capturing and tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if not self.capturing:
            return
        if tag == "div":
            self.depth -= 1
            if self.depth <= 0:
                self.capturing = False
                return
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.capturing:
            self.parts.append(data)

    def text(self) -> str:
        return "".join(self.parts)


def _decode(raw: bytes, declared: str | None = None) -> str:
    for enc in [e for e in (declared, "utf-8", "gb18030") if e]:
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="ignore")


def _normalize(text: str) -> str:
    # 用 NFC 而非 NFKC：公文快照要保留全角标点（（）；：），NFKC 会把它转成半角。
    # 入库分块时同样保留全角标点，仅归一全角数字字母，检索口径不变。
    text = unicodedata.normalize("NFC", text or "")
    text = text.replace("\u3000", " ").replace("\xa0", " ")
    text = re.sub(r"[\u2002\u2003\u2009\u200a]", " ", text)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


ARTICLE_ONLY = re.compile(r"^第[一二三四五六七八九十百零〇\d]+条$")
CHAPTER_ONLY = re.compile(r"^第[一二三四五六七八九十百零〇\d]+章$")


def _merge_wrapped_lines(lines: list[str]) -> list[str]:
    """合并 PDF 硬换行：上一行未以句末标点收尾、下一行不是条文/附件开头时拼接。

    条号独立成行时用空格接正文（「第五条 省科技厅…」），其余直接拼接。
    """
    out: list[str] = []
    for line in lines:
        if not out or BREAK_BEFORE.match(line):
            out.append(line)
            continue
        prev = out[-1]
        if (
            prev
            and prev[-1] not in SENTENCE_END
            and not STRUCT_START.match(line)
            and not NO_MERGE_PREV.search(prev)
        ):
            out[-1] = f"{prev} {line}" if ARTICLE_ONLY.match(prev) else prev + line
        else:
            out.append(line)
    return out


def _join_single_char_lines(lines: list[str]) -> list[str]:
    """公文标题常见竖排拆字（「总」「则」分两行），把连续单字行合并。"""
    out: list[str] = []
    buffer = ""
    for line in lines:
        if len(line) == 1 and line not in ">—":
            buffer += line
            continue
        if buffer:
            out.append(buffer)
            buffer = ""
        out.append(line)
    if buffer:
        out.append(buffer)
    return out


def _attach_chapter_names(lines: list[str]) -> list[str]:
    """把章名挂回章号。

    这份公文 PDF 的章名被排版挤到「第X章」下面那条条号之后
    （`第三章 / 第五条 / 信用记录与评价`），因此要跳过一个条号再取章名。
    若章名与章号同行（`第五章 信用修复`）则原样保留。
    """
    used: set[int] = set()
    chapters: dict[int, str] = {}
    for i, line in enumerate(lines):
        if not CHAPTER_ONLY.match(line):
            continue
        for j in (i + 1, i + 2):
            if j >= len(lines) or j in used:
                continue
            candidate = lines[j]
            if ARTICLE_ONLY.match(candidate) or CHAPTER_ONLY.match(candidate):
                continue
            if len(candidate) <= 12 and candidate[-1] not in SENTENCE_END:
                chapters[i] = f"{line} {candidate}"
                used.add(j)
            break
    out: list[str] = []
    for i, line in enumerate(lines):
        if i in used:
            continue
        out.append(chapters.get(i, line))
    return out


PAGE_FOOTER = re.compile(r"^[—\-–]\s*\d+\s*[—\-–]$")
ISSUE_TAIL = re.compile(r"^(江苏省科学技术厅办公室|\d{4}年\d{1,2}月\d{1,2}日印发)")


CHAPTER_WITH_TITLE = re.compile(r"^(第[一二三四五六七八九十百零〇\d]+[章节])\s*(.+)$")
CJK_GAP = re.compile(r"(?<=[\u4e00-\u9fa5]) (?=[\u4e00-\u9fa5])")


def _tidy_heading_space(line: str) -> str:
    """公文排版会用空格分隔字（「处　理」），渲染到界面里就是「处 理」，只对章/节标题还原。"""
    match = CHAPTER_WITH_TITLE.match(line)
    if not match:
        return line
    return f"{match.group(1)} {CJK_GAP.sub('', match.group(2)).strip()}"


def clean_policy_text(text: str, fmt: str) -> str:
    """把网页/PDF 提取文本整理成「一章一行、一条一段」的可读公文。"""
    text = _normalize(text)
    lines = []
    for raw_line in text.split("\n"):
        line = raw_line.strip()
        if not line or PAGE_FOOTER.match(line) or ISSUE_TAIL.match(line):
            continue
        lines.append(line)
    if fmt == "pdf":
        lines = _join_single_char_lines(lines)
        lines = _attach_chapter_names(lines)
        lines = _merge_wrapped_lines(lines)
    lines = [_tidy_heading_space(line) for line in lines]
    # 条号单独成行时，与条文合并为一段（便于按条引用，但不影响分块时的条号回填）
    merged: list[str] = []
    for line in lines:
        if (
            merged
            and ARTICLE_ONLY.match(merged[-1])
            and not STRUCT_START.match(line)
        ):
            merged[-1] = f"{merged[-1]} {line}"
            continue
        merged.append(line)
    return "\n\n".join(merged).strip()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "拒绝跟随政策来源重定向", headers, fp)


def _http_get(url: str) -> tuple[bytes, int]:
    allowed_hosts = {urlparse(source["url"]).hostname for source in SOURCES}
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in allowed_hosts or parsed.username or parsed.password:
        raise RuntimeError("政策抓取仅允许固定政府来源的 HTTPS 地址")
    opener = urllib.request.build_opener(_NoRedirect())  # 保留默认 TLS 证书校验
    last_error: Exception | None = None
    for attempt in range(RETRIES + 1):
        request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with opener.open(request, timeout=TIMEOUT) as resp:
                if not 200 <= resp.status < 300:
                    raise RuntimeError(f"政策来源返回非成功状态：{resp.status}")
                return resp.read(), int(resp.status)
        except urllib.error.HTTPError as exc:
            # 重定向和 4xx 不是瞬态故障，不能重试或更换到未核验地址。
            if exc.code < 500:
                raise RuntimeError(f"政策来源拒绝（HTTP {exc.code}，不跟随重定向）") from exc
            last_error = exc
            if attempt < RETRIES:
                time.sleep(1.2 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt < RETRIES:
                time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"抓取失败：{last_error}") from last_error


def _pdf_bytes_to_text(raw: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
        tmp.write(raw)
        tmp.flush()
        try:
            proc = subprocess.run(
                ["pdftotext", "-q", "-enc", "UTF-8", tmp.name, "-"],
                capture_output=True,
                timeout=120,
                check=False,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("未找到 pdftotext，请先安装 poppler（brew install poppler）") from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("pdftotext 解析超时") from exc
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", errors="ignore").strip() or "pdftotext 失败")
    return proc.stdout.decode("utf-8", errors="ignore")


def _extract(source: dict, raw: bytes) -> str:
    if source["format"] == "html":
        parser = _ContainerText(source.get("container_id", "Zoom"))
        parser.feed(_decode(raw))  # convert_charrefs=True 已解一次实体，不要再 unescape
        body = parser.text()
        if not body.strip():
            raise RuntimeError(f"未定位到正文容器 #{source.get('container_id')}，站点结构可能已变")
        return clean_policy_text(body, "html")
    if source["format"] == "pdf":
        return clean_policy_text(_pdf_bytes_to_text(raw), "pdf")
    raise RuntimeError(f"未知格式：{source['format']}")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _rel(path: Path) -> str:
    return path.relative_to(BASE_DIR).as_posix()


def fetch_one(source: dict) -> dict:
    raw, status = _http_get(source["url"])
    text = _extract(source, raw)
    missing = [a for a in source.get("anchors", []) if a not in text]
    if missing:
        raise RuntimeError(f"正文关键标记缺失：{missing}（提取可能不完整）")
    target = POLICY_DIR / f"{source['id']}.txt"
    payload = (text + "\n").encode("utf-8")
    target.write_bytes(payload)
    entry = {k: v for k, v in source.items() if k not in {"container_id", "anchors"}}
    entry.update(
        {
            "fetched_at": _now(),
            "http_status": status,
            "raw_bytes": len(raw),
            "raw_sha256": _sha256(raw),
            "text_path": _rel(target),
            "text_chars": len(text),
            "text_sha256": _sha256(payload),
            "checked_anchors": source.get("anchors", []),
        }
    )
    return entry


def write_manifest(entries: list[dict]) -> None:
    manifest = {
        "schema_version": 1,
        "generated_at": _now(),
        "generator": "tools/fetch_corpus.py",
        "note": (
            "本清单记录 corpus/ 下每条公开语料的来源与校验值。"
            "原始网页/PDF 不入库，复核时按 URL 重抓并比对 raw_sha256。"
        ),
        "sources": entries,
    }
    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def check() -> int:
    """不联网校验：清单字段齐全、文本在 corpus/ 内、sha256 一致、关键标记仍在。"""
    if not MANIFEST.exists():
        print(f"[失败] 缺少清单：{_rel(MANIFEST)}")
        return 1
    try:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"[失败] 清单不是合法 JSON：{exc}")
        return 1
    entries = manifest.get("sources") or []
    if not entries:
        print("[失败] 清单为空，没有任何语料条目")
        return 1
    problems: list[str] = []
    required = {
        "id", "title", "issuer", "url", "license", "fetched_at",
        "raw_sha256", "text_path", "text_sha256", "checked_anchors",
    }
    for entry in entries:
        sid = entry.get("id", "?")
        missing = required - set(entry)
        if missing:
            problems.append(f"{sid}: 清单缺字段 {sorted(missing)}")
            continue
        target = (BASE_DIR / str(entry["text_path"])).resolve()
        if not target.is_relative_to(CORPUS_DIR.resolve()):
            problems.append(f"{sid}: text_path 越界 {entry['text_path']}")
            continue
        if not target.is_file():
            problems.append(f"{sid}: 缺少文本 {entry.get('text_path')}")
            continue
        payload = target.read_bytes()
        if _sha256(payload) != entry.get("text_sha256"):
            problems.append(f"{sid}: 文本 sha256 与清单不一致")
        body = payload.decode("utf-8", errors="ignore")
        for anchor in entry.get("checked_anchors") or []:
            if anchor not in body:
                problems.append(f"{sid}: 关键标记缺失 {anchor}")
    if problems:
        for p in problems:
            print(f"[失败] {p}")
        return 1
    print(f"[通过] {len(manifest.get('sources', []))} 条语料与清单一致")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="抓取公开政策原文并生成溯源清单")
    ap.add_argument("--only", action="append", default=[], help="只抓指定 id（可重复）")
    ap.add_argument("--check", action="store_true", help="不联网，只校验现有快照")
    args = ap.parse_args()

    if args.check:
        return check()

    targets = [s for s in SOURCES if not args.only or s["id"] in args.only]
    if not targets:
        print(f"[失败] 未匹配任何来源：{args.only}")
        return 1

    POLICY_DIR.mkdir(parents=True, exist_ok=True)
    previous: dict[str, dict] = {}
    if MANIFEST.exists():
        try:
            old = json.loads(MANIFEST.read_text(encoding="utf-8"))
            previous = {e["id"]: e for e in old.get("sources", []) if "id" in e}
        except (json.JSONDecodeError, KeyError):
            previous = {}

    entries: list[dict] = []
    failed = 0
    target_ids = {s["id"] for s in targets}
    for source in targets:
        try:
            entry = fetch_one(source)
        except Exception as exc:  # 单源失败不影响其他源，但要显式报错
            failed += 1
            print(f"[失败] {source['id']}（{source['title']}）：{exc}")
            # 抓取失败时保留上一次成功的清单条目，避免清单与实际快照脱节
            if source["id"] in previous:
                entries.append(previous[source["id"]])
                print(f"       沿用上次成功的清单条目（{previous[source['id']]['fetched_at']}）")
            continue
        entries.append(entry)
        print(
            f"[成功] {source['id']}  {entry['text_chars']} 字  "
            f"{entry['raw_bytes']} 字节  sha256:{entry['text_sha256'][:12]}…"
        )
        time.sleep(1.0)

    # 未参与本次抓取的来源保留原清单条目
    kept = [v for k, v in previous.items() if k not in target_ids]
    write_manifest(kept + entries)
    print(f"[完成] 清单：{_rel(MANIFEST)}（本次 {len(entries)} 条，失败 {failed} 条）")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
