from __future__ import annotations

import hmac as _hmac
import json
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from rag import auth, config, db, qa, review, schemas, trends
from rag import experts as expert_service
from rag import ingest as ingest_service
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
    version="0.3.0",
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

# 无需登录即可访问的接口
PUBLIC_API_PATHS = {
    "/api/health",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/ingest/schema",
    # 推送端点对中间件豁免：由 ingest_guard 自行校验
    # （有效接入令牌 OR 已登录 manager/admin 会话），否则外部系统
    # （无浏览器 Cookie）会被中间件先拦成 401，令牌流走不通
    "/api/ingest/experts",
    "/api/ingest/papers",
}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    # CORS 预检请求不带 Cookie，必须放行，否则跨域开发环境全部失败
    if request.method == "OPTIONS":
        return await call_next(request)
    if path.startswith("/api/") and path not in PUBLIC_API_PATHS:
        token = request.cookies.get(auth.SESSION_COOKIE, "")
        user = auth.resolve_session(token) if token else None
        if not user:
            return JSONResponse(status_code=401, content={"error": "未登录或会话已过期"})
        request.state.user = user
    return await call_next(request)


def require_role(*roles: str):
    """写操作按角色限制；登录本身由中间件保证。"""

    def dependency(request: Request) -> dict:
        user = getattr(request.state, "user", None)
        if not user or user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="当前角色无权执行该操作")
        return user

    return dependency


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


class IngestExpertsRequest(BaseModel):
    experts: list[schemas.ExternalExpert] = Field(default_factory=list, max_length=1000)


class IngestPapersRequest(BaseModel):
    papers: list[schemas.ExternalPaper] = Field(default_factory=list, max_length=1000)


class LoginRequest(BaseModel):
    # 长度上限同时兜住两条线：PBKDF2 的 CPU 放大、限速表键的内存放大
    username: str = Field(default="", max_length=64)
    password: str = Field(default="", max_length=256)


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(default="", max_length=256)
    new_password: str = Field(default="", max_length=256)


class CreateUserRequest(BaseModel):
    username: str = ""
    password: str = ""
    role: str = "viewer"
    display_name: str = ""


def _require_ingest_token(
    x_ingest_token: str = Header(default="", alias="X-INGEST-Token"),
) -> None:
    expected = (config.INGEST_TOKEN or "").strip()
    if expected and not _hmac.compare_digest(x_ingest_token, expected):
        raise HTTPException(status_code=401, detail="无效的数据接入令牌")


def ingest_guard(
    request: Request,
    x_ingest_token: str = Header(default="", alias="X-INGEST-Token"),
) -> None:
    """机器推送专用守卫：有效接入令牌 **或** 已登录的 manager/admin 会话均可。
    只要求会话会把外部系统（无浏览器 Cookie）挡在门外；只要求令牌
    又会在未配置令牌时退化为任意登录用户可写。二者取其一。"""
    expected = (config.INGEST_TOKEN or "").strip()
    if expected and _hmac.compare_digest(x_ingest_token, expected):
        return
    # 推送端点对中间件豁免，state.user 未必存在：令牌不匹配时自行解析会话
    user = getattr(request.state, "user", None) or auth.resolve_session(
        request.cookies.get(auth.SESSION_COOKIE, "")
    )
    if user and user.get("role") in {"manager", "admin"}:
        return
    if not expected:
        raise HTTPException(
            status_code=403,
            detail="未配置 INGEST_TOKEN，请以科研管理/管理员账号登录后推送，或在 .env 配置令牌",
        )
    raise HTTPException(status_code=403, detail="需要有效的接入令牌或科研管理/管理员会话")


def _infer_kind(filename: str, text: str = "") -> str:
    name = (filename or "").lower()
    if any(k in name for k in ("政策", "办法", "规定", "条例", "指南", "规范", "细则")):
        return "policy"
    if any(k in name for k in ("本子", "申请书", "申报书", "课题", "项目申报")):
        return "proposal"
    # 文件名判断不了时嗅探正文：政策文件有条款结构，本子有固定章节
    head = (text or "")[:2000]
    if re.search(r"第[一二三四五六七八九十百零]+条", head) or any(
        k in head for k in ("管理办法", "实施细则", "暂行办法", "实施办法")
    ):
        return "policy"
    if any(k in head for k in ("立项背景", "研究内容", "考核指标", "技术路线")):
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
        "upload_limit_mb": config.MAX_UPLOAD_BYTES // 1024 // 1024,
    }


# ---------- 认证与用户 ----------


def _session_response(payload: dict, token: str) -> JSONResponse:
    resp = JSONResponse(payload)
    resp.set_cookie(
        auth.SESSION_COOKIE,
        token,
        max_age=auth.SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=config.COOKIE_SECURE,
    )
    return resp


@app.post("/api/auth/login")
def login(payload: LoginRequest, request: Request):
    client = request.client.host if request.client else ""
    if not auth.login_allowed(payload.username, client):
        raise HTTPException(
            status_code=429,
            detail=f"登录失败次数过多，请 {auth.LOGIN_WINDOW_SECONDS // 60} 分钟后再试",
            headers={"Retry-After": str(auth.LOGIN_WINDOW_SECONDS)},
        )
    user = auth.verify_login(payload.username, payload.password)
    if not user:
        auth.record_login_failure(payload.username, client)
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    auth.clear_login_failures(payload.username, client)
    token = auth.create_session(user["username"])
    return _session_response({"ok": True, "user": user}, token)


@app.post("/api/auth/logout")
def logout(request: Request):
    auth.delete_session(request.cookies.get(auth.SESSION_COOKIE, ""))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.SESSION_COOKIE)
    return resp


@app.get("/api/auth/me")
def me(request: Request):
    return request.state.user


@app.post("/api/auth/password")
def change_password(payload: ChangePasswordRequest, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")
    if not auth.change_password(
        user["username"], payload.old_password, payload.new_password
    ):
        raise HTTPException(
            status_code=400,
            detail=f"原密码不正确，或新密码少于 {auth.MIN_PASSWORD_LEN} 位",
        )
    # 改密后让所有旧会话失效，并给当前浏览器换发新会话
    auth.delete_user_sessions(user["username"])
    token = auth.create_session(user["username"])
    return _session_response({"ok": True}, token)


@app.get("/api/auth/users", dependencies=[Depends(require_role("admin"))])
def users():
    return {"users": auth.list_users(), "roles": auth.ROLE_LABELS}


@app.post("/api/auth/users", dependencies=[Depends(require_role("admin"))])
def create_user(payload: CreateUserRequest):
    if not auth.create_user(
        payload.username, payload.password, payload.role, payload.display_name
    ):
        raise HTTPException(
            status_code=400,
            detail=f"无法创建用户（用户名已存在，或角色非法，或密码少于 {auth.MIN_PASSWORD_LEN} 位）",
        )
    return {"ok": True, "user": {"username": payload.username, "role": payload.role}}


@app.get("/api/documents")
def documents():
    return {"documents": db.list_documents()}


@app.post("/api/documents")
async def upload_document(
    file: UploadFile = File(...),
    kind: str = Form("auto"),
    year: str = Form(""),
    title: str = Form(""),
    _user: dict = Depends(require_role("manager", "admin")),
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

    doc_id = db.new_id()
    target = config.UPLOAD_DIR / f"{doc_id}_{filename}"
    await _save_upload(file, target)
    try:
        parsed = await run_in_threadpool(parse_upload, target)
        text = "\n".join(p.get("text", "") for p in parsed["pages"])
        if kind == "auto":
            kind = _infer_kind(filename, text)
        chunks = await run_in_threadpool(
            chunk_document, parsed["pages"], config.CHUNK_SIZE, config.CHUNK_OVERLAP
        )
    except ParseError as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"解析失败：{exc}") from exc
    title_value = (title or "").strip() or guess_title(filename, text)
    year_raw = str(year or "").strip()
    if year_raw.isdigit() and 1990 <= int(year_raw) <= 2035:
        year_value: int | None = int(year_raw)
    else:
        # 非法/越界年份忽略，回退到自动抽取
        year_value = extract_year(filename, text)
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
    try:
        db.insert_document(doc, chunks)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    if kind == "paper":
        # 文献类型的文档重复上传时允许（用于查重演示），但文献表去重
        db.insert_paper_if_new(
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
    document = {k: v for k, v in doc.items() if k != "path"}
    document.update({"chunk_count": len(chunks), "meta": None})
    return {"document": document, "warning": warning}


@app.delete("/api/documents/{doc_id}")
def remove_document(doc_id: str, _user: dict = Depends(require_role("manager", "admin"))):
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
def review_doc(payload: ReviewRequest, _user: dict = Depends(require_role("reviewer", "manager", "admin"))):
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
async def import_papers(file: UploadFile = File(...), _user: dict = Depends(require_role("manager", "admin"))):
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
    inserted = 0
    known = db.paper_keys()
    for row in rows:
        row["is_sample"] = 0
        row["source"] = "csv"
        if db.insert_paper_if_new(row, known):
            inserted += 1
    return {"ok": True, "count": inserted, "skipped": len(rows) - inserted}


@app.get("/api/experts")
def experts(_user: dict = Depends(require_role("reviewer", "manager", "admin"))):
    items = db.list_experts()
    return {"experts": items, "count": len(items)}


@app.post("/api/experts/import")
async def import_experts(file: UploadFile = File(...), _user: dict = Depends(require_role("manager", "admin"))):
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="请选择 CSV 文件")
    suffix = Path(file.filename).suffix.lower()
    if suffix != ".csv":
        raise HTTPException(status_code=400, detail="专家导入仅支持 CSV")
    temp = config.UPLOAD_DIR / f"experts_{uuid.uuid4().hex[:8]}.csv"
    await _save_upload(file, temp)
    try:
        rows = await run_in_threadpool(parse_experts_csv, temp)
        inserted = 0
        known = db.expert_keys()
        for row in rows:
            if db.insert_expert_if_new(row, known):
                inserted += 1
        return {"ok": True, "count": inserted, "skipped": len(rows) - inserted}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        temp.unlink(missing_ok=True)


@app.delete("/api/experts/sample")
def remove_sample_experts(_user: dict = Depends(require_role("manager", "admin"))):
    count = db.delete_sample_experts()
    return {"ok": True, "removed": count}


@app.post("/api/tool/check")
def tool_check(payload: ToolCheckRequest, _user: dict = Depends(require_role("reviewer", "manager", "admin"))):
    doc_id = payload.doc_id.strip()
    if not doc_id:
        raise HTTPException(status_code=400, detail="请选择文档")
    try:
        return expert_service.run_tool_check(doc_id, top_k=payload.top_k)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ---------- 外部数据接入（预留接口） ----------


@app.post("/api/ingest/experts", dependencies=[Depends(ingest_guard)])
def ingest_experts(payload: IngestExpertsRequest):
    """外部系统推送专家数据；同名同单位自动跳过，幂等可重放。"""
    inserted, skipped = ingest_service.ingest_experts(payload.experts)
    return {"ok": True, "count": inserted, "skipped": skipped}


@app.post("/api/ingest/papers", dependencies=[Depends(ingest_guard)])
def ingest_papers(payload: IngestPapersRequest):
    """外部系统推送文献数据；同标题同年份自动跳过，幂等可重放。"""
    inserted, skipped = ingest_service.ingest_papers(payload.papers)
    return {"ok": True, "count": inserted, "skipped": skipped}


@app.get("/api/ingest/schema")
def ingest_schema():
    """数据接入契约：字段结构、鉴权方式、预留实体，供对接方自查。"""
    token_required = bool((config.INGEST_TOKEN or "").strip())
    return {
        "version": app.version,
        "auth": {"header": "X-INGEST-Token", "required": token_required},
        "accepted": {
            "experts": {
                "endpoint": "POST /api/ingest/experts",
                "body_key": "experts",
                "schema": schemas.ExternalExpert.model_json_schema(),
            },
            "papers": {
                "endpoint": "POST /api/ingest/papers",
                "body_key": "papers",
                "schema": schemas.ExternalPaper.model_json_schema(),
            },
        },
        "reserved": {
            "projects": {
                "schema": schemas.ProjectRecord.model_json_schema(),
                "status": "结构已预留（查重/谱系/统计），接收端点未启用",
            },
            "integrity_records": {
                "schema": schemas.IntegrityRecord.model_json_schema(),
                "status": "结构已预留（风险提示），接收端点未启用",
            },
            "policy_meta": {
                "schema": schemas.PolicyMeta.model_json_schema(),
                "status": "结构已预留（版本化合规），接收端点未启用",
            },
        },
    }


@app.delete("/api/documents/sample")
def remove_sample_documents(_user: dict = Depends(require_role("manager", "admin"))):
    removed = db.delete_sample_documents()
    retriever.rebuild()
    return {"ok": True, "removed": removed}


@app.delete("/api/papers/sample")
def remove_sample_papers(_user: dict = Depends(require_role("manager", "admin"))):
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
