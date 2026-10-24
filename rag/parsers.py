from __future__ import annotations

import csv
import io
import re
import subprocess
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from . import config
from .text import extract_keywords, extract_year, normalize_text

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class ParseError(RuntimeError):
    pass


def _check_zip_size(z: zipfile.ZipFile) -> None:
    """拒绝解压后体积异常的 DOCX，避免压缩炸弹耗尽内存。"""
    total = sum(info.file_size for info in z.infolist())
    limit = config.MAX_DOCX_UNCOMPRESSED_BYTES
    if total > limit:
        raise ParseError(
            f"DOCX 解压后体积过大（{total // 1024 // 1024} MB，"
            f"上限 {limit // 1024 // 1024} MB），已拒绝解析"
        )


def _reject_unsafe_xml(xml: bytes) -> None:
    """DOCX 正文不需要 DTD/实体声明；出现即视为实体展开攻击。"""
    head = xml[:65536].lower()
    if b"<!doctype" in head or b"<!entity" in head:
        raise ParseError("DOCX 包含不安全的 XML 实体声明，已拒绝解析")


def apply_content_limit(parsed: dict, max_chars: int | None = None) -> dict:
    """Cap total parsed text so oversized uploads cannot explode chunking/index.

    Truncates page-by-page to ``max_chars`` (defaults to config.MAX_CONTENT_CHARS)
    and records a warning. Documents already within the limit are returned as-is.
    """
    limit = config.MAX_CONTENT_CHARS if max_chars is None else max_chars
    original = parsed.get("text_len", 0)
    if limit <= 0 or original <= limit:
        return parsed
    remaining = limit
    new_pages: list[dict] = []
    for page in parsed.get("pages", []):
        if remaining <= 0:
            break
        text = page.get("text", "")
        if len(text) > remaining:
            text = text[:remaining]
        new_pages.append({**page, "text": text})
        remaining -= len(text)
    note = f"文档过长，仅保留前 {limit} 字（原 {original} 字），超出部分未纳入检索。"
    warning = parsed.get("warning") or ""
    return {
        **parsed,
        "pages": new_pages,
        "page_count": max((p["page"] for p in new_pages if p.get("page")), default=0),
        "text_len": sum(len(p["text"]) for p in new_pages),
        "warning": f"{warning} {note}".strip() if warning else note,
    }


def _docx_paragraph_text(p: ET.Element) -> str:
    parts: list[str] = []
    for node in p.iter():
        tag = node.tag.split("}")[-1]
        if tag == "t":
            parts.append(node.text or "")
        elif tag == "tab":
            parts.append("\t")
        elif tag in {"br", "cr"}:
            parts.append("\n")
    return "".join(parts).strip()


def _docx_table_text(tbl: ET.Element) -> str:
    lines: list[str] = []
    for tr in tbl.findall(f".//{W}tr"):
        cells: list[str] = []
        for tc in tr.findall(f"./{W}tc"):
            texts = [_docx_paragraph_text(p) for p in tc.findall(f".//{W}p")]
            cell = " ".join(t for t in texts if t).strip()
            if cell:
                cells.append(cell)
        if cells:
            lines.append(" | ".join(cells))
    return "\n".join(lines)


def _docx_notes_text(z: zipfile.ZipFile) -> list[str]:
    """脚注/尾注常承载参考文献与补充说明，只解析正文会整体丢失。"""
    paras: list[str] = []
    for part in ("word/footnotes.xml", "word/endnotes.xml"):
        try:
            xml = z.read(part)
        except KeyError:
            continue
        _reject_unsafe_xml(xml)
        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            continue
        for p in root.iter(f"{W}p"):
            text = _docx_paragraph_text(p)
            if text:
                paras.append(text)
    return paras


def parse_docx(path: Path) -> dict:
    try:
        with zipfile.ZipFile(path) as z:
            _check_zip_size(z)
            xml = z.read("word/document.xml")
            notes = _docx_notes_text(z)
    except ParseError:
        raise
    except Exception as exc:
        raise ParseError(f"无法读取 DOCX：{exc}") from exc
    _reject_unsafe_xml(xml)
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise ParseError(f"DOCX XML 解析失败：{exc}") from exc
    body = root.find(f"{W}body")
    if body is None:
        raise ParseError("DOCX 中没有找到正文")
    blocks: list[str] = []
    for child in list(body):
        tag = child.tag.split("}")[-1]
        if tag == "p":
            text = _docx_paragraph_text(child)
            if text:
                blocks.append(text)
        elif tag == "tbl":
            text = _docx_table_text(child)
            if text:
                blocks.append(text)
    if notes:
        blocks.extend(notes)
    full = normalize_text("\n".join(blocks))
    return {
        "pages": [{"page": None, "text": full}],
        "page_count": 0,
        "warning": "",
        "text_len": len(full),
    }


def parse_pdf(path: Path) -> dict:
    cmd = ["pdftotext", "-layout", "-enc", "UTF-8", "-q"]
    if config.MAX_PDF_PAGES > 0:
        cmd += ["-l", str(config.MAX_PDF_PAGES)]
    cmd += [str(path), "-"]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=90,
            check=False,
        )
    except FileNotFoundError as exc:
        raise ParseError("未找到 pdftotext，无法解析 PDF；请上传 DOCX 或安装 poppler") from exc
    except subprocess.TimeoutExpired as exc:
        raise ParseError("PDF 解析超时，请拆分文件后重试") from exc
    if proc.returncode != 0:
        msg = proc.stderr.decode("utf-8", errors="ignore").strip()
        raise ParseError(f"PDF 解析失败：{msg or 'pdftotext 返回错误'}")
    raw = proc.stdout.decode("utf-8", errors="ignore")
    pages_raw = raw.split("\f")
    pages: list[dict] = []
    empty = 0
    for i, page_text in enumerate(pages_raw):
        text = normalize_text(page_text)
        if not text:
            empty += 1
            continue
        pages.append({"page": i + 1, "text": text})
    full_len = sum(len(p["text"]) for p in pages)
    warning = ""
    if full_len < 20:
        warning = "未提取到可复制文本，可能是扫描件。当前版本未启用 OCR，请上传可复制文本的 PDF 或 DOCX。"
    elif empty and empty >= max(2, len(pages_raw) // 3):
        warning = f"有 {empty} 页未提取到文本，可能是扫描页；建议人工核对。"
    page_count = max((p["page"] for p in pages), default=0)
    if config.MAX_PDF_PAGES > 0 and page_count >= config.MAX_PDF_PAGES:
        limit_note = f"仅解析前 {config.MAX_PDF_PAGES} 页；如需完整内容请拆分文件。"
        warning = f"{warning} {limit_note}".strip() if warning else limit_note
    return {
        "pages": pages,
        "page_count": page_count,
        "warning": warning,
        "text_len": full_len,
    }


def _read_text_file(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gb18030", "utf-16"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def parse_text(path: Path) -> dict:
    text = normalize_text(_read_text_file(path))
    return {
        "pages": [{"page": None, "text": text}],
        "page_count": 0,
        "warning": "" if len(text) >= 20 else "文本内容过短，请确认文件是否完整。",
        "text_len": len(text),
    }


def parse_upload(path: Path) -> dict:
    suffix = path.suffix.lower()
    if suffix == ".docx":
        result = parse_docx(path)
    elif suffix == ".pdf":
        result = parse_pdf(path)
    elif suffix in {".txt", ".md"}:
        result = parse_text(path)
    elif suffix == ".csv":
        raise ParseError("CSV 请使用“文献导入”，不要作为普通文档上传")
    else:
        raise ParseError(f"不支持的文件类型：{suffix or '未知'}")
    return apply_content_limit(result)


def _norm_header(h: str) -> str:
    return re.sub(r"\s+", "", (h or "").strip().lower())


HEADER_ALIASES = {
    "title": {"title", "标题", "题目", "篇名", "论文题目"},
    "year": {"year", "年份", "年", "发表年份", "出版年份"},
    "abstract": {"abstract", "摘要", "内容摘要"},
    "keywords": {"keywords", "keyword", "关键词", "关键字"},
    "authors": {"authors", "author", "作者"},
    "venue": {"venue", "期刊", "来源", "会议", "刊物", "发表期刊"},
}


def parse_papers_csv(path: Path) -> list[dict]:
    text = _read_text_file(path)
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ParseError("CSV 没有表头")
    mapping: dict[str, str] = {}
    for field in reader.fieldnames:
        key = _norm_header(field)
        for target, aliases in HEADER_ALIASES.items():
            if key in aliases:
                mapping[target] = field
                break
    if "title" not in mapping:
        raise ParseError("CSV 缺少标题列（title/标题）")
    out: list[dict] = []
    for row in reader:
        title = (row.get(mapping["title"]) or "").strip()
        if not title:
            continue
        year_raw = (row.get(mapping.get("year", "")) or "").strip()
        year_match = re.search(r"(19[89]\d|20[0-3]\d)", year_raw)
        year = int(year_match.group(1)) if year_match else extract_year(title)
        abstract = (row.get(mapping.get("abstract", "")) or "").strip()
        raw_keywords = (row.get(mapping.get("keywords", "")) or "").strip()
        keywords = raw_keywords
        if not keywords:
            keywords = ";".join(extract_keywords(f"{title} {abstract}", topk=5))
        out.append(
            {
                "title": title,
                "year": year,
                "abstract": abstract,
                "keywords": keywords,
                "authors": (row.get(mapping.get("authors", "")) or "").strip(),
                "venue": (row.get(mapping.get("venue", "")) or "").strip(),
                "source": "csv",
            }
        )
    if not out:
        raise ParseError("CSV 中没有可用文献行")
    return out
