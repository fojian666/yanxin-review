from __future__ import annotations

import csv
import codecs
import io
import posixpath
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET

from . import config
from .text import extract_keywords, extract_year, normalize_text

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class ParseError(RuntimeError):
    pass


def _check_parse_deadline(deadline: float, label: str) -> None:
    if time.monotonic() > deadline:
        raise ParseError(f"{label}解析超时，请压缩或拆分文件后重试")


def _check_zip_size(z: zipfile.ZipFile) -> None:
    """拒绝条目、单条体积、总量或压缩比异常的 Office 压缩包。"""
    entries = z.infolist()
    if len(entries) > config.MAX_ARCHIVE_ENTRIES:
        raise ParseError(
            f"压缩文档条目过多（{len(entries)} 个，上限 {config.MAX_ARCHIVE_ENTRIES}）"
        )
    oversized = next(
        (
            info
            for info in entries
            if info.file_size > config.MAX_ARCHIVE_ENTRY_BYTES
        ),
        None,
    )
    if oversized is not None:
        raise ParseError(
            f"压缩文档单条目过大（{oversized.filename}，"
            f"{oversized.file_size // 1024 // 1024} MB，"
            f"上限 {config.MAX_ARCHIVE_ENTRY_BYTES // 1024 // 1024} MB）"
        )
    total = sum(info.file_size for info in entries)
    limit = config.MAX_DOCX_UNCOMPRESSED_BYTES
    if total > limit:
        raise ParseError(
            f"压缩文档解压后体积过大（{total // 1024 // 1024} MB，"
            f"上限 {limit // 1024 // 1024} MB），已拒绝解析"
        )
    compressed = sum(info.compress_size for info in entries if info.file_size > 0)
    if total > 0:
        if compressed <= 0:
            raise ParseError("压缩文档压缩比异常，已拒绝解析")
        ratio = total / compressed
        if ratio > config.MAX_ARCHIVE_COMPRESSION_RATIO:
            raise ParseError(
                f"压缩文档压缩比异常（{ratio:.0f}:1，"
                f"上限 {config.MAX_ARCHIVE_COMPRESSION_RATIO:.0f}:1），已拒绝解析"
            )


_UNSAFE_XML = re.compile(rb"<!\s*(?:doctype|entity)", re.IGNORECASE)
_UNSAFE_XML_TEXT = re.compile(r"<!\s*(?:doctype|entity)\b", re.IGNORECASE)
_RTF_CONTROL = re.compile(r"\\([a-zA-Z]+)(-?\d+)? ?")


def _reject_unsafe_xml(xml: bytes) -> None:
    """DOCX 正文不需要 DTD/实体声明；出现即视为实体展开攻击。

    全文扫描：只查前若干字节时，把声明藏在长注释或超长无害内容之后即可绕过。
    """
    if _UNSAFE_XML.search(xml):
        raise ParseError("DOCX 包含不安全的 XML 实体声明，已拒绝解析")
    # XML 也允许 UTF-16/UTF-32。字节级 ASCII 正则看不到被 NUL 分隔的
    # DOCTYPE/ENTITY，因此必须按常见 XML 编码解码后再扫描一次。
    for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "utf-32"):
        try:
            text = xml.decode(encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
        if _UNSAFE_XML_TEXT.search(text):
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
        if tag in {"t", "delText"}:
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


def _docx_body_blocks(container: ET.Element) -> list[str]:
    """按文档顺序读取普通段落、表格和常见内容控件容器。"""
    blocks: list[str] = []
    for child in list(container):
        tag = child.tag.split("}")[-1]
        if tag == "p":
            text = _docx_paragraph_text(child)
            if text:
                blocks.append(text)
        elif tag == "tbl":
            text = _docx_table_text(child)
            if text:
                blocks.append(text)
        elif tag in {"sdt", "sdtContent", "customXml", "ins", "del"}:
            blocks.extend(_docx_body_blocks(child))
    return blocks


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
    blocks = _docx_body_blocks(body)
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
    physical_count: int | None = None
    try:
        info = subprocess.run(
            ["pdfinfo", str(path)],
            capture_output=True,
            timeout=30,
            check=False,
        )
        match = re.search(r"^Pages:\s+(\d+)", info.stdout.decode(errors="replace"), re.M)
        if info.returncode == 0 and match:
            physical_count = int(match.group(1))
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    cmd = ["pdftotext", "-layout", "-enc", "UTF-8", "-q"]
    if config.MAX_PDF_PAGES > 0:
        # 多读一页作为哨兵，区分“恰好达到上限”与“超过上限”。
        cmd += ["-l", str(config.MAX_PDF_PAGES + 1)]
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
    detected_pages = raw.split("\f")
    if detected_pages and not detected_pages[-1].strip():
        detected_pages.pop()
    detected_count = max(len(detected_pages), physical_count or 0)
    page_limit_reached = bool(config.MAX_PDF_PAGES > 0 and detected_count > config.MAX_PDF_PAGES)
    pages_raw = detected_pages[: config.MAX_PDF_PAGES] if config.MAX_PDF_PAGES > 0 else detected_pages
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
        warning = "未提取到可复制文本，可能是扫描件。可由管理人员在文档中心运行本地 OCR，或提供可复制文本的 PDF/DOCX。"
    elif empty and empty >= max(2, len(pages_raw) // 3):
        warning = f"有 {empty} 页未提取到文本，可能是扫描页；建议人工核对。"
    page_count = detected_count
    if page_limit_reached:
        limit_note = f"仅解析前 {config.MAX_PDF_PAGES} 页；如需完整内容请拆分文件。"
        warning = f"{warning} {limit_note}".strip() if warning else limit_note
    return {
        "pages": pages,
        "page_count": page_count,
        "warning": warning,
        "text_len": full_len,
        "page_limit_reached": page_limit_reached,
        "missing_pages": [i + 1 for i, value in enumerate(pages_raw) if len(re.sub(r"\s+", "", value)) < 80],
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


class _HTMLTextParser(HTMLParser):
    """提取本地 HTML/Quick Look 预览中的可见文本，忽略脚本与样式。"""

    _BLOCK_TAGS = {"p", "div", "br", "li", "tr", "td", "th", "h1", "h2", "h3", "h4", "section", "article"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._ignored = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in {"script", "style", "noscript"}:
            self._ignored += 1
        elif not self._ignored and tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"}:
            self._ignored = max(0, self._ignored - 1)
        elif not self._ignored and tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._ignored:
            self.parts.append(data)


def _decode_html_bytes(raw: bytes) -> tuple[str, str, bool]:
    if raw.startswith(codecs.BOM_UTF8):
        return raw.decode("utf-8-sig"), "", False
    head = raw[:8192].decode("latin1", errors="ignore")
    match = re.search(
        r"""(?:<meta[^>]+charset\s*=\s*["']?|<\?xml[^>]+encoding\s*=\s*["'])"""
        r"""\s*([a-zA-Z0-9._-]+)""",
        head,
        re.IGNORECASE,
    )
    declared = match.group(1) if match else ""
    candidates = ([declared] if declared else []) + ["utf-8", "gb18030"]
    for index, encoding in enumerate(dict.fromkeys(candidates)):
        try:
            # 未知字符集名称会抛 LookupError；继续尝试安全回退。
            codecs.lookup(encoding)
            text = raw.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue
        if declared and encoding.lower() == declared.lower():
            return text, "", False
        uncertain = not declared or index > 0
        warning = (
            f"HTML 未声明字符集，已按 {encoding} 解码。"
            if not declared
            else f"HTML 声明的字符集 {declared} 无法解码，已按 {encoding} 回退。"
        )
        return text, warning, uncertain
    text = raw.decode("utf-8", errors="ignore")
    return text, "HTML 字符集无法确认，已忽略无法解码的字节。", True


def _html_text(raw: bytes | str) -> tuple[str, str, bool]:
    if isinstance(raw, bytes):
        decoded, warning, uncertain = _decode_html_bytes(raw)
    else:
        decoded, warning, uncertain = raw, "", False
    parser = _HTMLTextParser()
    parser.feed(decoded)
    lines = [" ".join(line.split()) for line in "".join(parser.parts).splitlines()]
    return normalize_text("\n".join(line for line in lines if line)), warning, uncertain


def parse_html(path: Path) -> dict:
    text, encoding_warning, encoding_uncertain = _html_text(path.read_bytes())
    warnings = [encoding_warning]
    if not text:
        warnings.append("未从 HTML 中提取到可读正文。")
    return {
        "pages": [{"page": None, "text": text}],
        "page_count": 0,
        "warning": " ".join(value for value in warnings if value),
        "text_len": len(text),
        "encoding_uncertain": encoding_uncertain,
    }


def _decode_rtf_bytes(values: list[int]) -> str:
    raw = bytes(values)
    for encoding in ("gb18030", "utf-8", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("gb18030", errors="ignore")


def _merge_utf16_surrogates(value: str) -> str:
    """合并 RTF Unicode 控制字产生的 UTF-16 代理对，并丢弃孤立代理项。"""
    output: list[str] = []
    index = 0
    while index < len(value):
        codepoint = ord(value[index])
        if 0xD800 <= codepoint <= 0xDBFF and index + 1 < len(value):
            low = ord(value[index + 1])
            if 0xDC00 <= low <= 0xDFFF:
                output.append(chr(0x10000 + ((codepoint - 0xD800) << 10) + (low - 0xDC00)))
                index += 2
                continue
        if not 0xD800 <= codepoint <= 0xDFFF:
            output.append(value[index])
        index += 1
    return "".join(output)


def parse_rtf(path: Path) -> dict:
    """解析 RTF 的可见文字；忽略字体表、颜色表、图片与文档属性。"""
    source = path.read_bytes().decode("latin1", errors="ignore")
    ignored_destinations = {
        "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer",
        "listtable", "listoverridetable", "generator", "xmlnstbl", "themedata", "colorschememapping",
    }
    out: list[str] = []
    byte_buffer: list[int] = []
    depth = 0
    skip_depth: int | None = None
    i = 0
    deadline = time.monotonic() + config.RTF_PARSE_TIMEOUT_SECONDS

    def flush_bytes() -> None:
        if byte_buffer:
            out.append(_decode_rtf_bytes(byte_buffer))
            byte_buffer.clear()

    while i < len(source):
        if i & 0x3FFF == 0 and time.monotonic() > deadline:
            raise ParseError("RTF 解析超时，请压缩或转换文件后重试")
        char = source[i]
        if char == "{":
            depth += 1
            i += 1
            continue
        if char == "}":
            flush_bytes()
            if skip_depth == depth:
                skip_depth = None
            depth = max(0, depth - 1)
            i += 1
            continue
        if char != "\\":
            if skip_depth is None:
                flush_bytes()
                out.append(char)
            i += 1
            continue

        if i + 1 >= len(source):
            break
        marker = source[i + 1]
        if marker in "\\{}":
            if skip_depth is None:
                flush_bytes()
                out.append(marker)
            i += 2
            continue
        if marker == "'" and i + 3 < len(source):
            try:
                byte_buffer.append(int(source[i + 2 : i + 4], 16))
            except ValueError:
                pass
            i += 4
            continue
        if marker == "*":
            skip_depth = depth
            i += 2
            continue

        match = _RTF_CONTROL.match(source, i)
        if not match:
            i += 1
            continue
        word, number = match.group(1), match.group(2)
        consumed = len(match.group(0))
        if word == "*":
            skip_depth = depth
        elif word in ignored_destinations:
            skip_depth = depth
        elif skip_depth is None:
            if word in {"par", "line"}:
                flush_bytes()
                out.append("\n")
            elif word == "tab":
                flush_bytes()
                out.append("\t")
            elif word == "u" and number:
                flush_bytes()
                value = int(number)
                out.append(chr(value if value >= 0 else value + 65536))
                if i + consumed < len(source) and source[i + consumed] == "?":
                    consumed += 1
        i += consumed
    flush_bytes()
    text = normalize_text(_merge_utf16_surrogates("".join(out)))
    return {
        "pages": [{"page": None, "text": text}],
        "page_count": 0,
        "warning": "" if text else "未从 RTF 中提取到可读正文。",
        "text_len": len(text),
    }


def _zip_xml(z: zipfile.ZipFile, member: str) -> ET.Element:
    try:
        xml = z.read(member)
    except KeyError as exc:
        raise ParseError(f"压缩文档缺少 {member}") from exc
    _reject_unsafe_xml(xml)
    try:
        return ET.fromstring(xml)
    except ET.ParseError as exc:
        raise ParseError(f"XML 解析失败：{exc}") from exc


def _natural_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value)]


def parse_odt(path: Path) -> dict:
    try:
        with zipfile.ZipFile(path) as z:
            _check_zip_size(z)
            _check_parse_deadline(time.monotonic() + config.OFFICE_PARSE_TIMEOUT_SECONDS, "ODT")
            root = _zip_xml(z, "content.xml")
    except ParseError:
        raise
    except Exception as exc:
        raise ParseError(f"无法读取 ODT：{exc}") from exc
    lines: list[str] = []
    for node in root.iter():
        if node.tag.split("}")[-1] in {"p", "h"}:
            text = "".join(node.itertext()).strip()
            if text:
                lines.append(text)
    text = normalize_text("\n".join(lines))
    return {
        "pages": [{"page": None, "text": text}],
        "page_count": 0,
        "warning": "" if text else "未从 ODT 中提取到可读正文。",
        "text_len": len(text),
    }


def parse_ofd(path: Path) -> dict:
    """从 OFD 容器各页的 TextCode 节点提取可复制文本。"""
    try:
        with zipfile.ZipFile(path) as z:
            _check_zip_size(z)
            deadline = time.monotonic() + config.OFFICE_PARSE_TIMEOUT_SECONDS
            page_members = sorted(
                (
                    name for name in z.namelist()
                    if re.search(r"(?:^|/)Pages/.+\.xml$", name, re.IGNORECASE)
                ),
                key=_natural_key,
            )
            if not page_members:
                raise ParseError("OFD 中未找到页面内容")
            pages: list[dict] = []
            for index, member in enumerate(page_members, 1):
                _check_parse_deadline(deadline, "OFD")
                root = _zip_xml(z, member)
                parts = [
                    (node.text or "").strip()
                    for node in root.iter()
                    if node.tag.split("}")[-1] in {"TextCode", "Text"} and (node.text or "").strip()
                ]
                text = normalize_text("\n".join(parts))
                if text:
                    pages.append({"page": index, "text": text})
    except ParseError:
        raise
    except Exception as exc:
        raise ParseError(f"无法读取 OFD：{exc}") from exc
    text_len = sum(len(page["text"]) for page in pages)
    return {
        "pages": pages,
        "page_count": len(page_members),
        "warning": "" if text_len else "OFD 可能是扫描页或缺少可复制文本；当前本地 OCR 仅支持 PDF，OFD 扫描页需先转换为 PDF 再处理。",
        "text_len": text_len,
    }


def parse_pptx(path: Path) -> dict:
    try:
        with zipfile.ZipFile(path) as z:
            _check_zip_size(z)
            deadline = time.monotonic() + config.OFFICE_PARSE_TIMEOUT_SECONDS
            slide_members = sorted(
                (
                    name for name in z.namelist()
                    if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
                ),
                key=_natural_key,
            )
            # 幻灯片可在 PowerPoint 内重排，文件名并不代表播放顺序。
            if "ppt/presentation.xml" in z.namelist():
                rels = _zip_xml(z, "ppt/_rels/presentation.xml.rels")
                targets = {}
                for rel in rels:
                    if rel.attrib.get("TargetMode") == "External":
                        continue
                    target = rel.attrib.get("Target", "")
                    member = target.lstrip("/") if target.startswith("/") else f"ppt/{target}"
                    targets[rel.attrib.get("Id")] = posixpath.normpath(member)
                root = _zip_xml(z, "ppt/presentation.xml")
                ordered = []
                available = set(slide_members)
                for node in root.iter():
                    if node.tag.split("}")[-1] != "sldId":
                        continue
                    rel_id = next((value for key, value in node.attrib.items() if key.endswith("}id")), "")
                    member = targets.get(rel_id)
                    if member not in available:
                        raise ParseError("PPTX 幻灯片目录引用无效，无法确认页序")
                    ordered.append(member)
                slide_members = ordered
            if not slide_members:
                raise ParseError("PPTX 中未找到幻灯片")
            pages: list[dict] = []
            for index, member in enumerate(slide_members, 1):
                _check_parse_deadline(deadline, "PPTX")
                root = _zip_xml(z, member)
                parts = [
                    (node.text or "").strip()
                    for node in root.iter()
                    if node.tag.split("}")[-1] == "t" and (node.text or "").strip()
                ]
                text = normalize_text("\n".join(parts))
                if text:
                    pages.append({"page": index, "text": text})
    except ParseError:
        raise
    except Exception as exc:
        raise ParseError(f"无法读取 PPTX：{exc}") from exc
    text_len = sum(len(page["text"]) for page in pages)
    return {
        "pages": pages,
        "page_count": len(slide_members),
        "warning": "" if text_len else "PPTX 中未提取到可复制文本，图片中的文字需要人工核对。",
        "text_len": text_len,
    }


def parse_xlsx(path: Path) -> dict:
    """按工作表提取 XLSX 单元格文本，避免把表格内容误当普通段落。"""
    try:
        with zipfile.ZipFile(path) as z:
            _check_zip_size(z)
            deadline = time.monotonic() + config.OFFICE_PARSE_TIMEOUT_SECONDS
            names = set(z.namelist())
            shared: list[str] = []
            if "xl/sharedStrings.xml" in names:
                root = _zip_xml(z, "xl/sharedStrings.xml")
                for item in root.iter():
                    if item.tag.split("}")[-1] == "si":
                        shared.append("".join(node.text or "" for node in item.iter() if node.tag.split("}")[-1] == "t"))
            rels: dict[str, str] = {}
            if "xl/_rels/workbook.xml.rels" in names:
                root = _zip_xml(z, "xl/_rels/workbook.xml.rels")
                for rel in root:
                    if rel.tag.split("}")[-1] == "Relationship":
                        rels[str(rel.attrib.get("Id", ""))] = str(rel.attrib.get("Target", ""))
            sheets: list[tuple[str, str]] = []
            if "xl/workbook.xml" in names:
                root = _zip_xml(z, "xl/workbook.xml")
                for node in root.iter():
                    if node.tag.split("}")[-1] != "sheet":
                        continue
                    rel_id = next((value for key, value in node.attrib.items() if key.split("}")[-1] == "id"), "")
                    target = rels.get(rel_id, "")
                    if target:
                        target = target.lstrip("/")
                        member = posixpath.normpath(target if target.startswith("xl/") else f"xl/{target}")
                        sheets.append((str(node.attrib.get("name", "")).strip(), member))
            if not sheets:
                sheets = [(Path(name).stem, name) for name in sorted(names, key=_natural_key) if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)]
            pages: list[dict] = []
            for index, (sheet_name, member) in enumerate(sheets, 1):
                _check_parse_deadline(deadline, "XLSX")
                if member not in names:
                    continue
                root = _zip_xml(z, member)
                rows: list[str] = []
                for row in (node for node in root.iter() if node.tag.split("}")[-1] == "row"):
                    cells: list[tuple[int, str]] = []
                    for cell in (node for node in row if node.tag.split("}")[-1] == "c"):
                        kind = cell.attrib.get("t", "")
                        if kind == "inlineStr":
                            value = "".join(n.text or "" for n in cell.iter() if n.tag.split("}")[-1] == "t")
                        else:
                            value = next((n.text or "" for n in cell if n.tag.split("}")[-1] == "v"), "")
                            if kind == "s" and value.isdigit() and int(value) < len(shared):
                                value = shared[int(value)]
                        ref_match = re.match(r"([A-Z]+)", cell.attrib.get("r", ""))
                        col = 0
                        for letter in (ref_match.group(1) if ref_match else ""):
                            col = col * 26 + ord(letter) - 64
                        if value.strip():
                            cells.append((col, value.strip()))
                    if cells:
                        rows.append(" | ".join(value for _col, value in sorted(cells)))
                # 工作表名称不是正文，空表不能仅凭名称被视为可读材料。
                if rows:
                    text = normalize_text("\n".join([sheet_name, *rows]))
                    pages.append({"page": index, "text": text})
    except ParseError:
        raise
    except Exception as exc:
        raise ParseError(f"无法读取 XLSX：{exc}") from exc
    text_len = sum(len(page["text"]) for page in pages)
    return {
        "pages": pages,
        "page_count": len(sheets),
        "warning": "" if text_len else "XLSX 中未提取到可用单元格文本。",
        "text_len": text_len,
    }


def parse_doc(path: Path) -> dict:
    """旧版 DOC 通过本机转换器解析；原件不修改。"""
    with tempfile.TemporaryDirectory(prefix="yanxin-doc-") as raw_tmp:
        tmp = Path(raw_tmp)
        output = tmp / "converted.docx"
        deadline = time.monotonic() + config.DOC_PARSE_TIMEOUT_SECONDS

        def run_tool(command: list[str]) -> subprocess.CompletedProcess:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ParseError(
                    f"旧版 DOC 本地转换超过 {config.DOC_PARSE_TIMEOUT_SECONDS:g} 秒，已终止"
                )
            try:
                return subprocess.run(
                    command,
                    capture_output=True,
                    timeout=remaining,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise ParseError(
                    f"旧版 DOC 本地转换超过 {config.DOC_PARSE_TIMEOUT_SECONDS:g} 秒，已终止"
                ) from exc

        textutil = shutil.which("textutil")
        if textutil:
            proc = run_tool(
                [textutil, "-convert", "docx", "-output", str(output), str(path)]
            )
            if proc.returncode == 0 and output.exists():
                parsed = parse_docx(output)
                parsed["warning"] = "旧版 DOC 经本地转换解析；复杂公式、批注和嵌入对象可能未纳入文本。"
                return parsed

        qlmanage = shutil.which("qlmanage")
        if qlmanage:
            preview_dir = tmp / "quicklook"
            preview_dir.mkdir()
            run_tool(
                [qlmanage, "-p", "-o", str(preview_dir), str(path)]
            )
            previews = sorted(preview_dir.glob("*.qlpreview/Preview.html"))
            if previews:
                parsed = parse_html(previews[0])
                parsed["warning"] = "旧版 DOC 经本机 Quick Look 只读预览解析；复杂版式和图片文字需人工核对。"
                return parsed

        for converter in ("libreoffice", "soffice"):
            command = shutil.which(converter)
            if not command:
                continue
            proc = run_tool(
                [command, "--headless", "--convert-to", "docx", "--outdir", str(tmp), str(path)]
            )
            converted = tmp / f"{path.stem}.docx"
            if proc.returncode == 0 and converted.exists():
                parsed = parse_docx(converted)
                parsed["warning"] = "旧版 DOC 经 LibreOffice 本地转换解析；复杂公式和嵌入对象可能未纳入文本。"
                return parsed

        antiword = shutil.which("antiword")
        if antiword:
            proc = run_tool([antiword, str(path)])
            if proc.returncode == 0:
                text = proc.stdout.decode("gb18030", errors="ignore")
                text = normalize_text(text)
                return {
                    "pages": [{"page": None, "text": text}],
                    "page_count": 0,
                    "warning": "旧版 DOC 经 antiword 解析；复杂表格、公式和嵌入对象可能缺失。",
                    "text_len": len(text),
                }
    raise ParseError("旧版 DOC 需要本机 LibreOffice/antiword，macOS 也可由 textutil 或 Quick Look 转换")


def parse_upload(path: Path) -> dict:
    suffix = path.suffix.lower()
    if suffix == ".docx":
        result = parse_docx(path)
    elif suffix == ".doc":
        result = parse_doc(path)
    elif suffix == ".pdf":
        result = parse_pdf(path)
    elif suffix == ".ofd":
        result = parse_ofd(path)
    elif suffix == ".odt":
        result = parse_odt(path)
    elif suffix == ".rtf":
        result = parse_rtf(path)
    elif suffix == ".pptx":
        result = parse_pptx(path)
    elif suffix == ".xlsx":
        result = parse_xlsx(path)
    elif suffix in {".html", ".htm"}:
        result = parse_html(path)
    elif suffix in {".txt", ".md"}:
        result = parse_text(path)
    elif suffix == ".csv":
        raise ParseError("CSV 请使用“文献导入”，不要作为普通文档上传")
    else:
        raise ParseError(f"不支持的文件类型：{suffix or '未知'}")
    limited = apply_content_limit(result)
    missing = result.get("missing_pages", [])
    truncated = result.get("text_len", 0) > limited.get("text_len", 0) or bool(result.get("page_limit_reached"))
    encoding_uncertain = bool(result.get("encoding_uncertain"))
    usable = bool(limited.get("text_len"))
    limited["quality"] = {
        "state": "partial" if truncated or missing or encoding_uncertain or not usable else "ready",
        "complete": usable and not truncated and not missing and not encoding_uncertain,
        "source_chars": result.get("text_len", 0),
        "indexed_chars": limited.get("text_len", 0),
        "total_pages": None if result.get("page_limit_reached") else result.get("page_count", 0),
        "processed_pages": limited.get("page_count", 0),
        "missing_pages": len(missing), "ocr_pages": 0,
        "truncated": truncated,
        "note": limited.get("warning") or ("仅检查已提取文字；图片、签字和印章不在文字检查范围。" if usable else "未提取到有效文字，请核对原件或运行本地处理。"),
    }
    return limited


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
