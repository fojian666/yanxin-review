import hashlib
import json
import subprocess
import sys
import threading
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import app as application
from rag import auth, config, db, material_processing as processing, ocr, parsers, review_cases

REAL_START = processing.start


@pytest.fixture
def materials(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "materials.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(application, "seed_all", lambda: {})
    monkeypatch.setattr(processing, "start", lambda: None)
    processing._stop.clear()
    db.init_db()
    source = tmp_path / "material.txt"
    source.write_text("更新后的研究内容与技术路线" * 100)
    db.insert_document({"id": "material", "name": "处理测试", "kind": "proposal", "source": "upload", "path": str(source), "owner_username": "owner"},
                       [{"idx": 0, "text": "原有解析文本", "page": 1, "section": "研究内容"}])
    return source


def quality():
    return db.get_document("material")["meta"]["quality"]


def test_job_is_idempotent_and_replaces_text_atomically(materials, monkeypatch):
    first = processing.enqueue("material", "manager")
    processing.enqueue("material", "manager")
    assert quality()["job_id"]
    token = quality()["job_id"]
    assert first["state"] == "queued" and "job_id" not in first and "actor" not in first
    processing.enqueue("material", "manager")
    assert quality()["job_id"] == token
    processing.process_document("material")
    assert quality()["state"] == "indexing" and quality()["complete"]
    assert "更新后的研究内容" in db.get_chunks("material")[0]["text"]
    public = db.list_documents()[0]
    assert public["quality"]["state"] == "indexing"
    assert not {"meta", "meta_json", "path"} & public.keys()
    assert "job_id" not in public["quality"]
    revision = quality()["revision"]
    assert public["quality"]["revision"] == revision
    processing._progress("material", token, state="ready")
    processing.enqueue("material", "manager")
    assert quality()["revision"] == revision
    monkeypatch.setattr(processing, "parse_upload", lambda _: (_ for _ in ()).throw(RuntimeError("失败")))
    processing.process_document("material")
    assert quality()["state"] == "failed" and quality()["revision"] == revision


def test_failed_or_interrupted_job_keeps_existing_chunks(materials, monkeypatch):
    processing.enqueue("material", "manager")
    monkeypatch.setattr(processing, "parse_upload", lambda _: (_ for _ in ()).throw(RuntimeError("失败")))
    processing.process_document("material")
    assert quality()["state"] == "failed"
    assert db.get_chunks("material")[0]["text"] == "原有解析文本"
    processing.enqueue("material", "manager")
    monkeypatch.setattr(processing, "parse_upload", lambda _: (_ for _ in ()).throw(InterruptedError()))
    processing.process_document("material")
    assert quality()["state"] == "queued"


def test_final_write_failure_rolls_back_deleted_chunks(materials, monkeypatch):
    processing.enqueue("material", "manager")
    monkeypatch.setattr(processing, "chunk_document", lambda *_: [{"idx": 0, "text": "新"}, {"idx": 1}])
    processing.process_document("material")
    assert quality()["state"] == "failed"
    assert db.get_chunks("material")[0]["text"] == "原有解析文本"


def test_reviewed_material_is_protected_and_busy_material_cannot_enter_case(materials):
    processing.enqueue("material", "manager")
    with pytest.raises(ValueError, match="正在处理"):
        review_cases.create_case(title="", doc_id="material", dossier_id="", actor="manager")
    processing.process_document("material")
    processing._progress("material", quality()["job_id"], state="ready")
    review_cases.create_case(title="", doc_id="material", dossier_id="", actor="manager")
    with pytest.raises(ValueError, match="正式评审"):
        processing.enqueue("material", "manager")


def test_processing_permission_and_local_path_are_enforced(materials, monkeypatch):
    for role in ("manager", "reviewer", "viewer"):
        auth.create_user(role, "testing123", role)
    with TestClient(application.app) as client:
        for role, expected in [("viewer", 403), ("reviewer", 403), ("manager", 200)]:
            assert client.post("/api/auth/login", json={"username": role, "password": "testing123"}).status_code == 200
            assert client.post("/api/documents/material/process").status_code == expected
        meta = client.get("/api/documents/material/content").json()["document"]["quality"]
        assert meta["state"] == "queued" and "job_id" not in meta and "actor" not in meta
    with db.connect() as conn:
        conn.execute("UPDATE documents SET source='public' WHERE id='material'")
    with pytest.raises(ValueError, match="受控目录"):
        processing.enqueue("material", "manager")


def test_pdf_merges_ocr_by_page_preserves_text_and_flags_uncertainty(materials, monkeypatch):
    monkeypatch.setattr(processing, "parse_pdf", lambda _: {"pages": [{"page": 1, "text": "已有文字" * 50}], "page_count": 3})
    monkeypatch.setattr(processing.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess([], 0, b"Pages: 3\n", b""))
    monkeypatch.setattr(ocr, "engine", lambda: ("fake-local", "local"))
    calls = []
    def recognize(path, page, digest, backend):
        calls.append(page)
        return {"text": "识别正文" * 40, "confidence": .9 if page == 2 else .5}
    monkeypatch.setattr(ocr, "recognize_page", recognize)
    steps = []
    result = processing._pdf(materials, lambda **step: steps.append(step))
    assert calls == [2, 3]
    assert [p["page"] for p in result["pages"]] == [1, 2, 3]
    assert result["pages"][0]["text"].startswith("已有文字")
    assert result["quality"]["ocr_pages"] == 2 and not result["quality"]["complete"]
    assert result["quality"]["missing_pages"] == 1 and steps[-1]["processed_pages"] == 3
    assert "人工" not in result["pages"][1]["text"]  # 说明文字不能掺入证据正文。


def test_pdf_text_limit_keeps_true_total_and_never_claims_complete(materials, monkeypatch):
    monkeypatch.setattr(config, "MAX_CONTENT_CHARS", 120)
    monkeypatch.setattr(processing, "parse_pdf", lambda _: {"pages": [{"page": i, "text": "文" * 100} for i in range(1, 4)], "page_count": 3})
    monkeypatch.setattr(processing.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess([], 0, b"Pages: 3\n", b""))
    result = processing._pdf(materials, lambda **_: None)
    assert result["text_len"] == 120 and result["page_count"] == 3
    assert result["quality"]["processed_pages"] == 2 and result["quality"]["truncated"]
    assert not result["quality"]["complete"] and "2/3" in result["warning"]


@pytest.mark.parametrize("backend", [("vision-test", "offline"), ("tesseract-test", "offline_tesseract")])
def test_ocr_cache_is_page_scoped_and_does_not_call_engine_again(materials, monkeypatch, backend):
    monkeypatch.delattr(hashlib, "file_digest", raising=False)
    digest = hashlib.sha256(materials.read_bytes()).hexdigest()
    assert ocr.file_sha256(materials) == digest
    calls = []
    def run(cmd, **kwargs):
        calls.append(cmd)
        if cmd[0] == "pdftoppm":
            Path(cmd[-1] + ".png").write_bytes(b"fake")
            return subprocess.CompletedProcess(cmd, 0, b"", b"")
        if cmd[0] == "offline_tesseract":
            data = "block_num\tpar_num\tline_num\tconf\ttext\n1\t1\t1\t90\t识别正文\n"
            return subprocess.CompletedProcess(cmd, 0, data.encode(), b"")
        return subprocess.CompletedProcess(cmd, 0, json.dumps({"text": "识别正文", "confidence": .9}).encode(), b"")
    monkeypatch.setattr(ocr.subprocess, "run", run)
    assert ocr.recognize_page(materials, 2, digest, backend)["text"] == "识别正文"
    assert len(calls) == 2
    ocr.recognize_page(materials, 2, digest, backend)
    assert len(calls) == 2
    ocr.recognize_page(materials, 3, digest, backend)
    assert len(calls) == 4 and "-f" in calls[0]
    assert all(p.stat().st_mode & 0o077 == 0 for p in (config.DATA_DIR / "ocr_cache").glob("*.json"))


def test_missing_local_ocr_is_explicit_and_never_uses_cloud(materials, monkeypatch):
    monkeypatch.setattr(ocr.platform, "system", lambda: "Linux")
    monkeypatch.setattr(ocr.shutil, "which", lambda _: None)
    with pytest.raises(ocr.OCRUnavailable, match="本地中文 OCR"):
        ocr.engine()


def test_rebuilt_paper_updates_only_automatic_derived_fields(materials):
    with db.connect() as conn:
        conn.execute("UPDATE documents SET kind='paper' WHERE id='material'")
    db.insert_paper_if_new({"doc_id": "material", "title": "文献处理测试", "authors": "人工作者", "year": 2025,
                            "venue": "人工期刊", "abstract": "旧摘要", "keywords": "旧关键词", "source": "upload"})
    processing.enqueue("material", "manager")
    processing.process_document("material")
    with db.connect() as conn:
        paper = dict(conn.execute("SELECT * FROM papers WHERE doc_id='material'").fetchone())
    assert "更新后的研究内容" in paper["abstract"] and paper["keywords"] != "旧关键词"
    assert (paper["authors"], paper["venue"], paper["year"]) == ("人工作者", "人工期刊", 2025)


def test_worker_cancels_child_and_can_stop_start_in_same_process(materials, monkeypatch):
    real_popen = subprocess.Popen
    child = real_popen([sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)
    try:
        with monkeypatch.context() as patch:
            started = threading.Event()
            def spawn(*args, **kwargs):
                started.set()
                return child
            patch.setattr(processing.subprocess, "Popen", spawn)
            thread = threading.Thread(target=processing._run_job, args=("material",))
            thread.start()
            assert started.wait(timeout=2)
            processing._stop.set()
            thread.join(timeout=5)
            assert not thread.is_alive() and child.poll() is not None
        processing._stop.clear()
        with monkeypatch.context() as patch:
            patch.setattr(processing, "_thread", None)
            patch.setattr(processing, "_worker", lambda: processing._stop.wait())
            for _ in range(2):
                REAL_START()
                assert processing._thread.is_alive() and not processing._stop.is_set()
                processing.stop()
                assert processing._thread is None or not processing._thread.is_alive()
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        processing._stop.clear()
