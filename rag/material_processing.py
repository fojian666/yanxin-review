"""持久化、可续跑的本地材料处理；原件和正式评审依据不被覆盖。"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from . import config, db, ocr
from .parsers import parse_upload, parse_pdf, apply_content_limit
from .text import chunk_document, extract_keywords, truncate

log = logging.getLogger(__name__)
_stop = threading.Event()
_wake = threading.Event()
_thread: threading.Thread | None = None
_guard = threading.Lock()
BUSY = {"queued", "processing", "indexing"}
PUBLIC_FIELDS = {"state", "complete", "source_chars", "indexed_chars", "total_pages", "processed_pages", "ocr_pages", "missing_pages", "truncated", "note", "updated_at", "revision"}


def public_quality(doc: dict) -> dict:
    value = (doc.get("meta") or {}).get("quality") or doc.get("quality") or {}
    return {key: value[key] for key in PUBLIC_FIELDS if key in value}


def _locked_document(conn, doc_id: str):
    suffix = " FOR UPDATE" if db.backend() == "postgresql" else ""
    if db.backend() != "postgresql":
        conn.execute("BEGIN IMMEDIATE")
    row = conn.execute("SELECT * FROM documents WHERE id = ?" + suffix, (doc_id,)).fetchone()
    if not row:
        raise ValueError("文档不存在")
    return dict(row)


def _meta(row: dict) -> dict:
    return json.loads(row.get("meta_json") or "{}")


def _protected(conn, doc_id: str) -> bool:
    return bool(conn.execute("SELECT id FROM review_cases WHERE doc_id = ? LIMIT 1", (doc_id,)).fetchone())


def enqueue(doc_id: str, actor: str) -> dict:
    with db.connect() as conn:
        row = _locked_document(conn, doc_id)
        path = Path(row["path"]).resolve()
        if row["source"] != "upload" or not path.is_relative_to(config.UPLOAD_DIR.resolve()):
            raise ValueError("仅支持处理已上传、保存在受控目录的本地原件")
        if _protected(conn, doc_id):
            raise ValueError("材料已用于正式评审，请上传新版本；不能原地替换历史依据")
        meta = _meta(row)
        quality = meta.get("quality") or {}
        if quality.get("state") not in BUSY:
            if not Path(row["path"]).is_file():
                raise ValueError("本地原件不存在，无法重新处理")
            quality = {**quality, "state": "queued", "job_id": uuid.uuid4().hex,
                       "actor": actor, "updated_at": db.now(), "note": "已排队，等待本地处理"}
            meta["quality"] = quality
            conn.execute("UPDATE documents SET meta_json = ? WHERE id = ?", (json.dumps(meta, ensure_ascii=False), doc_id))
            from .document_access import _event
            _event(conn, doc_id, actor, "processing_queued", {})
    _wake.set()
    return {key: quality[key] for key in PUBLIC_FIELDS if key in quality}


def _progress(doc_id: str, job_id: str, *, execution_id: str | None = None, expected_state: str | None = None, **changes) -> None:
    with db.connect() as conn:
        row = _locked_document(conn, doc_id)
        meta = _meta(row)
        quality = meta.get("quality") or {}
        if quality.get("job_id") != job_id or (expected_state is not None and quality.get("state") != expected_state) or (execution_id is not None and (quality.get("execution_id") != execution_id or quality.get("state") != "processing")):
            raise ValueError("处理任务已变更")
        meta["quality"] = {**quality, **changes, "updated_at": db.now()}
        conn.execute("UPDATE documents SET meta_json = ? WHERE id = ?", (json.dumps(meta, ensure_ascii=False), doc_id))


def _pdf(path: Path, progress) -> dict:
    parsed = parse_pdf(path)
    pages = {page["page"]: page for page in parsed["pages"]}
    physical = subprocess.run(["pdfinfo", str(path)], capture_output=True, timeout=30)
    match = re.search(r"^Pages:\s+(\d+)", physical.stdout.decode(errors="replace"), re.M)
    total = int(match[1]) if match else parsed["page_count"]
    limit = min(total, config.MAX_PDF_PAGES) if config.MAX_PDF_PAGES > 0 else total
    missing = {number for number in range(1, limit + 1) if len(re.sub(r"\s+", "", pages.get(number, {}).get("text", ""))) < 80}
    backend = None
    if missing:
        backend = ocr.engine()
    digest = ocr.file_sha256(path)
    ocr_pages = 0
    uncertain = []
    examined = 0
    size = 0
    for number in range(1, limit + 1):
        if _stop.is_set():
            raise InterruptedError("服务停止，任务稍后续跑")
        if number in missing:
            try:
                result = ocr.recognize_page(path, number, digest, backend)
                old = pages.get(number, {}).get("text", "")
                if len(result["text"].strip()) > len(old.strip()):
                    pages[number] = {"page": number, "text": result["text"]}
                    ocr_pages += 1
                if result.get("confidence") is not None and result["confidence"] < .75:
                    uncertain.append(number)
                if len(re.sub(r"\s+", "", pages.get(number, {}).get("text", ""))) < 80:
                    uncertain.append(number)
            except (ocr.OCRUnavailable, subprocess.TimeoutExpired, ValueError) as exc:
                raise ocr.OCRUnavailable(f"第 {number} 页本地识别失败，旧正文保留") from exc
        examined = number
        size += len(pages.get(number, {}).get("text", ""))
        progress(state="processing", processed_pages=number, total_pages=total, ocr_pages=ocr_pages,
                 note=f"本地处理中 {number}/{total} 页；OCR {ocr_pages} 页")
        if config.MAX_CONTENT_CHARS > 0 and size >= config.MAX_CONTENT_CHARS:
            break
    ordered = [pages[n] for n in sorted(pages) if n <= examined]
    result = apply_content_limit({"pages": ordered, "page_count": total,
                                  "text_len": sum(len(p["text"]) for p in ordered), "warning": ""})
    total_unknown = not match and bool(parsed.get("page_limit_reached"))
    truncated = total_unknown or examined < total or result["text_len"] < sum(len(p["text"]) for p in ordered)
    incomplete = sorted(set(uncertain))
    notes = []
    if ocr_pages:
        notes.append(f"{ocr_pages} 页使用本地 OCR；识别文字需与原件核对，不代表签字、印章或表格关系已验证。")
    if incomplete:
        notes.append(f"{len(incomplete)} 页文字较少、识别置信度较低或识别失败，请核对原件。")
    if truncated:
        if total_unknown:
            notes.append(f"本次处理前 {examined} 页，原件总页数未能确认；超出范围未纳入检查。")
        else:
            notes.append(f"本次处理到第 {examined}/{total} 页，正文上限 {config.MAX_CONTENT_CHARS} 字；超出范围未纳入检查。")
    result["warning"] = " ".join(notes)
    result["page_count"] = total
    result["quality"] = {"complete": not incomplete and not truncated, "total_pages": None if total_unknown else total,
                         "processed_pages": examined, "ocr_pages": ocr_pages, "missing_pages": len(incomplete),
                         "truncated": truncated, "source_chars": sum(len(p["text"]) for p in ordered),
                         "indexed_chars": result["text_len"], "note": result["warning"] or "文字已提取；图片、签字和印章仍需人工核对。"}
    return result


def _allocate_execution(doc_id: str, execution_id: str) -> str | None:
    """调度器在启动子进程前分配代次，恢复时令所有旧执行者失效。"""
    with db.connect() as conn:
        try:
            row = _locked_document(conn, doc_id)
        except ValueError:
            return
        meta = _meta(row)
        job = meta.get("quality") or {}
        token = job.get("job_id")
        if job.get("state") not in {"queued", "processing"} or not token:
            return
        job = {**job, "state": "processing", "execution_id": execution_id}
        meta["quality"] = job
        conn.execute("UPDATE documents SET meta_json = ? WHERE id = ?", (json.dumps(meta, ensure_ascii=False), doc_id))
        return token


def process_document(doc_id: str, execution_id: str | None = None) -> None:
    if execution_id is None:
        execution_id = uuid.uuid4().hex
        if not _allocate_execution(doc_id, execution_id):
            return
    doc = db.get_document(doc_id)
    if not doc:
        return
    job = (doc.get("meta") or {}).get("quality") or {}
    token = job.get("job_id")
    if not token or job.get("state") != "processing" or job.get("execution_id") != execution_id:
        return
    progress = lambda **fields: _progress(doc_id, token, execution_id=execution_id, **fields)
    try:
        progress(state="processing", note="正在读取本地原件")
        path = Path(doc["path"])
        expected = (doc.get("meta") or {}).get("sha256")
        if expected:
            if ocr.file_sha256(path) != expected:
                raise ValueError("原件完整性校验不一致")
        parsed = _pdf(path, progress) if path.suffix.lower() == ".pdf" else parse_upload(path)
        chunks = chunk_document(parsed["pages"], config.CHUNK_SIZE, config.CHUNK_OVERLAP)
        if not chunks:
            raise ValueError("未取得可用文字，请核对原件或本地 OCR 配置")
        with db.connect() as conn:
            row = _locked_document(conn, doc_id)
            meta = _meta(row)
            current = meta.get("quality") or {}
            if _protected(conn, doc_id) or current.get("job_id") != token or current.get("execution_id") != execution_id or current.get("state") != "processing":
                raise ValueError("材料已用于评审或任务已变更，保留原解析结果")
            quality = {**job, **parsed["quality"], "state": "indexing", "updated_at": db.now(), "revision": uuid.uuid4().hex}
            meta["quality"] = quality
            conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
            conn.executemany("INSERT INTO chunks (doc_id, idx, page, section, text, char_len) VALUES (?, ?, ?, ?, ?, ?)",
                             [(doc_id, c["idx"], c.get("page"), c.get("section", ""), c["text"], len(c["text"])) for c in chunks])
            conn.execute("UPDATE documents SET text_len=?,page_count=?,chunk_count=?,status=?,warning=?,meta_json=? WHERE id=?",
                         (parsed["text_len"], parsed["page_count"], len(chunks), "ready", parsed.get("warning", ""), json.dumps(meta, ensure_ascii=False), doc_id))
            text = "\n".join(page["text"] for page in parsed["pages"])
            conn.execute("UPDATE papers SET abstract=?,keywords=? WHERE doc_id=? AND source='upload'",
                         (truncate(text, 1800), ";".join(extract_keywords(f"{row['name']} {text[:3000]}", topk=6)), doc_id))
            from .document_access import _event
            _event(conn, doc_id, job.get("actor", ""), "processing_text_ready", {"ocr_pages": quality.get("ocr_pages", 0), "complete": quality.get("complete", False)})
    except InterruptedError:
        try:
            progress(state="queued", note="服务停止，已缓存页面将在下次启动时续跑")
        except ValueError:
            pass
    except ocr.OCRUnavailable as exc:
        try:
            progress(state="failed", note=str(exc) + "；旧文本保留，可配置本地引擎后重试")
        except ValueError:
            pass
    except Exception:
        log.exception("本地材料处理失败（doc_id=%s）", doc_id)
        try:
            progress(state="failed", note="本地处理失败，旧文本保留；请检查本地 OCR 引擎、原件或重试")
        except ValueError:
            pass


def _pending() -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute("SELECT id,meta_json FROM documents ORDER BY CASE WHEN status='needs_review' THEN 1 ELSE 0 END, text_len DESC, created_at").fetchall()
    return [{"id": row["id"], **(_meta(dict(row)).get("quality") or {})} for row in rows]


def _terminate_task(process: subprocess.Popen) -> None:
    """停止本任务进程组，包含其正在运行的渲染器和OCR子进程。"""
    def send(sig: signal.Signals) -> None:
        try:
            if os.name == "posix":
                os.killpg(process.pid, sig)
            elif process.poll() is None:
                process.kill() if sig == signal.SIGKILL else process.terminate()
        except ProcessLookupError:
            pass

    send(signal.SIGTERM)
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        send(signal.SIGKILL)
        process.wait(timeout=3)
    finally:
        # 组长可能先退出；仍须清理未响应TERM的渲染/OCR后代。
        if os.name == "posix":
            send(signal.SIGKILL)


def _run_job(doc_id: str) -> None:
    if _stop.is_set():
        return
    environment = {
        **os.environ,
        "DATA_DIR": str(config.DATA_DIR),
        "DB_PATH": str(db.DB_PATH),
        "DATABASE_BACKEND": db.backend(),
        "DATABASE_URL": config.DATABASE_URL,
        "MAX_CONTENT_CHARS": str(config.MAX_CONTENT_CHARS),
        "MAX_PDF_PAGES": str(config.MAX_PDF_PAGES),
    }
    execution_id = uuid.uuid4().hex
    token = _allocate_execution(doc_id, execution_id)
    if not token:
        return
    try:
        process = subprocess.Popen(
            [sys.executable, "-m", "rag.material_processing", doc_id, execution_id],
            cwd=config.BASE_DIR, env=environment, start_new_session=True,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        )
    except OSError:
        try:
            _progress(doc_id, token, execution_id=execution_id, state="failed", note="本地处理进程启动失败，旧文本保留，可重试")
        except ValueError:
            pass
        raise
    try:
        while process.poll() is None:
            if _stop.wait(.2):
                _terminate_task(process)
                return
        if process.returncode:
            try:
                _progress(doc_id, token, execution_id=execution_id, state="failed", note="本地处理进程异常退出，旧文本保留，可重试")
            except ValueError:
                # 任务已重新排队或由新的执行代次接管，旧进程无权更改状态。
                pass
    finally:
        if process.poll() is None:
            _terminate_task(process)


def _worker() -> None:
    last_index = time.monotonic()
    while not _stop.is_set():
        try:
            jobs = _pending()
            queued = [job for job in jobs if job.get("state") in {"queued", "processing"}]
            indexing = [job for job in jobs if job.get("state") == "indexing"]
            if indexing and (not queued or time.monotonic() - last_index >= 60):
                from .retrieval import retriever
                retriever.rebuild()
                for job in indexing:
                    _progress(job["id"], job["job_id"], state="ready" if job.get("complete") else "partial")
                last_index = time.monotonic()
            if queued:
                _run_job(queued[0]["id"])
                continue
        except Exception:
            log.exception("本地材料任务调度失败，稍后重试")
        _wake.wait(2)
        _wake.clear()


def start() -> None:
    global _thread
    with _guard:
        if _thread and _thread.is_alive():
            if _stop.is_set():
                raise RuntimeError("旧材料处理线程仍在停止，不能启动新的消费线程")
            return
        _stop.clear()
        _thread = threading.Thread(target=_worker, name="local-material-processing", daemon=True)
        _thread.start()


def stop() -> None:
    global _thread
    with _guard:
        _stop.set()
        _wake.set()
        thread = _thread
    if thread:
        thread.join(timeout=65)
        if thread.is_alive():
            raise RuntimeError("材料处理线程尚未停止，不能关闭数据库连接池")
        with _guard:
            if _thread is thread:
                _thread = None


if __name__ == "__main__":
    if len(sys.argv) not in {2, 3}:
        raise SystemExit("用法：python -m rag.material_processing <doc_id> [execution_id]")
    try:
        process_document(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
    finally:
        db.close_db()
