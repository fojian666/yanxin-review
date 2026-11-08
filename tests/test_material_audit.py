import subprocess
import zipfile
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import app as application
from rag import auth, config, db, material_processing as processing, ocr, parsers


@pytest.fixture
def material_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "materials.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(application, "seed_all", lambda: {})
    monkeypatch.setattr(processing, "start", lambda: None)
    processing._stop.clear()
    db.init_db()
    return tmp_path


def _material(path: Path, doc_id: str = "material") -> None:
    db.insert_document(
        {
            "id": doc_id,
            "name": "本地处理测试",
            "kind": "proposal",
            "source": "upload",
            "path": str(path),
            "owner_username": "manager",
        },
        [{"idx": 0, "page": 1, "section": "", "text": "原有正文"}],
    )


def test_docx_content_controls_are_parsed(tmp_path):
    path = tmp_path / "sdt.docx"
    xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:sdt><w:sdtContent>
          <w:p><w:r><w:t>内容控件中的申报单位</w:t></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>预算十万元</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        </w:sdtContent></w:sdt>
        <w:customXml><w:p><w:r><w:ins><w:t>自定义XML正文</w:t></w:ins></w:r></w:p></w:customXml>
      </w:body>
    </w:document>"""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", xml)
    result = parsers.parse_docx(path)
    text = result["pages"][0]["text"]
    assert "内容控件中的申报单位" in text
    assert "预算十万元" in text
    assert "自定义XML正文" in text


def test_office_archive_size_checks_once_per_package(tmp_path, monkeypatch):
    path = tmp_path / "many.odt"
    content = """<?xml version="1.0" encoding="UTF-8"?>
    <office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
      xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
      <office:body><office:text><text:p>压缩文档正文</text:p></office:text></office:body>
    </office:document-content>"""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("content.xml", content)
        for index in range(20):
            archive.writestr(f"meta/part-{index}.xml", "<x/>")
    original = parsers._check_zip_size
    calls = []

    def count_once(archive):
        calls.append(archive.filename)
        return original(archive)

    monkeypatch.setattr(parsers, "_check_zip_size", count_once)
    result = parsers.parse_odt(path)
    assert "压缩文档正文" in result["pages"][0]["text"]
    assert len(calls) == 1


def test_rtf_non_bmp_and_html_charset_are_preserved(tmp_path):
    rtf = tmp_path / "emoji.rtf"
    rtf.write_bytes(r"{\rtf1\ansi \u-10179?\u-8704? ok}".encode("ascii"))
    result = parsers.parse_rtf(rtf)
    assert "😀" in result["pages"][0]["text"]
    assert "ok" in result["pages"][0]["text"]
    result["pages"][0]["text"].encode("utf-8")

    html = tmp_path / "gbk.html"
    html.write_bytes(
        '<html><head><meta charset="gbk"></head><body><p>科研诚信中文正文</p></body></html>'.encode("gbk")
    )
    parsed = parsers.parse_html(html)
    assert "科研诚信中文正文" in parsed["pages"][0]["text"]
    assert parsed["warning"] == ""


def test_pdf_page_limit_uses_exact_sentinel_count(tmp_path, monkeypatch):
    def run(cmd, **_kwargs):
        if cmd[0] == "pdfinfo":
            return subprocess.CompletedProcess(cmd, 0, b"Pages: 3\n", b"")
        return subprocess.CompletedProcess(
            cmd,
            0,
            stdout=(("正文" * 80 + "\f") * 3).encode(),
            stderr=b"",
        )

    monkeypatch.setattr(config, "MAX_PDF_PAGES", 2)
    monkeypatch.setattr(parsers.subprocess, "run", run)
    truncated = parsers.parse_upload(tmp_path / "three.pdf")
    assert truncated["page_count"] == 3
    assert truncated["quality"]["truncated"] is True
    assert truncated["quality"]["complete"] is False

    def exact_run(cmd, **_kwargs):
        if cmd[0] == "pdfinfo":
            return subprocess.CompletedProcess(cmd, 0, b"Pages: 2\n", b"")
        return subprocess.CompletedProcess(
            cmd,
            0,
            stdout=(("正文" * 80 + "\f") * 2).encode(),
            stderr=b"",
        )

    monkeypatch.setattr(parsers.subprocess, "run", exact_run)
    exact = parsers.parse_upload(tmp_path / "two.pdf")
    assert exact["page_count"] == 2
    assert exact["quality"]["truncated"] is False


def test_ocr_page_budget_marks_material_partial(material_db, monkeypatch):
    path = material_db / "scan.pdf"
    path.write_bytes(b"pdf")
    monkeypatch.setattr(config, "OCR_MAX_PAGES", 1)
    monkeypatch.setattr(processing, "parse_pdf", lambda _: {
        "pages": [{"page": 1, "text": ""}, {"page": 2, "text": ""}, {"page": 3, "text": ""}],
        "page_count": 3,
    })
    monkeypatch.setattr(
        processing.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, b"Pages: 3\n", b""),
    )
    monkeypatch.setattr(ocr, "engine", lambda: ("local", "local"))
    calls = []
    monkeypatch.setattr(
        ocr,
        "recognize_page",
        lambda _path, page, _digest, _backend: calls.append(page) or {
            "text": "中文" * 50,
            "confidence": .9,
        },
    )
    result = processing._pdf(path, lambda **_fields: None)
    assert calls == [1]
    assert result["quality"]["truncated"] is True
    assert "OCR 达到 1 页上限" in result["warning"]


def test_ocr_budget_counts_attempts_even_when_text_does_not_improve(
    material_db,
    monkeypatch,
):
    path = material_db / "scan-no-gain.pdf"
    path.write_bytes(b"pdf")
    monkeypatch.setattr(config, "OCR_MAX_PAGES", 1)
    monkeypatch.setattr(processing, "parse_pdf", lambda _: {
        "pages": [
            {"page": 1, "text": "已有文字" * 15},
            {"page": 2, "text": "已有文字" * 15},
            {"page": 3, "text": "已有文字" * 15},
        ],
        "page_count": 3,
    })
    monkeypatch.setattr(
        processing.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0],
            0,
            b"Pages: 3\n",
            b"",
        ),
    )
    monkeypatch.setattr(ocr, "engine", lambda: ("local", "local"))
    calls = []
    monkeypatch.setattr(
        ocr,
        "recognize_page",
        lambda _path, page, _digest, _backend: calls.append(page) or {
            "text": "已有",
            "confidence": .9,
        },
    )
    result = processing._pdf(path, lambda **_fields: None)
    assert calls == [1]
    assert result["quality"]["ocr_pages"] == 0
    assert result["quality"]["truncated"] is True
    assert "OCR 达到 1 页上限" in result["warning"]


def test_cancel_keeps_existing_text_and_invalidates_job(material_db):
    path = material_db / "source.txt"
    path.write_text("新正文" * 100, encoding="utf-8")
    _material(path)
    processing.enqueue("material", "manager")
    before = db.get_chunks("material")
    result = processing.cancel("material", "manager")
    assert result["state"] == "cancelled"
    assert db.get_chunks("material") == before
    assert processing.enqueue("material", "manager")["state"] == "queued"


def test_parent_total_timeout_terminates_worker(material_db, monkeypatch):
    path = material_db / "source.txt"
    path.write_text("新正文" * 100, encoding="utf-8")
    _material(path)
    processing.enqueue("material", "manager")
    monkeypatch.setattr(config, "MATERIAL_PROCESS_TIMEOUT_SECONDS", .2)
    real_popen = subprocess.Popen
    child = real_popen(["sleep", "60"], start_new_session=True)
    monkeypatch.setattr(processing.subprocess, "Popen", lambda *_args, **_kwargs: child)
    processing._run_job("material")
    quality = db.get_document("material")["meta"]["quality"]
    assert quality["state"] == "failed"
    assert "总时限" in quality["note"]


def test_cancel_processing_api_marks_cancelled_without_replacing_text(material_db):
    path = material_db / "cancel.txt"
    path.write_text("新正文" * 100, encoding="utf-8")
    _material(path)
    assert auth.create_user("manager-cancel", "testing123", "manager")
    processing.enqueue("material", "manager-cancel")
    before = db.get_chunks("material")
    with TestClient(application.app) as client:
        assert client.post(
            "/api/auth/login",
            json={"username": "manager-cancel", "password": "testing123"},
        ).status_code == 200
        response = client.post("/api/documents/material/process/cancel")
        assert response.status_code == 200
        assert response.json()["quality"]["state"] == "cancelled"
    assert db.get_chunks("material") == before


def test_cancel_during_indexing_is_rejected_after_text_commit(material_db):
    path = material_db / "cancel-index.txt"
    path.write_text("正文" * 100, encoding="utf-8")
    _material(path)
    processing.enqueue("material", "manager")
    token = db.get_document("material")["meta"]["quality"]["job_id"]
    assert processing._allocate_execution("material", "execution")
    processing._progress(
        "material",
        token,
        execution_id="execution",
        expected_state="processing",
        state="indexing",
    )
    assert auth.create_user("manager-index", "testing123", "manager")
    with TestClient(application.app) as client:
        assert client.post(
            "/api/auth/login",
            json={"username": "manager-index", "password": "testing123"},
        ).status_code == 200
        response = client.post("/api/documents/material/process/cancel")
    assert response.status_code == 409
    assert "更新索引" in response.json()["detail"]
    assert db.get_document("material")["meta"]["quality"]["state"] == "indexing"
    processing._progress(
        "material",
        token,
        state="ready",
        expected_state="indexing",
    )
    assert db.get_document("material")["meta"]["quality"]["state"] == "ready"
