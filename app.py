from __future__ import annotations

import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from rag import config, db, qa, review, trends
from rag import experts as expert_service
from rag.llm import LLMError, llm
from rag.experts import parse_experts_csv
from rag.parsers import ParseError, parse_papers_csv, parse_upload
from rag.retrieval import retriever
from rag.seed import seed_all
from rag.text import chunk_document, extract_keywords, extract_year, guess_title, safe_filename, truncate

DIST_DIR = config.BASE_DIR / "frontend" / "dist"
logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    seed_all()
    retriever.rebuild()
    yield


app = FastAPI(
    title="研信智评 API",
    version="0.2.0",
    description="科研诚信 RAG 智能评审助手：问答、预审、文献趋势",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    question: str = ""
    history: list[dict[str, Any]] = Field(default_factory=list)
    scope: list[str] = Field(default_factory=list)


class ReviewRequest(BaseModel):
    doc_id: str = ""


class TrendRequest(BaseModel):
    query: str = "科研诚信"
    start_year: int | None = None
    end_year: int | None = None


class ToolCheckRequest(BaseModel):
    doc_id: str = ""
    top_k: int = Field(default=8, ge=1, le=20)


def _infer_kind(filename: str) -> str:
    name = (filename or "").lower()
    if any(k in name for k in ("政策", "办法", "规定", "条例", "指南", "规范", "细则")):
        return "policy"
    if any(k in name for k in ("本子", "申请书", "申报书", "课题", "项目申报")):
        return "proposal"
    return "other"


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _pieces(text: str, size: int = 18) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)]


def _cite_payload(citations: list[dict]) -> list[dict]:
    out = []
    for i, c in enumerate(citations, 1):
        out.append(
            {
                "index": i,
                "doc_id": c.get("doc_id"),
                "doc_name": c.get("doc_name"),
                "page": c.get("page"),
                "section": c.get("section"),
                "score": c.get("score"),
                "text": truncate(c.get("text", ""), 520),
            }
        )
    return out


async def _save_upload(file: UploadFile, target: Path) -> int:
    size = 0
    with target.open("wb") as fh:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > config.MAX_UPLOAD_BYTES:
                fh.close()
                target.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"文件超过大小限制（{config.MAX_UPLOAD_BYTES // 1024 // 1024} MB）",
                )
            fh.write(chunk)
    await file.close()
    return size


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "llm": llm.status(),
        "stats": db.stats(),
        "retriever_ready": retriever.ready,
    }


@app.get("/api/documents")
def documents():
    return {"documents": db.list_documents()}


@app.post("/api/documents")
async def upload_document(
    file: UploadFile = File(...),
    kind: str = Form("auto"),
    year: str = Form(""),
    title: str = Form(""),
):
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="请选择文件")
    filename = safe_filename(file.filename)
    suffix = Path(filename).suffix.lower()
    if suffix == ".csv":
        raise HTTPException(status_code=400, detail="CSV 请使用“文献导入”，不要作为普通文档上传")
    if suffix not in config.ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型：{suffix or '未知'}")
    if kind not in config.DOC_KINDS:
        kind = "auto"
    if kind == "auto":
        kind = _infer_kind(filename)

    doc_id = db.new_id()
    target = config.UPLOAD_DIR / f"{doc_id}_{filename}"
    await _save_upload(file, target)
    try:
        parsed = await run_in_threadpool(parse_upload, target)
    except ParseError as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"解析失败：{exc}") from exc

    text = "\n".join(p.get("text", "") for p in parsed["pages"])
    chunks = await run_in_threadpool(
        chunk_document, parsed["pages"], config.CHUNK_SIZE, config.CHUNK_OVERLAP
    )
    title_value = (title or "").strip() or guess_title(filename, text)
    year_value = int(year) if str(year).isdigit() else extract_year(filename, text)
    warning = parsed.get("warning") or ""
    if not chunks:
        warning = warning or "未生成可用文本块，请确认文件内容。"
    doc = {
        "id": doc_id,
        "name": title_value,
        "kind": kind,
        "year": year_value,
        "source": "upload",
        "path": str(target),
        "text_len": parsed.get("text_len", len(text)),
        "page_count": parsed.get("page_count", 0),
        "warning": warning,
        "status": "ready" if chunks else "needs_review",
        "meta": {"original_name": file.filename, "suffix": suffix},
    }
    db.insert_document(doc, chunks)
    if kind == "paper":
        db.insert_paper(
            {
                "doc_id": doc_id,
                "title": title_value,
                "authors": "",
                "year": year_value,
                "venue": "",
                "abstract": truncate(text, 1800),
                "keywords": ";".join(extract_keywords(f"{title_value} {text[:3000]}", topk=6)),
                "is_sample": 0,
                "source": "upload",
            }
        )
    await run_in_threadpool(retriever.rebuild)
    return {
        "document": {**doc, "chunk_count": len(chunks), "meta": None},
        "warning": warning,
    }


@app.delete("/api/documents/{doc_id}")
def remove_document(doc_id: str):
    doc = db.delete_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    try:
        Path(doc["path"]).unlink(missing_ok=True)
    except OSError:
        pass
    retriever.rebuild()
    return {"ok": True}


@app.post("/api/chat")
def chat(payload: ChatRequest):
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    result = qa.answer(question, payload.history, payload.scope or None)
    result["citations"] = _cite_payload(result.get("citations") or [])
    return result


@app.post("/api/chat/stream")
def chat_stream(payload: ChatRequest):
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    prepared = qa.prepare(question, payload.history, payload.scope or None)
    citations = _cite_payload(prepared["citations"])

    def generate():
        yield _sse(
            {
                "type": "meta",
                "citations": citations,
                "mode": prepared["mode"],
                "warning": prepared["warning"],
                "provider": llm.status(),
            }
        )
        emitted = False
        if prepared["mode"] == "qwen" and prepared["messages"]:
            try:
                for token in llm.stream_chat(prepared["messages"]):
                    emitted = True
                    yield _sse({"type": "token", "text": token})
            except LLMError as exc:
                if not emitted:
                    for piece in _pieces(prepared["fallback"]):
                        yield _sse({"type": "token", "text": piece})
                    yield _sse({"type": "warning", "message": f"千问调用失败，已回退到离线检索：{exc}"})
                else:
                    yield _sse({"type": "warning", "message": f"生成中断：{exc}"})
        else:
            for piece in _pieces(prepared["fallback"]):
                yield _sse({"type": "token", "text": piece})
                time.sleep(0.008)
        yield _sse({"type": "done"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/review")
def review_doc(payload: ReviewRequest):
    doc_id = payload.doc_id.strip()
    if not doc_id:
        raise HTTPException(status_code=400, detail="请选择文档")
    try:
        return review.review_document(doc_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/trends")
def trend_analysis(payload: TrendRequest):
    query = (payload.query or "科研诚信").strip()
    return trends.analyze_trends(query, payload.start_year, payload.end_year)


@app.get("/api/papers")
def papers():
    items = db.list_papers(limit=500)
    return {"papers": items, "count": len(items)}


@app.post("/api/papers/import")
async def import_papers(file: UploadFile = File(...)):
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="请选择 CSV 文件")
    suffix = Path(file.filename).suffix.lower()
    if suffix != ".csv":
        raise HTTPException(status_code=400, detail="文献导入仅支持 CSV")
    temp = config.UPLOAD_DIR / f"papers_{uuid.uuid4().hex[:8]}.csv"
    await _save_upload(file, temp)
    try:
        rows = await run_in_threadpool(parse_papers_csv, temp)
    except ParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        temp.unlink(missing_ok=True)
    for row in rows:
        row["is_sample"] = 0
        row["source"] = "csv"
        db.insert_paper(row)
    return {"ok": True, "count": len(rows)}


@app.get("/api/experts")
def experts():
    items = db.list_experts()
    return {"experts": items, "count": len(items)}


@app.post("/api/experts/import")
async def import_experts(file: UploadFile = File(...)):
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="请选择 CSV 文件")
    suffix = Path(file.filename).suffix.lower()
    if suffix != ".csv":
        raise HTTPException(status_code=400, detail="专家导入仅支持 CSV")
    temp = config.UPLOAD_DIR / f"experts_{uuid.uuid4().hex[:8]}.csv"
    await _save_upload(file, temp)
    try:
        rows = await run_in_threadpool(parse_experts_csv, temp)
        for row in rows:
            db.insert_expert(row)
        return {"ok": True, "count": len(rows)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        temp.unlink(missing_ok=True)


@app.delete("/api/experts/sample")
def remove_sample_experts():
    count = db.delete_sample_experts()
    return {"ok": True, "removed": count}


@app.post("/api/tool/check")
def tool_check(payload: ToolCheckRequest):
    doc_id = payload.doc_id.strip()
    if not doc_id:
        raise HTTPException(status_code=400, detail="请选择文档")
    try:
        return expert_service.run_tool_check(doc_id, top_k=payload.top_k)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/papers/sample")
def remove_sample_papers():
    count = db.delete_sample_papers()
    return {"ok": True, "removed": count}


@app.exception_handler(ParseError)
async def parse_error_handler(_request, exc: ParseError):
    return JSONResponse(status_code=400, content={"error": str(exc)})


@app.exception_handler(Exception)
async def unhandled_error_handler(_request, exc: Exception):
    logger.exception("unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"error": "服务器内部错误"})


# ---------- React SPA ----------
if (DIST_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")


@app.get("/{full_path:path}")
async def spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="接口不存在")
    if DIST_DIR.is_dir():
        dist_root = DIST_DIR.resolve()
        candidate = (DIST_DIR / full_path).resolve()
        if not candidate.is_relative_to(dist_root):
            raise HTTPException(status_code=404, detail="资源不存在")
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist_root / "index.html")
    return JSONResponse(
        status_code=503,
        content={"error": "前端尚未构建，请先执行：cd frontend && npm install && npm run build"},
    )


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8010")),
        reload=False,
    )
