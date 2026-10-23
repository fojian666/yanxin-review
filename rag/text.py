from __future__ import annotations

import logging
import re
import unicodedata
from typing import Iterable

import jieba
import jieba.analyse

jieba.setLogLevel(logging.ERROR)

DOMAIN_TERMS = [
    "科研诚信", "学术不端", "科研失信", "科研伦理", "科技伦理",
    "自然资源", "国土空间", "一张图", "全周期管理", "科研管理",
    "语义查重", "文本比对", "重复申报", "成果重复", "证据链",
    "知识图谱", "实体消歧", "知识抽取", "本体建模",
    "大模型", "大语言模型", "生成式人工智能", "垂直大模型", "预训练模型",
    "检索增强", "RAG", "向量检索", "混合检索", "重排",
    "智能体", "多智能体", "专家评审", "专家匹配", "专家画像", "利益冲突",
    "成果转化", "技术转移", "价值评估", "多模态", "数据治理", "数据安全",
    "风险预警", "信用评价", "评价指标", "政策合规", "合规审查", "智能受理",
    "科技项目", "科研课题", "申报书", "评审意见", "立项", "结题",
    "区块链", "隐私计算", "可解释性", "公平性", "数字化转型",
]
for _w in DOMAIN_TERMS:
    jieba.add_word(_w, freq=20000)

STOPWORDS = set(
    """
    的 了 和 与 及 在 是 为 对 等 中 一种 一些 研究 方法 技术 分析 基于 通过
    本文 我们 可以 进行 以及 一个 及其 相关 主要 提出 实现 系统 应用 问题
    发展 影响 作用 情况 方面 工作 内容 过程 结果 表明 具有 能够 需要 进行
    如何 什么 哪些 这个 那个 这些 那些 目前 当前 近年 年来 进一步 同时
    由于 因此 但是 然而 并且 或者 如果 因为 所以 为了 对于 关于 从 到 以
    上 下 内 外 前 后 之 其 该 此 各 类 种 项 个 篇 年 月 日
    科研 项目 课题 论文 文献 作者 单位 机构 领域 方向 趋势 分析 综述
    """.split()
)

HEADING_PATTERNS = [
    re.compile(r"^\s*第[一二三四五六七八九十百零]+[章节部分篇]\s*"),
    re.compile(r"^\s*[一二三四五六七八九十]+[、.．]\s*"),
    re.compile(r"^\s*\d+(?:\.\d+){0,3}[、.．]?\s+"),
    re.compile(r"^\s*[（(][一二三四五六七八九十\d]+[）)]\s*"),
]

COMMON_HEADINGS = {
    "立项背景", "研究背景", "研究目标", "研究内容", "研究意义", "国内外研究现状",
    "研究方法", "技术路线", "研究方法与技术路线", "创新点", "特色与创新",
    "预期成果", "考核指标", "成果形式", "经费预算", "经费测算", "研究基础",
    "承担单位", "承担单位及分工", "主要研究人员", "人员分工", "工作基础",
    "课题经费预算", "申报单位意见", "提交成果", "参考文献", "附件",
    "摘要", "引言", "结论", "讨论", "研究进展", "风险与对策", "保障措施",
    "科研诚信", "数据安全", "伦理审查", "知识产权",
}


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = text.replace("\u3000", " ").replace("\xa0", " ")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def safe_filename(name: str) -> str:
    name = (name or "document").strip().replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f]+", "", name)
    return name[:160] or "document"


def guess_title(filename: str, text: str = "") -> str:
    base = re.sub(r"\.[A-Za-z0-9]{1,6}$", "", filename or "").strip()
    base = re.sub(r"^\d+[\.、_\-\s]*", "", base)
    if base and len(base) <= 80:
        return base
    for line in (text or "").splitlines()[:8]:
        line = line.strip()
        if 4 <= len(line) <= 80:
            return line
    return "未命名文档"


def extract_year(filename: str = "", text: str = "") -> int | None:
    for source in (filename or "", (text or "")[:3000]):
        matches = re.findall(r"(?<!\d)(19[89]\d|20[0-3]\d)(?!\d)", source)
        for m in matches:
            year = int(m)
            if 1990 <= year <= 2035:
                return year
    return None


def is_heading(line: str) -> bool:
    s = line.strip()
    if not s or len(s) > 48:
        return False
    if s.rstrip("：:") in COMMON_HEADINGS:
        return True
    if s.endswith(("。", "；", ";", "，", ",")):
        return False
    for pat in HEADING_PATTERNS:
        if pat.match(s):
            return True
    return False


def split_paragraphs(text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"\n+", text or "") if p.strip()]
    return parts


def split_sentences(text: str) -> list[str]:
    pieces = re.split(r"(?<=[。！？；!?;])\s*|(?<=\.)\s+(?=[A-Z0-9])", text)
    out = [p.strip() for p in pieces if p.strip()]
    return out or [text]


def _hard_split(text: str, size: int) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)]


def chunk_document(pages: list[dict], chunk_size: int = 700, overlap: int = 100) -> list[dict]:
    """Structure-aware chunking. `pages` items: {page: int|None, text: str}."""
    chunks: list[dict] = []
    current_section = ""
    idx = 0
    for page in pages:
        page_no = page.get("page")
        paragraphs = split_paragraphs(normalize_text(page.get("text", "")))
        buffer = ""
        buffer_section = current_section

        def flush() -> None:
            nonlocal buffer, buffer_section, idx
            body = buffer.strip()
            if not body:
                buffer = ""
                return
            section = buffer_section or current_section
            text = body
            if section and not body.startswith(section):
                text = f"{section}\n{body}"
            chunks.append(
                {
                    "idx": idx,
                    "page": page_no,
                    "section": section,
                    "text": text.strip(),
                }
            )
            idx += 1
            tail = body[-overlap:] if overlap and len(body) > overlap else ""
            if tail:
                # Start the overlap at a sentence/line boundary, not mid-word.
                boundary = re.search(r"[。！？；!?;\n]", tail)
                tail = tail[boundary.end() :].strip() if boundary else ""
            buffer = tail
            buffer_section = section

        for para in paragraphs:
            if is_heading(para):
                if buffer.strip():
                    flush()
                # Do not carry overlap across a section boundary: it would label
                # the previous section's tail with the new heading.
                buffer = ""
                current_section = para.rstrip("：:")
                buffer_section = current_section
                continue

            if len(para) > chunk_size:
                for sent in split_sentences(para):
                    if len(sent) > chunk_size:
                        pieces = _hard_split(sent, chunk_size)
                    else:
                        pieces = [sent]
                    for piece in pieces:
                        if buffer and len(buffer) + len(piece) + 1 > chunk_size:
                            flush()
                        buffer = f"{buffer}\n{piece}".strip() if buffer else piece
                        if len(buffer) >= chunk_size:
                            flush()
                continue

            if buffer and len(buffer) + len(para) + 1 > chunk_size:
                flush()
            buffer = f"{buffer}\n{para}".strip() if buffer else para
            if len(buffer) >= chunk_size:
                flush()

        if buffer.strip():
            flush()
        else:
            buffer = ""
    # Drop tiny fragments, but keep at least one chunk for short documents.
    cleaned = []
    for c in chunks:
        body = c["text"].strip()
        if len(body) < 12:
            continue
        cleaned.append(c)
    if not cleaned and chunks:
        cleaned = [max(chunks, key=lambda c: len(c["text"]))]
    for i, c in enumerate(cleaned):
        c["idx"] = i
    return cleaned


def _domain_hits(text: str) -> list[str]:
    hits = []
    for term in DOMAIN_TERMS:
        if term in text:
            hits.append(term)
    return hits


def extract_keywords(text: str, topk: int = 8) -> list[str]:
    text = normalize_text(text)
    if not text:
        return []
    result: list[str] = []
    for term in _domain_hits(text):
        if term not in result:
            result.append(term)
    try:
        tags = jieba.analyse.extract_tags(
            text, topK=max(topk * 2, 12), withWeight=False,
            allowPOS=("n", "nz", "vn", "v", "an", "ns", "nt", "nr", "eng"),
        )
        for tag in tags:
            tag = tag.strip()
            if len(tag) < 2 or tag in STOPWORDS or tag in result:
                continue
            if re.fullmatch(r"[\d\.\-%]+", tag):
                continue
            result.append(tag)
            if len(result) >= topk:
                break
    except Exception:
        pass
    if len(result) < topk:
        for tok in re.findall(r"[\u4e00-\u9fa5]{2,8}|[A-Za-z][A-Za-z0-9\-]{2,}", text):
            if tok in STOPWORDS or tok in result:
                continue
            result.append(tok)
            if len(result) >= topk:
                break
    return result[:topk]


def extract_terms(text: str, max_terms: int = 8) -> list[str]:
    text = normalize_text(text)
    terms: list[str] = []
    for term in _domain_hits(text):
        if term not in terms:
            terms.append(term)
    for tok in jieba.cut(text):
        tok = tok.strip()
        if len(tok) < 2 or tok in STOPWORDS or tok in terms:
            continue
        if re.fullmatch(r"[\d\.\-%]+", tok):
            continue
        terms.append(tok)
        if len(terms) >= max_terms:
            break
    return terms[:max_terms]


def parse_keywords(raw: str) -> list[str]:
    if not raw:
        return []
    raw = raw.replace("；", ";").replace("，", ",").replace("、", ",")
    parts = re.split(r"[;,]", raw)
    return [p.strip() for p in parts if p.strip()]


def truncate(text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"
